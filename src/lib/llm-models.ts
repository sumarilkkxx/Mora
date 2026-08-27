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
  try {
    const res = await fetchImpl(`${normalizeChatBase(baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(json?.data)) return [];
    return json.data.map((m) => (typeof m?.id === "string" ? m.id : "")).filter(Boolean);
  } catch {
    return [];
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
