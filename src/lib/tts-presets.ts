/**
 * Paid TTS platform presets (pure data, shared between client and server, no server-only dependencies).
 *
 * Unified "platform" dropdown: OpenAI-compatible / MiniMax official API.
 * Each platform uses its own key in the TTS settings section.
 * Each platform provides default baseUrl/model/voice so the UI can conditionally render fields
 * and offer voice suggestions accordingly.
 */

export type TTSProvider = "openai" | "minimax";

export interface TTSVoiceOption {
  value: string;
  label: string;
  labelEn?: string;
}

export interface TTSProviderMeta {
  value: TTSProvider;
  label: string;
  labelEn?: string;
  /** Default baseUrl for this platform's TTS endpoint */
  baseUrl: string;
  /** Default model id */
  defaultModel: string;
  /** Available models (empty means free-form input, e.g. OpenAI-compatible) */
  models: TTSVoiceOption[];
  /** Default voice id */
  defaultVoice: string;
  /** Suggested voice list */
  voices: TTSVoiceOption[];
  /**
   * Key source:
   * - "tts": use the apiKey stored in the TTS config itself
   */
  keySource: "tts";
  /** Whether a GroupId is required (needed for the MiniMax domestic endpoint api.minimax.chat) */
  needsGroupId?: boolean;
  /** Whether to expose a baseUrl input field (OpenAI-compatible and MiniMax support switching regional endpoints) */
  editableBaseUrl?: boolean;
  /** Configuration hint shown in the UI */
  hint?: string;
  hintEn?: string;
}

/** OpenAI-compatible quick presets (one click populates baseUrl + model + voice) */
export const OPENAI_TTS_PRESETS = [
  { label: "硅基流动 CosyVoice", labelEn: "SiliconFlow CosyVoice", baseUrl: "https://api.siliconflow.cn/v1", model: "FunAudioLLM/CosyVoice2-0.5B", voice: "FunAudioLLM/CosyVoice2-0.5B:alex" },
  { label: "OpenAI tts-1", baseUrl: "https://api.openai.com/v1", model: "tts-1", voice: "alloy" },
  { label: "火山方舟", labelEn: "Volcengine Ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-tts", voice: "zh_female_cancan" },
];

export const TTS_PROVIDERS: TTSProviderMeta[] = [
  {
    value: "openai",
    label: "OpenAI 兼容 (/audio/speech)",
    labelEn: "OpenAI-compatible (/audio/speech)",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "FunAudioLLM/CosyVoice2-0.5B",
    models: [],
    defaultVoice: "FunAudioLLM/CosyVoice2-0.5B:alex",
    voices: [],
    keySource: "tts",
    editableBaseUrl: true,
    hint: "兼容 OpenAI tts-1、硅基流动 CosyVoice、火山方舟等所有 /audio/speech 端点。",
    hintEn: "Works with OpenAI tts-1, SiliconFlow CosyVoice, Volcengine Ark, and other /audio/speech endpoints.",
  },
  {
    value: "minimax",
    label: "MiniMax 海螺 (T2A v2)",
    labelEn: "MiniMax Hailuo (T2A v2)",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "speech-2.6-hd",
    models: [
      { value: "speech-2.6-hd", label: "speech-2.6-hd（高保真）", labelEn: "speech-2.6-hd (high fidelity)" },
      { value: "speech-2.6-turbo", label: "speech-2.6-turbo（快速）", labelEn: "speech-2.6-turbo (fast)" },
      { value: "speech-2.5-hd", label: "speech-2.5-hd" },
    ],
    defaultVoice: "female-tianmei",
    voices: [
      { value: "female-tianmei", label: "甜美女声（默认）", labelEn: "Warm female (default)" },
      { value: "female-shaonv", label: "少女音", labelEn: "Young female" },
      { value: "female-yujie", label: "御姐音", labelEn: "Confident female" },
      { value: "female-chengshu", label: "成熟女声", labelEn: "Mature female" },
      { value: "presenter_female", label: "女主持人", labelEn: "Female presenter" },
      { value: "presenter_male", label: "男主持人", labelEn: "Male presenter" },
      { value: "male-qn-qingse", label: "青涩青年（男）", labelEn: "Young male" },
      { value: "male-qn-jingying", label: "精英青年（男）", labelEn: "Professional male" },
      { value: "audiobook_female_1", label: "有声书女声", labelEn: "Female audiobook narrator" },
    ],
    keySource: "tts",
    needsGroupId: true,
    editableBaseUrl: true,
    hint: "海螺开放平台的 API Key + GroupId。国际版改 baseUrl 为 https://api.minimax.io/v1（可不填 GroupId）。",
    hintEn: "Use your Hailuo API Key and GroupId. For the international API, set the base URL to https://api.minimax.io/v1; GroupId is optional.",
  },
];

export const DEFAULT_TTS_PROVIDER: TTSProvider = "openai";

/** Get platform metadata (with fallback: unknown/legacy config falls back to openai) */
export function getTTSProviderMeta(provider?: string | null): TTSProviderMeta {
  return TTS_PROVIDERS.find((p) => p.value === provider) ?? TTS_PROVIDERS[0];
}

/** Minimal input shape required when resolving TTS config (avoids circular dependency with store types) */
interface TTSSettingLike {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  speed?: number;
  groupId?: string;
}
type ProvidersLike = Record<string, { apiKey?: string; baseUrl?: string } | undefined>;

/** Fully resolved TTS config used for actual requests / preview playback */
export interface ResolvedTTSConfig {
  provider: TTSProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  speed?: number;
  groupId?: string;
}

/**
 * Resolves the platform selection into a complete TTS config
 * ready to send to the backend.
 */
export function resolveTTSConfig(tts: TTSSettingLike | undefined, _providers: ProvidersLike): ResolvedTTSConfig {
  const meta = getTTSProviderMeta(tts?.provider);
  // baseUrl: for editable platforms use the user-provided value (fall back to default if blank); otherwise force the platform default
  const baseUrl = meta.editableBaseUrl ? (tts?.baseUrl || meta.baseUrl) : meta.baseUrl;
  const apiKey = tts?.apiKey || "";
  return {
    provider: meta.value,
    baseUrl,
    apiKey,
    model: tts?.model || meta.defaultModel,
    voice: tts?.voice || meta.defaultVoice,
    ...(tts?.speed != null && { speed: tts.speed }),
    ...(meta.value === "minimax" && tts?.groupId ? { groupId: tts.groupId } : {}),
  };
}

/** Whether paid TTS is ready (switch enabled + resolved key/model/voice all present) */
export function isPaidTTSReady(tts: TTSSettingLike | undefined, providers: ProvidersLike): boolean {
  if (!tts?.enabled) return false;
  const c = resolveTTSConfig(tts, providers);
  return Boolean(c.apiKey && c.baseUrl && c.model && c.voice);
}
