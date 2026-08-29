import type { LLMConfig } from "@/lib/script-engine/generator";

export type OpenRouterFallbackCapability = "text" | "vision";

export function isOpenRouterEndpoint(baseUrl?: string): boolean {
  return /openrouter\.ai/i.test(baseUrl || "");
}

/** True only for OpenRouter's provider-policy refusal, not every HTTP 403. */
export function isOpenRouterPolicyRejection(error: unknown, baseUrl?: string): boolean {
  if (!isOpenRouterEndpoint(baseUrl)) return false;
  const status = (error as { status?: unknown })?.status;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return status === 403 && /terms?\s+of\s+service|terms?\s+of\s+use|provider terms|policy violation|content policy|safety policy|request is prohibited|服务条款拦截/i.test(message);
}

export function openRouterPolicyFallbackConfig(
  config: LLMConfig,
  capability: OpenRouterFallbackCapability,
): LLMConfig | null {
  if (!isOpenRouterEndpoint(config.baseUrl)) return null;
  const activeModel = capability === "vision" ? (config.visionModel || config.model) : config.model;
  const fallbackModel = capability === "vision"
    ? (config.fallbackVisionModel || config.fallbackModel)
    : config.fallbackModel;
  if (!fallbackModel?.trim() || fallbackModel.trim() === activeModel) return null;
  return capability === "vision"
    ? { ...config, visionModel: fallbackModel.trim() }
    : { ...config, model: fallbackModel.trim() };
}
