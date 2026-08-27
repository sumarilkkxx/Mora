/**
 * LLM client factory + failure messages for OpenAI-compatible endpoints.
 *
 * Retry logic and error classification are NOT hand-rolled here — both come from the official `openai`
 * SDK, which already ships exponential backoff with jitter, honours `retry-after` / `retry-after-ms`,
 * and exposes a typed error hierarchy (AuthenticationError / NotFoundError / RateLimitError / …).
 * This module only supplies the two things the SDK cannot know:
 *
 *  1. That HTTP 402 is retryable on a free shared pool. The SDK retries 408/409/429/5xx; 402 normally
 *     means "top up your account" so it correctly refuses to retry it. On Pollinations' free tier 402
 *     instead means "the shared pool ran dry this second" and clears on its own — verified live: the
 *     same request returned 200, then 402, then 502 within a minute. We flip those responses to
 *     retryable via the SDK's own `x-should-retry` / `retry-after-ms` response-header protocol, so the
 *     retrying itself stays inside the SDK.
 *  2. Wording. Issue #19 reported the app as simply "broken" because the only feedback was
 *     `LLM 请求失败（模型: openai-fast，地址: https://text.pollinations.ai/openai）: 402 "402 Payment
 *     Required"` — a status code names the failure but not the fix. Each branch below names the fix.
 */

import OpenAI, { APIConnectionError, APIConnectionTimeoutError } from "openai";
import { listModels, modelListHint, normalizeChatBase } from "@/lib/llm-models";

/** Endpoint + model a call was aimed at (used to tailor the hint). */
export interface LLMTarget {
  baseUrl?: string;
  model?: string;
  /** Raw provider response/message, when the caller has it — lets 400s be told apart. */
  detail?: string;
}

/** Minimal LLM config accepted by the client factory. */
export interface LLMClientConfig extends LLMTarget {
  apiKey?: string;
}

/** Error carrying both locales, so API routes can answer English clients without re-parsing text. */
export class LLMRequestError extends Error {
  readonly zh: string;
  readonly en: string;
  readonly status?: number;
  constructor(zh: string, en: string, status?: number, options?: { cause?: unknown }) {
    super(zh, options);
    this.name = "LLMRequestError";
    this.zh = zh;
    this.en = en;
    this.status = status;
  }
}

/** True when the endpoint is Pollinations — its free tier gets both the 402 retry and its own hint. */
export function isPollinations(baseUrl?: string): boolean {
  return /pollinations\.ai/i.test(baseUrl || "");
}

/** True when the endpoint is the retired keyless Pollinations text API (dead as of 2026-08). */
export function isLegacyPollinations(baseUrl?: string): boolean {
  return /text\.pollinations\.ai/i.test(baseUrl || "");
}

/**
 * True when a 4xx blames the completion-token budget rather than the request itself: either the
 * completion hit its cap ("could not finish the message…") or the model refuses `max_tokens` and
 * wants `max_completion_tokens`. Both are recoverable in ways a generic "bad request" is not.
 */
export function isTokenCapRejection(text: string | undefined): boolean {
  if (!text) return false;
  return /max_tokens|max_completion_tokens|max_output_tokens|output limit|could not finish the message/i.test(text);
}

/**
 * Wait before re-trying a drained free pool. Deliberately longer than the SDK's default 0.5s/1s/2s
 * ladder: Pollinations' anonymous tier admits roughly one request per 15s, so a sub-second retry is
 * guaranteed to hit the same wall.
 */
export const FREE_POOL_RETRY_MS = 5000;

/**
 * fetch wrapper that marks free-pool 402s as retryable using the SDK's own header protocol
 * (`x-should-retry: true` + `retry-after-ms`), letting the SDK do the backoff, jitter and attempt
 * accounting. Exported for tests.
 */
export function freePoolRetryFetch(
  baseFetch: typeof fetch = fetch,
): (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const res = await baseFetch(url, init);
    if (res.status !== 402) return res;
    // The retired keyless host will 402 forever — retrying it only makes the user wait ~90s for the
    // same message. Leave it terminal so the "switch endpoints" guidance shows up after one attempt.
    if (isLegacyPollinations(String(typeof url === "string" ? url : url instanceof URL ? url.href : url.url))) return res;
    const headers = new Headers(res.headers);
    headers.set("x-should-retry", "true");
    if (!headers.has("retry-after") && !headers.has("retry-after-ms")) {
      headers.set("retry-after-ms", String(FREE_POOL_RETRY_MS));
    }
    // Re-wrap rather than mutate: Response.headers is immutable. Body is streamed through untouched.
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}

/**
 * Rewrite a request body that the provider rejected because of its completion cap.
 * Returns undefined when there is nothing to rewrite (so the caller keeps the original failure).
 */
function withoutTokenCap(body: string, providerMessage: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.max_tokens === undefined) return undefined;
    // Reasoning models don't dislike the cap, only its name — keep the intent, rename the field.
    if (/max_completion_tokens/i.test(providerMessage)) parsed.max_completion_tokens = parsed.max_tokens;
    delete parsed.max_tokens;
    return JSON.stringify(parsed);
  } catch {
    return undefined;
  }
}

/**
 * fetch wrapper that replays a request once without our completion cap when the provider rejected it.
 *
 * Every generation call ships a fixed `max_tokens: 16000`. That number is a guess about someone
 * else's model: a provider whose ceiling is lower answers 400 ("max_tokens is greater than the
 * maximum allowed"), and a reasoning model answers 400 ("use max_completion_tokens instead"). Both
 * are our parameter's fault, not the user's — retrying without the cap lets the provider apply its
 * own default and the call succeeds. Preventive: the same class of 400 that made the connection test
 * unpassable on Pollinations (issue #19) can reach the generation path through any provider whose
 * output ceiling is below 16000.
 */
export function tokenCapRetryFetch(
  baseFetch: typeof fetch = fetch,
): (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const res = await baseFetch(url, init);
    // Never touch a successful response: its body may be an SSE stream that must pass through intact.
    if (res.ok || (res.status !== 400 && res.status !== 422)) return res;
    const sent = typeof init?.body === "string" ? init.body : undefined;
    if (!sent || !sent.includes('"max_tokens"')) return res;

    const text = await res.text().catch(() => "");
    // Reading the body consumes it, so any path that gives up must hand back an equivalent Response.
    const asIs = () => new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    if (!isTokenCapRejection(text)) return asIs();
    const retryBody = withoutTokenCap(sent, text);
    if (!retryBody) return asIs();
    return baseFetch(url, { ...init, body: retryBody });
  };
}

/**
 * Ask for provider-enforced JSON output where the endpoint is known to support it.
 * `response_format: json_object` makes the provider reject non-JSON tokens at generation time —
 * strictly better than repairing after the fact. Scoped by baseUrl because unknown endpoints may
 * 400 on the field; even for listed ones, `optionalParamRetryFetch` replays without it if a
 * specific model objects. Only for prompts whose expected top level is an OBJECT (json_object
 * forbids top-level arrays), and the prompt must mention "JSON" (all of ours do).
 */
export function jsonModeParams(baseUrl?: string): { response_format?: { type: "json_object" } } {
  return /deepseek|openai\.com|openrouter|moonshot|bigmodel\.cn|siliconflow|dashscope/i.test(baseUrl || "")
    ? { response_format: { type: "json_object" } }
    : {};
}

/**
 * Request params that are OUR optimization, not the user's intent: when a provider rejects the
 * request and blames one of these by name, replaying without it is always the right call.
 */
const OPTIONAL_PARAMS = ["response_format", "enable_thinking", "thinking", "reasoning_effort"] as const;

/**
 * fetch wrapper that replays a request once without optional params a provider rejected by name.
 * We attach best-effort fields (JSON mode, thinking toggles) keyed off baseUrl patterns, but a
 * baseUrl cannot know every model served behind it — e.g. a provider that supports
 * `response_format` on chat models 400s on its audio-adjacent ones. The error text names the
 * offending field; dropping exactly the blamed fields keeps the user's request alive.
 */
export function optionalParamRetryFetch(
  baseFetch: typeof fetch = fetch,
): (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const res = await baseFetch(url, init);
    if (res.ok || (res.status !== 400 && res.status !== 422)) return res;
    const sent = typeof init?.body === "string" ? init.body : undefined;
    if (!sent) return res;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(sent) as Record<string, unknown>;
    } catch {
      return res;
    }
    const present = OPTIONAL_PARAMS.filter((p) => parsed[p] !== undefined);
    if (present.length === 0) return res;

    const text = await res.text().catch(() => "");
    // Reading the body consumes it — any give-up path must hand back an equivalent Response.
    const asIs = () => new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    const blamed = present.filter((p) => text.includes(p));
    if (blamed.length === 0) return asIs();
    for (const p of blamed) delete parsed[p];
    return baseFetch(url, { ...init, body: JSON.stringify(parsed) });
  };
}

/**
 * Build an OpenAI-compatible client with this project's shared reliability settings.
 * Free/keyless endpoints (Pollinations, Ollama) accept any non-empty key; the SDK requires one.
 */
export function createLLMClient(config: LLMClientConfig): OpenAI {
  // 402 is only worth retrying on the anonymous shared pool, where it means "the pool ran dry this
  // second". With a real key it means "this key's daily pollen is spent" — that clears tomorrow, not
  // in 5s, so retrying would just make the user wait 15s for the same message.
  const retryFreePool402 = isPollinations(config.baseUrl) && !config.apiKey;
  return new OpenAI({
    // Normalize trailing slashes for OpenAI-compatible endpoints.
    baseURL: config.baseUrl ? normalizeChatBase(config.baseUrl) : config.baseUrl,
    apiKey: config.apiKey || "no-key",
    // SDK default is 2; free/shared endpoints flap enough to be worth one more attempt.
    maxRetries: 3,
    // Cap recovery and optional-param recovery apply everywhere (our params, our problem); the
    // 402 hook only where 402 is genuinely transient. Composed so one wrapper feeds the other.
    fetch: optionalParamRetryFetch(tokenCapRetryFetch(retryFreePool402 ? freePoolRetryFetch() : fetch)),
  });
}

/** HTTP status of a failed call, when the error carries one. */
export function llmErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  return typeof status === "number" && status >= 100 && status < 600 ? status : undefined;
}

/** Provider-supplied detail, trimmed — keeps the original wording available for bug reports. */
function rawDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.replace(/\s+/g, " ").trim().slice(0, 180);
}

/** Bilingual message pair. */
export interface LLMMessagePair {
  zh: string;
  en: string;
}

/**
 * Actionable explanation for an HTTP status from an OpenAI-compatible endpoint.
 * Status-keyed (not error-class-keyed) so the SDK path and the fetch-based connection test in
 * /api/llm/test share exactly one set of wordings. Every branch names the next action, not the failure.
 */
export function explainLLMStatus(status: number | undefined, target: LLMTarget = {}): LLMMessagePair {
  const model = target.model || "?";
  const baseUrl = target.baseUrl || "?";

  if (status === 401 || status === 403) {
    return {
      zh: "API Key 无效或无权限：请到对应平台重新复制 Key，并确认该 Key 已开通这个模型",
      en: "Invalid or unauthorized API key: copy a fresh key from the provider and make sure it can access this model",
    };
  }
  if (status === 402) {
    if (isLegacyPollinations(baseUrl)) {
      return {
        zh: "Pollinations 的免 Key 免费文本接口已停用（现在只会返回 402/502）：请到设置里重新点一次 Pollinations 预设，把地址换成 https://gen.pollinations.ai/v1，并到 https://enter.pollinations.ai/keys 免费注册领 Key 填入；也可改用「Ollama 本地」完全离线免费，或填自己的厂商 Key",
        en: "Pollinations' keyless free text API is retired (it now only returns 402/502): re-apply the Pollinations preset in Settings to switch the endpoint to https://gen.pollinations.ai/v1 and paste a free key from https://enter.pollinations.ai/keys — or switch to local Ollama, or use your own provider key",
      };
    }
    if (isPollinations(baseUrl)) {
      return {
        zh: "Pollinations 额度不足（免费额度按天发放，用完即停）：请到 https://enter.pollinations.ai/keys 查看或领取额度，或改用「Ollama 本地」/ 自己的厂商 Key",
        en: "Pollinations credit exhausted (free pollen is granted daily and stops when spent): check https://enter.pollinations.ai/keys, or switch to local Ollama / your own provider key",
      };
    }
    return {
      zh: "接口返回「需要付费」：该账户余额或额度已用尽，请充值后重试，或在设置里换一个渠道",
      en: "The endpoint returned Payment Required: this account is out of credit — top it up or switch provider in Settings",
    };
  }
  if (status === 404) {
    return {
      zh: `地址或模型名不存在：确认 baseUrl 是否需要以 /v1 结尾，以及模型「${model}」是否在该平台上线`,
      en: `Endpoint or model not found: check whether the baseUrl needs a /v1 suffix and whether model "${model}" exists on this platform`,
    };
  }
  if (status === 413) {
    return {
      zh: "请求内容过大：请减少商品图片数量或缩短描述后重试",
      en: "Request payload too large: use fewer product images or a shorter description",
    };
  }
  if (status === 429) {
    return {
      zh: "触发限流（免费/公共端点很常见）：已自动重试仍失败，请等十几秒再试，或改用自己的 Key / 本地 Ollama",
      en: "Rate limited (common on free/shared endpoints): automatic retries were exhausted — wait a few seconds, or use your own key / local Ollama",
    };
  }
  if (status === 400 || status === 422) {
    // Some backends (Pollinations' azure-openai upstream) report "the completion hit its token cap"
    // as a 400 instead of returning truncated text, so a 400 here often means the model ran out of
    // output room mid-script — telling the user to "try another model name" would be wrong advice.
    if (isTokenCapRejection(target.detail)) {
      return {
        zh: "模型输出长度不够，本次生成中途被打断：请缩短视频时长或减少分镜数量，也可在设置里换一个输出更充裕的模型（免费/公共模型的输出上限通常很小）",
        en: "The model ran out of output budget mid-generation: shorten the video or use fewer shots, or switch to a model with a larger output budget (free/shared models cap output aggressively)",
      };
    }
    return {
      zh: "请求被拒绝（400）：多为模型名填错或该模型不支持本次参数，可换个模型再试",
      en: "Request rejected (400): usually a wrong model name or a parameter this model does not support — try another model",
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      zh: "对方服务暂时不可用（5xx）：已自动重试仍失败，请稍后再试或在设置里换一个渠道",
      en: "The provider is temporarily unavailable (5xx): automatic retries were exhausted — try again later or switch provider in Settings",
    };
  }
  return { zh: "LLM 请求失败", en: "LLM request failed" };
}

/**
 * Turn a provider error into an actionable explanation in both locales.
 * Connection-level failures come from the SDK's typed errors (no HTTP status exists for them);
 * everything else is keyed off the status via explainLLMStatus.
 */
export function explainLLMError(err: unknown, target: LLMTarget = {}): { zh: string; en: string; status?: number } {
  const status = llmErrorStatus(err);
  const detail = rawDetail(err);
  // Match on the untruncated message (providers bury the useful phrase behind a JSON envelope) but
  // still show the trimmed one.
  const full = target.detail ?? (err instanceof Error ? err.message : String(err ?? ""));
  const model = target.model || "?";
  const baseUrl = target.baseUrl || "?";
  const withCtx = ({ zh, en }: LLMMessagePair) => ({
    zh: `${zh}（模型: ${model}，地址: ${baseUrl}）｜原始报错: ${detail}`,
    en: `${en} (model: ${model}, endpoint: ${baseUrl}) | raw: ${detail}`,
    status,
  });

  if (err instanceof APIConnectionTimeoutError) {
    return withCtx({
      zh: "请求超时：网络不稳或该端点响应过慢，请重试；国内访问海外端点建议配置代理",
      en: "Request timed out: unstable network or a slow endpoint — retry, and consider a proxy for overseas endpoints",
    });
  }
  if (err instanceof APIConnectionError) {
    return withCtx({
      zh: "连不上这个 API 地址：请检查网络/代理是否可访问该域名；本地 Ollama 需先启动服务（ollama serve）",
      en: "Cannot reach the API endpoint: check network/proxy access to this host; a local Ollama needs `ollama serve` running",
    });
  }
  return withCtx(explainLLMStatus(status, { ...target, detail: full }));
}

/** Wrap any provider error into an LLMRequestError carrying actionable bilingual text. */
export function toLLMRequestError(err: unknown, target: LLMTarget = {}): LLMRequestError {
  if (err instanceof LLMRequestError) return err;
  const { zh, en, status } = explainLLMError(err, target);
  return new LLMRequestError(zh, en, status, { cause: err });
}

/**
 * Run an LLM call and relabel any provider error with actionable text.
 * No retry loop of our own — the SDK client from `createLLMClient` already retried.
 * User-initiated aborts pass through untouched so callers can tell "cancelled" from "failed".
 */
export async function withLLMErrors<T>(fn: () => Promise<T>, target: LLMClientConfig = {}): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if ((err as { name?: string })?.name === "APIUserAbortError" || (err as { name?: string })?.name === "AbortError") throw err;
    const wrapped = toLLMRequestError(err, target);
    // A wrong model name is the most common misconfiguration and the least self-evident: one extra
    // GET /models turns "model not found" into "here is what this endpoint actually serves". Only on
    // 404, so the happy path and every other failure keep their timing.
    if (wrapped.status === 404 && target.baseUrl) {
      const hint = modelListHint(await listModels(target.baseUrl, target.apiKey || ""), target.model, target.baseUrl);
      if (hint) throw new LLMRequestError(`${wrapped.zh}｜${hint.zh}`, `${wrapped.en} | ${hint.en}`, 404, { cause: err });
    }
    throw wrapped;
  }
}

/**
 * Locale pair for any error thrown out of a generation path: an LLMRequestError keeps its two
 * locales, anything else (parse failures, DB errors) reuses its single message for both.
 * Lets API routes stay one-liners while still answering English clients in English.
 */
export function llmErrorPair(err: unknown): { zh: string; en: string } {
  if (err instanceof LLMRequestError) return { zh: err.zh, en: err.en };
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return { zh: msg, en: msg };
}
