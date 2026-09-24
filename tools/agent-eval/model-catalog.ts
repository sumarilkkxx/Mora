import type { ModelPrice } from "./core/types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const CATALOG_TIMEOUT_MS = 10_000;

interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  supported_parameters?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
    input_cache_read?: unknown;
  };
}

export interface EvaluationModelChoice {
  id: string;
  name: string;
  inputModalities: string[];
  outputModalities: string[];
  toolCalling: boolean;
  price: ModelPrice;
}

export interface EvaluationModelCatalog {
  provider: "OpenRouter";
  baseUrl: typeof OPENROUTER_BASE_URL;
  fetchedAt: string;
  text: EvaluationModelChoice[];
  vision: EvaluationModelChoice[];
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).map(item => item.toLowerCase()) : [];
}

function perMillion(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`OpenRouter returned an invalid ${label} price`);
  return Math.round(parsed * 1_000_000 * 1_000_000_000) / 1_000_000_000;
}

function choice(model: OpenRouterModel, fetchedAt: string): EvaluationModelChoice | undefined {
  if (typeof model.id !== "string" || !model.id.trim()) return;
  const inputModalities = strings(model.architecture?.input_modalities);
  const outputModalities = strings(model.architecture?.output_modalities);
  if (!inputModalities.includes("text") || !outputModalities.includes("text")) return;
  let price: ModelPrice;
  try {
    price = {
      inputUsdPerMillionTokens: perMillion(model.pricing?.prompt, "prompt"),
      outputUsdPerMillionTokens: perMillion(model.pricing?.completion, "completion"),
      ...(model.pricing?.input_cache_read === undefined
        ? {}
        : { cachedInputUsdPerMillionTokens: perMillion(model.pricing.input_cache_read, "cached input") }),
      source: `${OPENROUTER_BASE_URL}/models`,
      effectiveAt: fetchedAt,
    };
  } catch {
    return;
  }
  return {
    id: model.id,
    name: typeof model.name === "string" && model.name.trim() ? model.name : model.id,
    inputModalities,
    outputModalities,
    toolCalling: strings(model.supported_parameters).includes("tools"),
    price,
  };
}

export async function loadEvaluationModelCatalog(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<EvaluationModelCatalog> {
  if (!apiKey.trim()) throw new Error("OpenRouter API Key is required");
  const response = await fetchImpl(`${OPENROUTER_BASE_URL}/models?output_modalities=text`, {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
    if (response.status === 401) throw new Error("OpenRouter API Key 未通过验证（401）");
    if (response.status === 403) throw new Error("当前 OpenRouter API Key 无权读取模型列表（403）");
    throw new Error(`OpenRouter 模型列表请求失败（${response.status}）${detail ? `：${detail}` : ""}`);
  }
  const payload = await response.json() as { data?: OpenRouterModel[] };
  if (!Array.isArray(payload.data)) throw new Error("OpenRouter 模型列表格式无效");
  const fetchedAt = new Date().toISOString();
  const available = payload.data.map(model => choice(model, fetchedAt)).filter((model): model is EvaluationModelChoice => Boolean(model));
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const text = available.filter(model => model.toolCalling).sort((a, b) => collator.compare(a.name, b.name));
  const vision = available.filter(model => model.inputModalities.includes("image")).sort((a, b) => collator.compare(a.name, b.name));
  if (!text.length) throw new Error("OpenRouter 没有返回可计价且支持工具调用的文本模型");
  if (!vision.length) throw new Error("OpenRouter 没有返回可计价的视觉理解模型");
  return { provider: "OpenRouter", baseUrl: OPENROUTER_BASE_URL, fetchedAt, text, vision };
}

export function selectedEvaluationPrices(catalog: EvaluationModelCatalog, textModel: string, visionModel: string) {
  const text = catalog.text.find(model => model.id === textModel);
  const vision = catalog.vision.find(model => model.id === visionModel);
  if (!text) throw new Error(`文本模型不在当前可评测目录中：${textModel}`);
  if (!vision) throw new Error(`视觉模型不在当前可评测目录中：${visionModel}`);
  return { [text.id]: text.price, [vision.id]: vision.price };
}

export { OPENROUTER_BASE_URL };
