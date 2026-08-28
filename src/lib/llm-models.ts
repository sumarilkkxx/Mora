/**
 * Model discovery for OpenAI-compatible endpoints.
 *
 * Kept dependency-free so both the connection probe and the generation error path can use it without
 * an import cycle. Purpose is narrow: when a model name turns out to be wrong, say which names are
 * right instead of leaving the user to guess (issue #19 follow-up — a local Ollama was serving
 * `qwen2.5:7b-instruct` while the app asked for `qwen2.5`, and all the user ever saw was a 404).
 */

const MODELS_TIMEOUT_MS = 8000;

/** Bilingual text, structurally identical to llm-error's LLMMessagePair (declared here to stay dep-free). */
export interface ModelHint {
  zh: string;
  en: string;
}

export interface ModelListResult {
  models: string[];
  status?: number;
  code?: "NETWORK_BLOCKED" | "TIMEOUT" | "DNS_FAILED" | "CONNECTION_REFUSED" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED" | "BAD_RESPONSE" | "REQUEST_FAILED";
  detail?: string;
}

export type ModelCapability = "text" | "vision";

interface AdvertisedModel {
  id?: unknown;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
}

function isOpenRouter(baseUrl: string): boolean {
  try {
    return /(^|\.)openrouter\.ai$/i.test(new URL(baseUrl).hostname);
  } catch {
    return /openrouter\.ai/i.test(baseUrl);
  }
}

function supportsImageInput(model: AdvertisedModel): boolean | undefined {
  const modalities = model.architecture?.input_modalities;
  if (!Array.isArray(modalities)) return undefined;
  return modalities.some((value) => String(value).toLowerCase() === "image");
}

/** Conservative fallback for compatible services that expose IDs but no capability metadata. */
function looksLikeVisionModel(id: string): boolean {
  return /(^|[\/_:.-])(vision|vl|llava|pixtral|internvl|minicpm-v|glm-4v)([\/_:.-]|$)|qwen[^/]*[-_.]vl|gpt-(4o|4\.1|5)|(^|\/)gemini|(^|\/)claude-(3|sonnet|opus|haiku)/i.test(id);
}

/** Strip trailing slashes so `${base}/models` never doubles up. */
export function normalizeBase(baseUrl: string): string {
  return String(baseUrl).replace(/\/+$/, "");
}

export function normalizeChatBase(baseUrl: string): string {
  return normalizeBase(baseUrl);
}

/** True for a local Ollama endpoint — its model ids carry a `:tag` that must be typed in full. */
export function isOllama(baseUrl?: string): boolean {
  return /:11434(\/|$)|\bollama\b/i.test(baseUrl || "");
}

/**
 * List the model ids an endpoint advertises. Returns [] on any failure: this only ever enriches an
 * existing message, so a dead or missing /models must never become an error of its own.
 */
export async function listModels(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  return (await listModelsDetailed(baseUrl, apiKey, fetchImpl)).models;
}

/** Same discovery request as listModels, but preserves actionable diagnostics for Settings. */
export async function listModelsDetailed(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  capability: ModelCapability = "text",
): Promise<ModelListResult> {
  try {
    const base = normalizeChatBase(baseUrl);
    // OpenRouter officially supports modality filters. Other OpenAI-compatible
    // endpoints may reject them, so those are filtered locally below.
    const query = capability === "vision" && isOpenRouter(base)
      ? "?input_modalities=image&output_modalities=text"
      : "";
    const res = await fetchImpl(`${base}/models${query}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!res.ok) {
      const code = res.status === 401 ? "UNAUTHORIZED"
        : res.status === 403 ? "FORBIDDEN"
          : res.status === 404 ? "NOT_FOUND"
            : res.status === 429 ? "RATE_LIMITED"
              : "BAD_RESPONSE";
      const detail = await res.text().catch(() => "");
      return { models: [], status: res.status, code, detail: detail.replace(/\s+/g, " ").slice(0, 240) };
    }
    const json = (await res.json()) as { data?: AdvertisedModel[] };
    if (!Array.isArray(json?.data)) return { models: [], code: "BAD_RESPONSE" };
    let advertised = json.data.filter((model) => typeof model?.id === "string");
    if (capability === "vision") {
      const hasCapabilityMetadata = advertised.some((model) => supportsImageInput(model) !== undefined);
      advertised = advertised.filter((model) => {
        const supported = supportsImageInput(model);
        return supported !== undefined ? supported : !hasCapabilityMetadata && looksLikeVisionModel(String(model.id));
      });
    }
    return { models: advertised.map((model) => String(model.id)) };
  } catch (error) {
    const e = error as Error & { cause?: { code?: string } };
    const causeCode = e.cause?.code ?? "";
    const message = e.message || "";
    const code = e.name === "TimeoutError" || /timed? out|timeout/i.test(message) ? "TIMEOUT"
      : causeCode === "EACCES" || /access.*socket|访问套接字|权限不允许/i.test(message) ? "NETWORK_BLOCKED"
        : causeCode === "ENOTFOUND" || /getaddrinfo|name.*resolved/i.test(message) ? "DNS_FAILED"
          : causeCode === "ECONNREFUSED" || /refused/i.test(message) ? "CONNECTION_REFUSED"
            : "REQUEST_FAILED";
    return { models: [], code, detail: message.slice(0, 240) };
  }
}

/**
 * Turn "model not found" into something actionable: name the models the endpoint really has, and —
 * the common local-Ollama case — point at the pulled tag when the typed name is a prefix of it.
 */
export function modelListHint(models: string[], wanted?: string, baseUrl?: string): ModelHint | undefined {
  if (models.length === 0) {
    return isOllama(baseUrl)
      ? {
          zh: "（本机 Ollama 一个模型都没读到：先在终端跑 `ollama pull qwen2.5`，并确认 Ollama 正在运行）",
          en: "(no models found on this local Ollama: run `ollama pull qwen2.5` and make sure Ollama is running)",
        }
      : undefined;
  }

  const wantedLower = wanted?.toLowerCase();
  const guess = wantedLower
    ? models.find((m) => m.toLowerCase().startsWith(`${wantedLower}:`)) ||
      models.find((m) => m.toLowerCase().includes(wantedLower))
    : undefined;

  const shown = models.slice(0, 8);
  const list = `${shown.join("、")}${models.length > shown.length ? `…（共 ${models.length} 个）` : ""}`;
  const listEn = `${shown.join(", ")}${models.length > shown.length ? `… (${models.length} total)` : ""}`;
  const tagNote = isOllama(baseUrl) ? "（Ollama 的模型名必须写全，含 :tag）" : "";
  const tagNoteEn = isOllama(baseUrl) ? " (Ollama model names must include the :tag)" : "";

  return {
    zh: `${guess ? `是不是想填「${guess}」？` : ""}该地址实际可用的模型：${list}${tagNote}`,
    en: `${guess ? `Did you mean "${guess}"? ` : ""}Models this endpoint actually exposes: ${listEn}${tagNoteEn}`,
  };
}
