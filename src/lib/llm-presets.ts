/**
 * One-click LLM presets shown in Settings.
 *
 * Extracted from the settings page so the endpoints are unit-testable: a preset that ships a dead
 * endpoint silently bricks the whole app for anyone who clicks it (issue #19 — Pollinations retired
 * its keyless text API, and every new install that picked that preset failed with a bare 402).
 *
 * `tipKey` is an i18n message key resolved at render time; `apiKey` pre-fills a placeholder only for
 * endpoints that genuinely ignore the key (local Ollama). Never pre-fill a placeholder for an endpoint
 * that requires a real key — it disguises "not configured" as "configured".
 */
export interface LLMPreset {
  label: string;
  /** English display name when it differs from the domestic brand label. */
  labelEn?: string;
  baseUrl: string;
  model: string;
  /** i18n key for the short tip shown next to the label (empty = no tip) */
  tipKey?: string;
  /** placeholder key for keyless endpoints only */
  apiKey?: string;
}

export const LLM_PRESETS: LLMPreset[] = [
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o", tipKey: "presetOpenrouterTip" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", tipKey: "presetDeepseekTip" },
  { label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.5", tipKey: "presetKimiTip" },
  { label: "智谱 GLM", labelEn: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5-turbo", tipKey: "presetGlmTip" },
  { label: "MiniMax", baseUrl: "https://api.minimax.chat/v1", model: "MiniMax-M2.7", tipKey: "presetMinimaxTip" },
  { label: "豆包", labelEn: "Doubao", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2-0-pro-260215", tipKey: "presetDoubaoTip" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4" },
  // 127.0.0.1 rather than localhost: on Windows, localhost resolves to ::1 first while Ollama binds
  // 127.0.0.1 only, so the hostname form can fail to connect for reasons the user cannot see.
  // The model must match a pulled tag exactly — `ollama pull qwen2.5` installs exactly this id.
  { label: "Ollama 本地", labelEn: "Local Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5", tipKey: "presetOllamaTip", apiKey: "ollama" },
  // Pollinations 迁到了 gen.pollinations.ai 并改为「注册领每日免费额度」；旧的免 Key 地址
  // text.pollinations.ai 现已只返回 402/502（issue #19），因此也不再预填占位 Key
  { label: "Pollinations", baseUrl: "https://gen.pollinations.ai/v1", model: "openai-fast", tipKey: "presetPollinationsTip" },
];
