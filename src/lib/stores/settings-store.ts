import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { DEFAULT_TTS_PROVIDER, type TTSProvider } from "@/lib/tts-presets";
import {
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_VIDEO_PARAMS,
  type CustomModel,
  type ImageGenParams,
  type VideoGenParams,
} from "@/lib/gen-params";
import type { MotionIntensity, MotionRealismTier } from "@/lib/motion-prompt";
import {
  isProductionProfileId,
  productionProfilePatch,
  type ProductionProfileId,
} from "@/lib/production-profiles";

// AI Provider 配置
export interface ProviderSetting {
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
}

// LLM 配置
export interface LLMSetting {
  provider: string; // 自定义名称
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel?: string; // 视觉分析模型
}

// TTS 配音配置（OpenAI 兼容 / MiniMax 官方 API）
export interface TTSSetting {
  enabled: boolean;
  /** 平台，缺省 "openai"（旧配置无此字段时按 openai 处理） */
  provider?: TTSProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  speed?: number;
  /** MiniMax 国内端点的 GroupId（可选） */
  groupId?: string;
}

export interface SettingsState {
  // AI 平台配置
  providers: Record<string, ProviderSetting>;
  // LLM 配置
  llm: LLMSetting;
  // TTS 配音配置
  tts: TTSSetting;
  // 默认生图模型
  defaultImageModel: string;
  // 默认生视频模型
  defaultVideoModel: string;
  // 默认分辨率
  defaultResolution: "720p" | "1080p";
  // 默认画面比例
  defaultAspectRatio: "9:16" | "16:9" | "1:1";
  // 用户自定义模型（挂在已有平台上的任意 model id）
  customModels: CustomModel[];
  // 图片生成全局默认参数
  imageParams: ImageGenParams;
  // 视频生成全局默认参数
  videoParams: VideoGenParams;
  // i2v 运镜强度档位（轻/中/强，作用于 motion prompt 的运镜幅度措辞）
  motionIntensity: MotionIntensity;
  // i2v 物理真实感层档位（auto=全层默认 / constraints=仅品类约束 / off=关闭）
  motionRealism: MotionRealismTier;
  // i2v 接缝模式（pin=下一镜关键帧钉尾帧[默认] / tail=用上一镜真实尾帧当首帧续拍 / off=不链）
  chainMode: "pin" | "tail" | "off";
  // 全局画面风格 Look（look-presets.ts 预设 id，"none"=不加；同时注入生图 prompt 与 i2v 光线锚点）
  visualLook: string;
  // UI complexity mode: "simple" keeps only the happy path (beginner default),
  // "pro" reveals the director panel, per-shot camera tools, template workshop etc.
  uiMode: "simple" | "pro";
  // 面向创作目标的当前生产方案（原子更新下方 provider-agnostic 参数）
  activeProductionProfile: ProductionProfileId;
  // 界面语言（首次按系统语言自动判定，可手动切换）
  locale: Locale;
  // 语言来源：auto=跟随系统语言自动判定，user=用户手动选过（不再自动覆盖）
  localeSource: "auto" | "user";

  // Actions
  setLocale: (locale: Locale) => void;
  // 自动判定结果应用（仅在 localeSource==="auto" 时由初始化器调用，不改变 source）
  applyAutoLocale: (locale: Locale) => void;
  setProvider: (name: string, setting: ProviderSetting) => void;
  setLLM: (llm: LLMSetting) => void;
  setTTS: (tts: TTSSetting) => void;
  setDefaultImageModel: (model: string) => void;
  setDefaultVideoModel: (model: string) => void;
  setDefaultResolution: (resolution: "720p" | "1080p") => void;
  setDefaultAspectRatio: (ratio: "9:16" | "16:9" | "1:1") => void;
  addCustomModel: (model: CustomModel) => void;
  removeCustomModel: (id: string) => void;
  setImageParams: (params: ImageGenParams) => void;
  setVideoParams: (params: VideoGenParams) => void;
  setMotionIntensity: (intensity: MotionIntensity) => void;
  setMotionRealism: (tier: MotionRealismTier) => void;
  setChainMode: (mode: "pin" | "tail" | "off") => void;
  setVisualLook: (look: string) => void;
  setUiMode: (mode: "simple" | "pro") => void;
  applyProductionProfile: (profile: ProductionProfileId) => void;
}

/** Pollinations 的新端点（旧的 text.pollinations.ai 免 Key 接口已停用） */
const POLLINATIONS_BASE_URL = "https://gen.pollinations.ai/v1";

/**
 * 持久化设置的版本迁移（纯函数，可单测）。
 *
 * v1：清洗历史版本预设写入的失效模型名（旧预设填过不存在的模型 ID，"测试连接"只验 Key
 * 不验模型名所以一直显示正常，直到生成脚本才报 Model Not Exist——issue #12 用户即此场景）。
 * 只在 baseUrl 匹配对应官方端点时改写，避免误伤自建代理上的同名自定义模型。
 *
 * v2：Pollinations 免 Key 免费文本接口（text.pollinations.ai/openai）已停用，实测只返回
 * 402/502（issue #19：用户装完选 Pollinations，一生成就报 402 Payment Required，Mac/Win 都一样）。
 * 把地址迁到官方新端点 gen.pollinations.ai/v1，并清掉老预设写入的占位 Key "pollinations"——
 * 新端点必须用注册领取的真 Key，留着占位值只会把 401 伪装成"已配置"。清空后设置页会明确提示填 Key。
 *
 * v3：Ollama 预设的 localhost 改成 127.0.0.1。Windows 上 localhost 会先解析到 ::1，而 Ollama 默认
 * 只监听 127.0.0.1，用户会看到一个无从排查的"连不上"（issue #19 追问）。同端口同机，改写无副作用。
 *
 * v6：清理已经下线的 Provider、模型和 TTS 配置，防止旧 localStorage 继续调用已移除的平台。
 */
export function migrateSettings(state: SettingsState): SettingsState {
  const llm = state?.llm;
  if (llm?.baseUrl) {
    const fixes: Array<{ hostRe: RegExp; from: string; to: string }> = [
      { hostRe: /api\.deepseek\.com/i, from: "deepseek-v3.2", to: "deepseek-v4-flash" },
      { hostRe: /volces\.com/i, from: "doubao-seed-2.0-pro", to: "doubao-seed-2-0-pro-260215" },
    ];
    for (const f of fixes) {
      if (!f.hostRe.test(llm.baseUrl)) continue;
      if (llm.model === f.from) llm.model = f.to;
      if (llm.visionModel === f.from) llm.visionModel = f.to;
    }

    if (/text\.pollinations\.ai/i.test(llm.baseUrl)) {
      llm.baseUrl = POLLINATIONS_BASE_URL;
      if (llm.apiKey === "pollinations") llm.apiKey = "";
    }

    llm.baseUrl = llm.baseUrl.replace(/^(https?:\/\/)localhost(:11434\b)/i, "$1127.0.0.1$2");
  }
  if (!isProductionProfileId(state?.activeProductionProfile)) {
    state.activeProductionProfile = "balanced";
  }
  // v6: removed providers must also be removed from persisted browser state.
  const removedConfigured = Boolean(state.providers?.["atlas-cloud"]?.enabled || state.providers?.["fal-ai"]?.enabled);
  if (state.providers) {
    delete state.providers["atlas-cloud"];
    delete state.providers["fal-ai"];
  }
  state.customModels = (state.customModels ?? []).filter(
    (model) => model.provider !== "atlas-cloud" && model.provider !== "fal-ai"
  );
  if (/atlascloud\.ai/i.test(state.llm?.baseUrl ?? "")) {
    state.llm = { provider: "", baseUrl: "", apiKey: "", model: "", visionModel: "" };
  }
  const legacyTtsProvider = String(state.tts?.provider ?? "");
  if (legacyTtsProvider === "atlas" || legacyTtsProvider === "falai") {
    state.tts = { enabled: false, provider: DEFAULT_TTS_PROVIDER, baseUrl: "", apiKey: "", model: "", voice: "", speed: 1 };
  }
  if (removedConfigured && state.defaultImageModel === "openai/gpt-image-2/text-to-image") state.defaultImageModel = "";
  if (removedConfigured && state.defaultVideoModel === "bytedance/seedance-2.0/text-to-video") state.defaultVideoModel = "";
  return state;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      providers: {
        replicate: { enabled: false, apiKey: "" },
        volcengine: { enabled: false, apiKey: "" },
        alibaba: { enabled: false, apiKey: "" },
        siliconflow: { enabled: false, apiKey: "" },
        openai: { enabled: false, apiKey: "" },
        openrouter: { enabled: false, apiKey: "" },
      },
      llm: {
        provider: "",
        baseUrl: "",
        apiKey: "",
        model: "",
        visionModel: "",
      },
      tts: {
        enabled: false,
        provider: DEFAULT_TTS_PROVIDER,
        baseUrl: "",
        apiKey: "",
        model: "",
        voice: "",
        speed: 1,
      },
      defaultImageModel: "",
      defaultVideoModel: "",
      defaultResolution: "1080p",
      defaultAspectRatio: "9:16",
      customModels: [],
      imageParams: DEFAULT_IMAGE_PARAMS,
      videoParams: DEFAULT_VIDEO_PARAMS,
      motionIntensity: "normal",
      motionRealism: "auto",
      chainMode: "pin",
      visualLook: "none",
      uiMode: "simple",
      activeProductionProfile: "balanced",
      locale: DEFAULT_LOCALE,
      localeSource: "auto",

      // 用户手动切换：记为 user，之后不再被自动判定覆盖
      setLocale: (locale) => set({ locale, localeSource: "user" }),
      // 自动判定应用：保持 source=auto，跟随系统语言
      applyAutoLocale: (locale) => set({ locale }),
      setProvider: (name, setting) =>
        set((state) => ({
          providers: { ...state.providers, [name]: setting },
        })),
      setLLM: (llm) => set({ llm }),
      setTTS: (tts) => set({ tts }),
      setDefaultImageModel: (model) => set({ defaultImageModel: model }),
      setDefaultVideoModel: (model) => set({ defaultVideoModel: model }),
      setDefaultResolution: (resolution) => set({ defaultResolution: resolution }),
      setDefaultAspectRatio: (ratio) => set({ defaultAspectRatio: ratio }),
      addCustomModel: (model) =>
        set((state) => ({ customModels: [...state.customModels, model] })),
      removeCustomModel: (id) =>
        set((state) => ({ customModels: state.customModels.filter((m) => m.id !== id) })),
      setImageParams: (params) => set({ imageParams: params }),
      setVideoParams: (params) => set({ videoParams: params }),
      setMotionIntensity: (intensity) => set({ motionIntensity: intensity }),
      setMotionRealism: (tier) => set({ motionRealism: tier }),
      setChainMode: (mode) => set({ chainMode: mode }),
      setVisualLook: (look) => set({ visualLook: look }),
      setUiMode: (mode) => set({ uiMode: mode }),
      applyProductionProfile: (profile) =>
        set((state) => productionProfilePatch(profile, state)),
    }),
    {
      name: "daihuo-jianshou-settings",
      // v1：清洗历史版本预设写入的失效模型名（旧预设填过不存在的模型 ID，"测试连接"只验 Key
      // 不验模型名所以一直显示正常，直到生成脚本才报 Model Not Exist——issue #12 用户即此场景）。
      // 只在 baseUrl 匹配对应官方端点时改写，避免误伤自建代理上的同名自定义模型。
      // v2：把已停用的 Pollinations 免 Key 地址迁到新端点（见 migrateSettings 注释）。
      // v3：Ollama 的 localhost:11434 改写成 127.0.0.1:11434（Windows 上 ::1 连不通）。
      // v4：补充面向创作目标的生产方案；旧设置迁移到兼顾质量与成本的 balanced。
      // v5：历史兼容版本。
      // v6：移除 Atlas Cloud / fal.ai 及其遗留的本地配置。
      version: 6,
      migrate: (persisted) => migrateSettings(persisted as SettingsState),
    }
  )
);
