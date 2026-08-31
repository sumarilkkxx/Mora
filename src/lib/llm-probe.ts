/**
 * Connection probe for OpenAI-compatible endpoints, plus model discovery.
 *
 * Split out of /api/llm/test so the branchy part is unit-testable against fake providers — a probe
 * that reports a working endpoint as broken is as damaging as one that reports a dead endpoint as
 * working, and both regressions have shipped here before (issue #19).
 *
 * Two provider behaviours the naive `max_tokens: 1` probe got wrong:
 *
 *  1. Some backends turn "the completion hit its token cap" into a 400 instead of returning a
 *     truncated message with `finish_reason: "length"`. Pollinations (azure-openai upstream) answers
 *     `400 … Could not finish the message because max_tokens or model output limit was reached`, so a
 *     1-token probe could NEVER pass there, no matter how valid the key was.
 *  2. Reasoning models reject `max_tokens` outright ("use max_completion_tokens instead").
 *
 * Both are answered the same way: retry once without any cap. If the cap-related rejection survives
 * that, the request still proves baseUrl + key + model all resolve — the provider ran the model — so
 * the probe passes and carries a warning instead of a red cross.
 */

import { explainLLMStatus, isLegacyPollinations, isTokenCapRejection, type LLMMessagePair } from "@/lib/llm-error";
import { listModels, modelListHint, normalizeChatBase } from "@/lib/llm-models";

/** Probe completion budget. Large enough that no provider treats it as "cannot produce output". */
export const PROBE_MAX_TOKENS = 64;

const PROBE_TIMEOUT_MS = 15000;

/** Outcome of a probe. `warning` is set when the endpoint works but something is worth knowing. */
export interface ProbeOutcome {
  ok: boolean;
  status?: number;
  /** Actionable failure text (both locales) — absent when ok. */
  error?: LLMMessagePair;
  /** Non-fatal note (both locales) — may accompany ok. */
  warning?: LLMMessagePair;
}

export interface ProbeInput {
  baseUrl: string;
  apiKey: string;
  model?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** POST a minimal completion. `maxTokens: undefined` sends no cap at all. */
async function probeCompletion(
  base: string,
  apiKey: string,
  model: string,
  maxTokens: number | undefined,
  fetchImpl: typeof fetch,
): Promise<{ res: Response; text: string }> {
  const res = await fetchImpl(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
    }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const text = res.ok ? "" : await res.text().catch(() => "");
  return { res, text };
}

/**
 * Verify baseUrl + key + model in one real call.
 *
 * A model-level probe (rather than `GET /models`) is deliberate: /models says nothing about whether
 * the configured model name exists, which is how a stale preset model shipped a "connection OK" that
 * only blew up at generation time (issue #12).
 */
export async function probeLLMEndpoint(input: ProbeInput): Promise<ProbeOutcome> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = normalizeChatBase(input.baseUrl);
  const model = input.model;

  // Known-dead endpoint: fail fast with migration steps instead of probing it.
  if (isLegacyPollinations(base)) {
    return { ok: false, status: 402, error: explainLLMStatus(402, { baseUrl: base, model }) };
  }

  // No model configured yet — fall back to key-level validation.
  if (!model) {
    const res = await fetchImpl(`${base}/models`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: withRaw(explainLLMStatus(res.status, { baseUrl: base, detail: text }), res, text) };
  }

  let { res, text } = await probeCompletion(base, input.apiKey, model, PROBE_MAX_TOKENS, fetchImpl);

  // Cap-related 4xx: retry uncapped before believing it.
  if (!res.ok && (res.status === 400 || res.status === 422) && isTokenCapRejection(text)) {
    ({ res, text } = await probeCompletion(base, input.apiKey, model, undefined, fetchImpl));
    if (!res.ok && (res.status === 400 || res.status === 422) && isTokenCapRejection(text)) {
      // Still capped without any cap of ours: the provider ran the model and ran out of its own
      // output budget. Auth, endpoint and model name are all proven — pass, but say what happened.
      return {
        ok: true,
        warning: {
          zh: "该模型的输出上限很小（连一句话都写不完）：脚本生成可能中途被截断，建议减少分镜数量/时长，或换一个输出更充裕的模型",
          en: "This model's output budget is tiny (it cannot even finish one sentence): script generation may be cut off — use fewer shots / a shorter video, or pick a model with a larger output budget",
        },
      };
    }
  }

  if (res.ok) return { ok: true };

  const explained = explainLLMStatus(res.status, { baseUrl: base, model, detail: text });

  // Wrong model name is the single most common misconfiguration — answer it with the real list.
  if (res.status === 404 || (res.status === 400 && /model/i.test(text) && /not found|does not exist|不存在/i.test(text))) {
    const hint = modelListHint(await listModels(base, input.apiKey, fetchImpl), model, base);
    if (hint) {
      return {
        ok: false,
        status: res.status,
        error: withRaw({ zh: `${explained.zh}。${hint.zh}`, en: `${explained.en}. ${hint.en}` }, res, text),
      };
    }
  }

  return { ok: false, status: res.status, error: withRaw(explained, res, text) };
}

/** Append the provider's own words — screenshots of this line are what make bug reports actionable. */
function withRaw(pair: LLMMessagePair, res: Response, text: string): LLMMessagePair {
  const raw = `${res.status} ${res.statusText}${text ? ` - ${text.replace(/\s+/g, " ").slice(0, 200)}` : ""}`;
  return { zh: `${pair.zh} · ${raw}`, en: `${pair.en} · ${raw}` };
}
