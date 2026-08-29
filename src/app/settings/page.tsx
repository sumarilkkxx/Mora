"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LuUpload, LuPalette } from "react-icons/lu";
import { Check, CheckCircle2, CircleAlert, WifiOff } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useBrandStore } from "@/lib/stores/brand-store";
import {
  TTS_PROVIDERS,
  OPENAI_TTS_PRESETS,
  getTTSProviderMeta,
  resolveTTSConfig,
  isPaidTTSReady,
  type TTSProvider,
} from "@/lib/tts-presets";
import { mergeCustomModels } from "@/lib/gen-params";
import { getVideoModelCapabilities, resolveModelResolution } from "@/lib/model-capabilities";
import { ATLAS_VIDEO_FAMILIES } from "@/lib/atlas-video-models";
import { LLM_PRESETS } from "@/lib/llm-presets";
import { GroupedModelSelect, ModelPicker } from "@/components/settings/model-picker";
import { GenerationSettings } from "@/components/generation-settings";
import { PresenterManager } from "@/components/presenter-manager";
import { PageFrame, PageHeader } from "@/components/studio/page";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";

// default resolution options
const resolutionOptions = [
  { value: "720p", label: "720p (1280x720)" },
  { value: "1080p", label: "1080p (1920x1080)" },
];

// default aspect ratio options (labelKey is rendered per language inside the component)
const aspectRatioOptions = [
  { value: "9:16", labelKey: "aspect916" },
  { value: "16:9", labelKey: "aspect169" },
  { value: "1:1", labelKey: "aspect11" },
];

// Settings sections, in display order (id doubles as the ?tab= value)
const SETTINGS_SECTIONS = [
  { id: "providers", labelKey: "tabProviders" },
  { id: "llm", labelKey: "tabLlm" },
  { id: "image", labelKey: "tabImage" },
  { id: "video", labelKey: "tabVideo" },
  { id: "tts", labelKey: "tabTts" },
  { id: "characters", labelKey: "tabCharacters" },
  { id: "brand", labelKey: "tabBrand" },
];
const SETTINGS_TABS: string[] = SETTINGS_SECTIONS.map((s) => s.id);

// AI platform configuration list
const AI_PROVIDERS = [
  {
    key: "atlas-cloud",
    name: "Atlas Cloud",
    descKey: "providerAtlasCloudDesc",
    tipKey: "providerAtlasCloudTip",
    logo: "/provider-logos/atlascloud.svg",
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    descKey: "providerOpenrouterDesc",
    tipKey: "providerOpenrouterTip",
    logo: "/provider-logos/openrouter.svg",
  },
  {
    key: "replicate",
    name: "Replicate",
    descKey: "providerReplicateDesc",
    tipKey: "providerReplicateTip",
    logo: "/provider-logos/replicate.svg",
  },
  {
    key: "volcengine",
    name: "火山引擎",
    descKey: "providerVolcengineDesc",
    tipKey: "providerVolcengineTip",
    logo: "/provider-logos/volcengine.svg",
  },
  {
    key: "alibaba",
    name: "阿里百炼",
    descKey: "providerAlibabaDesc",
    tipKey: "providerAlibabaTip",
    logo: "/provider-logos/alibabacloud.svg",
  },
  {
    key: "siliconflow",
    name: "硅基流动",
    descKey: "providerSiliconflowDesc",
    tipKey: "providerSiliconflowTip",
    logo: "/provider-logos/siliconcloud.svg",
  },
  {
    key: "openai",
    name: "OpenAI",
    descKey: "providerOpenaiDesc",
    tipKey: "providerOpenaiTip",
    logo: "/provider-logos/openai.svg",
  },
];

// Map Chinese vendor names by key to i18n display names (English users would otherwise see hard-coded Chinese like "火山引擎/阿里百炼/硅基流动").
// Only overrides vendors with Chinese names; others already use English brand names and use platform.name directly.
// Note: platform.name is still used as the identity for enabledNames custom model filtering, so we only change the display, not name.
const PROVIDER_NAME_KEYS: Record<string, string> = {
  volcengine: "providerVolcengineName",
  alibaba: "providerAlibabaName",
  siliconflow: "providerSiliconflowName",
};

// password input field with show/hide toggle
function PasswordInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${className ?? ""}`}>
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 font-mono text-xs"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        aria-label={visible ? "Hide API key" : "Show API key"}
        title={visible ? "Hide API key" : "Show API key"}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {visible ? (
          // hide icon
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          </svg>
        ) : (
          // show icon
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

// custom toggle switch component
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />;
}

export default function SettingsPage() {
  const t = useT("settings");
  const locale = useLocale();
  // read settings from store
  const {
    providers,
    llm,
    tts,
    defaultResolution,
    defaultAspectRatio,
    defaultImageModel,
    defaultImageProvider,
    defaultVideoModel,
    defaultVideoProvider,
    customModels,
    setProvider,
    setLLM,
    setTTS,
    setDefaultResolution,
    setDefaultAspectRatio,
    setDefaultImageModel,
    setDefaultVideoModel,
  } = useSettingsStore();

  // TTS preview playback state
  const [ttsTestStatus, setTtsTestStatus] = useState<"idle" | "testing" | "error">("idle");
  const testTTS = async () => {
    setTtsTestStatus("testing");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // send the fully resolved config (including per-platform reused Key / default baseUrl / model)
        body: JSON.stringify({ text: t("ttsSample"), ttsConfig: resolveTTSConfig(tts, providers) }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      new Audio(URL.createObjectURL(blob)).play();
      setTtsTestStatus("idle");
    } catch {
      setTtsTestStatus("error");
    }
  };

  // AI platform key connectivity test (real auth probe, not a fake test)
  const [providerTest, setProviderTest] = useState<Record<string, { state: "idle" | "testing" | "ok" | "invalid" | "unknown"; msg?: string }>>({});
  const testProvider = async (key: string) => {
    const p = providers[key];
    if (!p?.apiKey) return;
    setProviderTest((s) => ({ ...s, [key]: { state: "testing" } }));
    try {
      const res = await fetch("/api/ai/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: key, apiKey: p.apiKey, baseUrl: p.baseUrl }),
      });
      const data = await res.json();
      setProviderTest((s) => ({ ...s, [key]: { state: data.status ?? "unknown", msg: data.message } }));
    } catch {
      setProviderTest((s) => ({ ...s, [key]: { state: "unknown", msg: t("connectFailed") } }));
    }
  };

  // TTS provider metadata / ready state / reset model, voice, and baseUrl to provider defaults when switching providers
  const ttsMeta = getTTSProviderMeta(tts.provider);
  const ttsReady = isPaidTTSReady(tts, providers);
  const onChangeTTSProvider = (provider: TTSProvider) => {
    const meta = getTTSProviderMeta(provider);
    setTTS({ ...tts, provider, baseUrl: meta.baseUrl, model: meta.defaultModel, voice: meta.defaultVoice });
  };

  // save feedback state

  // available model list (fetched from backend aggregated by enabled providers)
  const [imageModels, setImageModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [videoModels, setVideoModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // providers that are enabled and have an API key (used to fetch model list)
  const enabledProviders = Object.entries(providers)
    .filter(([, p]) => p.enabled && p.apiKey)
    .map(([name, p]) => ({ name, apiKey: p.apiKey, baseUrl: p.baseUrl }));
  // use provider name set as dependency to avoid re-fetching on every render
  const enabledKey = enabledProviders.map((p) => p.name).sort().join(",");

  // fetch available image/video models when enabled providers change
  useEffect(() => {
    if (enabledProviders.length === 0) {
      setImageModels([]);
      setVideoModels([]);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    const fetchModels = async (mediaType: "image" | "video") => {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: enabledProviders, mediaType }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.models ?? [];
    };
    Promise.all([fetchModels("image"), fetchModels("video")])
      .then(([imgs, vids]) => {
        if (cancelled) return;
        setImageModels(imgs);
        setVideoModels(vids);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey]);

  // merge user custom models into dropdowns (enabled providers only), so custom models can be selected as default
  const enabledNames = new Set(enabledProviders.map((p) => p.name));
  const imageModelOptions = mergeCustomModels(imageModels, customModels, "image", enabledNames);
  const videoModelOptions = mergeCustomModels(videoModels, customModels, "video", enabledNames);
  const selectedVideoModel = videoModelOptions.find((model) =>
    model.id === defaultVideoModel && (!defaultVideoProvider || model.provider === defaultVideoProvider)
  );
  const selectedVideoProvider = selectedVideoModel?.provider;
  const selectedVideoCapabilities = getVideoModelCapabilities(defaultVideoModel);
  const effectiveVideoResolution = resolveModelResolution(defaultResolution, selectedVideoCapabilities.resolutionValues);
  const selectedAtlasFamily = selectedVideoProvider === "atlas-cloud"
    ? ATLAS_VIDEO_FAMILIES.find((family) => family.id === defaultVideoModel)
    : undefined;

  // auto-select a default model after enabling a provider: if nothing is selected (or the selection is gone) and options exist, fall back to the first one
  // — prevents the beginner trap of "set up a Key but generation fails because no default model was chosen"
  const imageIds = imageModelOptions.map((m) => `${m.provider}:${m.id}`).join(",");
  const videoIds = videoModelOptions.map((m) => `${m.provider}:${m.id}`).join(",");
  useEffect(() => {
    if (!imageModelOptions.length) return;
    const selected = imageModelOptions.find((m) =>
      m.id === defaultImageModel && (!defaultImageProvider || m.provider === defaultImageProvider)
    );
    if (!selected) {
      setDefaultImageModel(imageModelOptions[0].id, imageModelOptions[0].provider);
    } else if (!defaultImageProvider && selected.provider) {
      // One-time migration for older browser state: persist the provider that the
      // picker is actually displaying so duplicate model IDs cannot route elsewhere.
      setDefaultImageModel(selected.id, selected.provider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIds]);
  useEffect(() => {
    if (videoModelOptions.length && !videoModelOptions.some((m) =>
      m.id === defaultVideoModel && (!defaultVideoProvider || m.provider === defaultVideoProvider)
    )) {
      setDefaultVideoModel(videoModelOptions[0].id, videoModelOptions[0].provider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoIds]);
  // LLM connection test state
  const [llmTestStatus, setLlmTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  // Active tab, synced with ?tab= so "go to settings" links can deep-link a section
  const [tab, setTab] = useState("providers");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q && SETTINGS_TABS.includes(q)) setTab(q);
  }, []);
  const switchTab = (v: string) => {
    setTab(v);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", v);
    window.history.replaceState(null, "", url.toString());
  };

  // 系统诊断信息（/api/health），报障截图用
  const [diagnostics, setDiagnostics] = useState("");
  const loadDiagnostics = async () => {
    try {
      const res = await fetch("/api/health");
      setDiagnostics(JSON.stringify(await res.json(), null, 2));
    } catch (e) {
      setDiagnostics(String(e));
    }
  };

  // test LLM connection
  const [llmTestError, setLlmTestError] = useState("");
  // 连接通过但仍有值得知道的事（例如该模型输出上限极小）——绿灯照给，附一行提醒
  const [llmTestWarning, setLlmTestWarning] = useState("");
  const testLLMConnection = async () => {
    setLlmTestStatus("testing");
    setLlmTestError("");
    setLlmTestWarning("");
    try {
      // use server-side test: browser direct calls to provider APIs would be blocked by CORS and falsely report failure
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      setLlmTestStatus(data.ok ? "success" : "error");
      if (!data.ok) setLlmTestError(data.error || t("connectFailed"));
      if (data.warning) setLlmTestWarning(data.warning);
    } catch (e) {
      setLlmTestStatus("error");
      setLlmTestError(e instanceof Error ? e.message : t("connectFailed"));
    }
    // 成功 5 秒后收起；失败保持到下一次测试——可行动的报错往往有两三行，5 秒读不完（issue #19 追问）
    setTimeout(() => setLlmTestStatus((s) => (s === "error" ? s : "idle")), 5000);
  };

  // compute AI provider configuration status
  const hasAnyProvider = Object.values(providers).some(p => p.enabled && p.apiKey);


  return (
      <PageFrame width="wide" className="mora-settings-page">
        {/* page title */}
        <PageHeader title={t("pageTitle")} description={t("pageSubtitle")} />

        {/* configuration status banner: surfaces missing setup right at the top (the footer summary is easy to miss) */}
        {(!llm.apiKey || !hasAnyProvider) && (
          <Notice tone="warning" title={t("configBannerTitle")} className="mb-6">
            <ul className="space-y-1">
              {!llm.apiKey && <li>{t("llmNotConfigured")}</li>}
              {!hasAnyProvider && <li>{t("noProvider")}</li>}
            </ul>
          </Notice>
        )}

        <section className="mora-settings-relationship" aria-labelledby="settings-relationship-title">
          <div className="mora-settings-relationship-copy">
            <h2 id="settings-relationship-title">{t("relationshipTitle")}</h2>
            <p>{t("relationshipSubtitle")}</p>
          </div>
          <div className="mora-settings-flows">
            <div className="mora-settings-flow">
              <span><strong>{t("relationshipProviders")}</strong><small>{t("relationshipProvidersDesc")}</small></span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              <span><strong>{t("relationshipDefaults")}</strong><small>{t("relationshipDefaultsDesc")}</small></span>
            </div>
            <div className="mora-settings-flow is-independent">
              <span><strong>{t("relationshipScript")}</strong><small>{t("relationshipScriptDesc")}</small></span>
              <em>{t("relationshipIndependent")}</em>
            </div>
          </div>
        </section>

        {/* tabs */}
        <div className="md:flex md:items-start md:gap-6 lg:gap-8">
          {/* Section rail: vertical on desktop (native settings-window feel), horizontal scroll on mobile */}
          <nav className="studio-settings-nav mb-6 flex gap-1 overflow-x-auto md:sticky md:top-20 md:mb-0 md:w-64 md:shrink-0 md:flex-col" aria-label={t("pageTitle")}>
            {SETTINGS_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => switchTab(sec.id)}
                aria-current={tab === sec.id ? "page" : undefined}
                className={`mora-settings-nav-item${tab === sec.id ? " is-active" : ""}`}
              >
                <span>{t(sec.labelKey)}</span>
                {tab === sec.id && <Check className="mora-settings-nav-check" aria-hidden="true" />}
              </button>
            ))}
          </nav>

          {/* Tab 1: AI provider configuration */}
          {tab === "providers" && (
          <section className="min-w-0 flex-1">
            <div className="space-y-4">
              {AI_PROVIDERS.map((platform) => {
                const provider = providers[platform.key] ?? {
                  enabled: false,
                  apiKey: "",
                };
                const platformName = PROVIDER_NAME_KEYS[platform.key] ? t(PROVIDER_NAME_KEYS[platform.key]) : platform.name;

                return (
                  <Card key={platform.key} className="glass-card mora-provider-card" data-enabled={provider.enabled || undefined}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        {/* provider info */}
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="mora-provider-logo" aria-hidden="true">
                            <Image src={platform.logo} width={21} height={21} alt="" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-sm">
                                {platformName}
                              </h3>
                              {provider.enabled && (
                                <span className="mora-provider-enabled">
                                  <Check aria-hidden="true" />{t("providerEnabled")}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {t(platform.descKey)}
                            </p>
                            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{t(platform.tipKey)}</p>
                          </div>
                        </div>

                        {/* enable toggle */}
                        <Toggle
                          checked={provider.enabled}
                          label={platform.name}
                          onChange={(enabled) =>
                            setProvider(platform.key, {
                              ...provider,
                              enabled,
                            })
                          }
                        />
                      </div>

                      {/* API Key input */}
                      <div className="mt-4">
                        <Label className="text-xs text-muted-foreground mb-1.5">
                          API Key
                        </Label>
                        <PasswordInput
                          value={provider.apiKey}
                          onChange={(apiKey) =>
                            setProvider(platform.key, {
                              ...provider,
                              apiKey,
                            })
                          }
                          placeholder={t("apiKeyPlaceholder", { name: platformName })}
                        />
                        {/* Key connectivity test: real auth probe ✓/✗/⚠ */}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            disabled={!provider.apiKey || providerTest[platform.key]?.state === "testing"}
                            onClick={() => testProvider(platform.key)}
                          >
                            {providerTest[platform.key]?.state === "testing" ? t("llmTestTesting") : t("llmTestButton")}
                          </Button>
                          {(() => {
                            const r = providerTest[platform.key];
                            if (!r || r.state === "idle" || r.state === "testing") return null;
                            const Icon = r.state === "ok" ? CheckCircle2 : r.state === "invalid" ? CircleAlert : WifiOff;
                            return (
                              <div className="mora-connection-feedback" data-state={r.state} role="status">
                                <Icon aria-hidden="true" />
                                <span>
                                  <strong>{r.state === "ok" ? t("providerConnectionOk") : r.state === "invalid" ? t("providerConnectionInvalid") : t("providerConnectionUnknown")}</strong>
                                  {r.msg && <small>{r.msg}</small>}
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* custom endpoint (proxy/self-hosted, optional) — collapsed by default so beginners are not disturbed */}
                      <details className="mt-3">
                        <summary className="text-xs text-muted-foreground/70 cursor-pointer list-none select-none hover:text-muted-foreground">
                          {t("providerBaseUrlLabel")}
                        </summary>
                        <div className="mt-2">
                          <Input
                            value={provider.baseUrl ?? ""}
                            onChange={(e) =>
                              setProvider(platform.key, {
                                ...provider,
                                baseUrl: e.target.value || undefined,
                              })
                            }
                            placeholder={t("providerBaseUrlPlaceholder")}
                            className="font-mono text-xs"
                          />
                        </div>
                      </details>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
          )}

          {/* Tab 2: LLM configuration */}
          {tab === "llm" && (
          <section className="min-w-0 flex-1">
            <div className="space-y-6">
              {/* LLM Provider configuration */}
              <Card className="glass-card">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-sm">{t("llmProvider")}</h3>
                  </div>

                  {/* quick presets */}
                  <div className="mb-4 p-3 rounded-lg bg-muted/50 border border-border/50">
                    <p className="text-xs text-muted-foreground mb-2">{t("llmPresetHint")}</p>
                    <div className="flex flex-wrap gap-2">
                      {LLM_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => setLLM({ ...llm, baseUrl: preset.baseUrl, model: preset.model, visionModel: preset.model, ...(preset.apiKey ? { apiKey: preset.apiKey } : {}) })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border border-border/50 bg-background hover:border-primary/40 hover:text-primary transition-colors"
                        >
                          {locale === "en" ? preset.labelEn ?? preset.label : preset.label}
                          {preset.tipKey && (
                            <span className="text-[10px] text-muted-foreground/70">({t(preset.tipKey as Parameters<typeof t>[0])})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4">
                    {/* API base URL */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("llmBaseUrlLabel")}
                      </Label>
                      <Input
                        value={llm.baseUrl}
                        onChange={(e) =>
                          setLLM({ ...llm, baseUrl: e.target.value })
                        }
                        placeholder="https://api.openai.com/v1"
                        className="font-mono text-xs"
                      />
                    </div>

                    {/* API Key */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("apiKeyLabel")}
                      </Label>
                      <PasswordInput
                        value={llm.apiKey}
                        onChange={(apiKey) => setLLM({ ...llm, apiKey })}
                        placeholder={t("llmApiKeyPlaceholder")}
                      />
                      {/* Pollinations 已改为「注册领每日免费额度」，直接把领 Key 的地址摆在输入框下面 */}
                      {/pollinations\.ai/i.test(llm.baseUrl) && (
                        <p className="text-xs text-muted-foreground">
                          {t("pollinationsKeyHint")}{" "}
                          <a
                            href="https://enter.pollinations.ai/keys"
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            enter.pollinations.ai/keys
                          </a>
                        </p>
                      )}
                    </div>

                    {/* model name */}
                    <div className="mora-model-settings-grid grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="mora-model-config-row">
                        <Label className="text-xs text-muted-foreground">
                          {t("llmTextModel")}
                        </Label>
                        <ModelPicker
                          capability="text"
                          value={llm.model}
                          baseUrl={llm.baseUrl}
                          apiKey={llm.apiKey}
                          onChange={(model) => setLLM({ ...llm, model })}
                          placeholder="gpt-4o"
                        />
                      </div>
                      <div className="mora-model-config-row">
                        <Label className="text-xs text-muted-foreground">
                          {t("llmVisionModel")}
                        </Label>
                        <ModelPicker
                          capability="vision"
                          value={llm.visionModel ?? ""}
                          baseUrl={llm.baseUrl}
                          apiKey={llm.apiKey}
                          onChange={(visionModel) => setLLM({ ...llm, visionModel: visionModel || undefined })}
                          placeholder="gpt-4o"
                        />
                      </div>
                    </div>
                    {/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):11434/i.test(llm.baseUrl) && (
                      <p className="text-xs text-muted-foreground -mt-2">{t("ollamaModelHint")}</p>
                    )}

                    {/openrouter\.ai/i.test(llm.baseUrl) && (
                      <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
                        <div className="mb-3">
                          <p className="text-sm font-medium">{t("llmFallbackTitle")}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("llmFallbackHint")}</p>
                        </div>
                        <div className="mora-model-settings-grid grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="mora-model-config-row">
                            <Label className="text-xs text-muted-foreground">{t("llmFallbackTextModel")}</Label>
                            <ModelPicker
                              capability="text"
                              value={llm.fallbackModel ?? ""}
                              baseUrl={llm.baseUrl}
                              apiKey={llm.apiKey}
                              onChange={(fallbackModel) => setLLM({ ...llm, fallbackModel: fallbackModel || undefined })}
                              placeholder={t("llmFallbackOptional")}
                            />
                          </div>
                          <div className="mora-model-config-row">
                            <Label className="text-xs text-muted-foreground">{t("llmFallbackVisionModel")}</Label>
                            <ModelPicker
                              capability="vision"
                              value={llm.fallbackVisionModel ?? ""}
                              baseUrl={llm.baseUrl}
                              apiKey={llm.apiKey}
                              onChange={(fallbackVisionModel) => setLLM({ ...llm, fallbackVisionModel: fallbackVisionModel || undefined })}
                              placeholder={t("llmFallbackOptional")}
                            />
                          </div>
                        </div>
                        {(llm.fallbackModel === llm.model || llm.fallbackVisionModel === (llm.visionModel || llm.model)) && (
                          <p className="mt-3 text-xs text-amber-600">{t("llmFallbackDuplicate")}</p>
                        )}
                      </div>
                    )}

                    {/* test connection button */}
                    <div className="pt-3 mt-3 border-t border-border/50">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={testLLMConnection}
                        disabled={!llm.apiKey || !llm.baseUrl || llmTestStatus === "testing"}
                        className={`text-xs ${
                          llmTestStatus === "success"
                            ? "text-emerald-600"
                            : llmTestStatus === "error"
                            ? "text-destructive"
                            : ""
                        }`}
                      >
                        {llmTestStatus === "testing" ? t("llmTestTesting")
                         : llmTestStatus === "success" ? t("llmTestSuccess")
                         : llmTestStatus === "error" ? t("llmTestError")
                         : t("llmTestButton")}
                      </Button>
                      {!llm.apiKey && (
                        <span className="text-xs text-muted-foreground ml-2">{t("llmFillKeyFirst")}</span>
                      )}
                      {llmTestStatus === "error" && llmTestError && (
                        <p className="mt-2 text-xs text-destructive break-all">{llmTestError}</p>
                      )}
                      {llmTestWarning && (
                        <p className="mt-2 text-xs text-amber-600 break-all">{llmTestWarning}</p>
                      )}
                      <p className="mt-2 text-[11px] text-muted-foreground">{t("llmTestTip")}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
          )}

          {/* Tab: TTS voice-over */}
          {tab === "tts" && (
          <section className="min-w-0 flex-1">
            <div className="space-y-6">
              {/* TTS voiceover */}
              <Card className="glass-card">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 text-white">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="22" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">{t("ttsTitle")}</h3>
                        <p className="text-xs text-muted-foreground">{t("ttsSubtitle")}</p>
                      </div>
                    </div>
                    <Toggle checked={tts.enabled} label={t("ttsTitle")} onChange={(v) => setTTS({ ...tts, enabled: v })} />
                  </div>

                  {tts.enabled && (
                    <div className="space-y-4">
                      {/* TTS provider selection */}
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">{t("ttsProviderLabel")}</Label>
                        <Select value={tts.provider ?? "openai"} onValueChange={(v) => onChangeTTSProvider((v ?? "openai") as TTSProvider)}>
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {(value: string) => {
                                const provider = TTS_PROVIDERS.find((p) => p.value === value);
                                return provider ? (locale === "en" ? provider.labelEn ?? provider.label : provider.label) : t("ttsProviderFallback");
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {TTS_PROVIDERS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>{locale === "en" ? p.labelEn ?? p.label : p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {(locale === "en" ? ttsMeta.hintEn ?? ttsMeta.hint : ttsMeta.hint) && (
                          <p className="text-[11px] text-muted-foreground/80">
                            {locale === "en" ? ttsMeta.hintEn ?? ttsMeta.hint : ttsMeta.hint}
                          </p>
                        )}
                      </div>

                      {ttsMeta.value === "openai" ? (
                        <>
                          {/* OpenAI-compatible: quick presets + baseUrl + Key + free model/voice */}
                          <div>
                            <p className="text-xs text-muted-foreground mb-2">{t("ttsPresetHint")}</p>
                            <div className="flex flex-wrap gap-2">
                              {OPENAI_TTS_PRESETS.map((p) => (
                                <button
                                  key={p.label}
                                  onClick={() => setTTS({ ...tts, baseUrl: p.baseUrl, model: p.model, voice: p.voice })}
                                  className="px-2.5 h-7 rounded-md border border-border/60 bg-muted/20 text-xs hover:border-primary/50 hover:text-primary transition-colors"
                                >
                                  {locale === "en" ? p.labelEn ?? p.label : p.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">{t("ttsBaseUrlLabel")}</Label>
                            <Input value={tts.baseUrl} onChange={(e) => setTTS({ ...tts, baseUrl: e.target.value })} placeholder="https://api.siliconflow.cn/v1" className="font-mono text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">{t("apiKeyLabel")}</Label>
                            <PasswordInput value={tts.apiKey} onChange={(apiKey) => setTTS({ ...tts, apiKey })} placeholder={t("ttsApiKeyPlaceholder")} />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsModelLabel")}</Label>
                              <Input value={tts.model} onChange={(e) => setTTS({ ...tts, model: e.target.value })} placeholder="tts-1" className="font-mono text-xs" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsVoiceLabel")}</Label>
                              <Input value={tts.voice} onChange={(e) => setTTS({ ...tts, voice: e.target.value })} placeholder="alloy" className="font-mono text-xs" />
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* MiniMax: API Key + optional GroupId/baseUrl + model/voice dropdowns */}
                          {ttsMeta.keySource === "tts" ? (
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("apiKeyLabel")}</Label>
                              <PasswordInput value={tts.apiKey} onChange={(apiKey) => setTTS({ ...tts, apiKey })} placeholder={t("ttsApiKeyPlaceholderShort")} />
                            </div>
                          ) : (
                            <div className="text-xs rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                              {providers[ttsMeta.keySource]?.apiKey ? (
                                <span className="text-emerald-500">{t("ttsKeyReused")}</span>
                              ) : (
                                <span className="text-amber-500">{t("ttsKeyMissing")}</span>
                              )}
                            </div>
                          )}
                          {ttsMeta.editableBaseUrl && (
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsBaseUrlLabel")}</Label>
                              <Input value={tts.baseUrl} onChange={(e) => setTTS({ ...tts, baseUrl: e.target.value })} placeholder={ttsMeta.baseUrl} className="font-mono text-xs" />
                            </div>
                          )}
                          {ttsMeta.needsGroupId && (
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsGroupIdLabel")}</Label>
                              <Input value={tts.groupId ?? ""} onChange={(e) => setTTS({ ...tts, groupId: e.target.value })} placeholder={t("ttsGroupIdPlaceholder")} className="font-mono text-xs" />
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {ttsMeta.models.length > 0 && (
                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">{t("ttsModelLabel")}</Label>
                                <Select value={tts.model || ttsMeta.defaultModel} onValueChange={(v) => setTTS({ ...tts, model: v ?? ttsMeta.defaultModel })}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue>{(value: string) => {
                                      const option = ttsMeta.models.find((o) => o.value === value);
                                      return option ? (locale === "en" ? option.labelEn ?? option.label : option.label) : value;
                                    }}</SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ttsMeta.models.map((o) => (<SelectItem key={o.value} value={o.value}>{locale === "en" ? o.labelEn ?? o.label : o.label}</SelectItem>))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsVoiceLabel")}</Label>
                              <Select value={tts.voice || ttsMeta.defaultVoice} onValueChange={(v) => setTTS({ ...tts, voice: v ?? ttsMeta.defaultVoice })}>
                                <SelectTrigger className="w-full">
                                  <SelectValue>{(value: string) => {
                                    const option = ttsMeta.voices.find((o) => o.value === value);
                                    return option ? (locale === "en" ? option.labelEn ?? option.label : option.label) : value;
                                  }}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {ttsMeta.voices.map((o) => (<SelectItem key={o.value} value={o.value}>{locale === "en" ? o.labelEn ?? o.label : o.label}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </>
                      )}

                      {/* preview playback */}
                      <div className="pt-3 mt-1 border-t border-border/50">
                        <Button variant="outline" size="sm" onClick={testTTS} disabled={!ttsReady || ttsTestStatus === "testing"} className={`text-xs ${ttsTestStatus === "error" ? "text-destructive" : ""}`}>
                          {ttsTestStatus === "testing" ? t("ttsTesting") : ttsTestStatus === "error" ? t("ttsTestError") : t("ttsTestButton")}
                        </Button>
                        {!ttsReady && <span className="ml-2 text-[11px] text-muted-foreground">{t("ttsFillKeyFirst")}</span>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
          )}

          {/* Image generation model — credentials live under connected generation services. */}
          {tab === "image" && (
          <section className="min-w-0 flex-1">
            <div className="space-y-6">
              <Card className="glass-card">
                <CardContent className="p-5">
                  <h3 className="font-semibold text-sm mb-4">{t("imageCardTitle")}</h3>
                  <div className="grid grid-cols-1 gap-4">
                    {/* default image generation model */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("defaultImageModel")}
                      </Label>
                      <GroupedModelSelect
                        value={defaultImageModel}
                        valueProvider={defaultImageProvider}
                        onChange={setDefaultImageModel}
                        models={imageModelOptions}
                        loading={modelsLoading}
                        placeholder={enabledProviders.length === 0 ? t("enableProviderFirst") : t("selectImageModel")}
                        disabled={imageModelOptions.length === 0}
                      />
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">{t("modelsFromProvidersHint")}</p>
                </CardContent>
              </Card>
            </div>
          </section>
          )}

          {/* Tab: video generation — default model + output format */}
          {tab === "video" && (
          <section className="min-w-0 flex-1">
            <div className="space-y-6">
              <Card className="glass-card">
                <CardContent className="p-5">
                  <h3 className="font-semibold text-sm mb-4">{t("videoCardTitle")}</h3>
                  {!modelsLoading && videoModelOptions.length === 0 && (
                    <Notice
                      tone="info"
                      title={t("videoSetupTitle")}
                      className="mb-4"
                      action={<Link href="/settings?tab=providers" onClick={() => switchTab("providers")} className="inline-flex min-h-8 items-center rounded-lg bg-primary px-3 text-[11px] font-semibold text-primary-foreground shadow-sm">{t("videoSetupAction")}</Link>}
                    >
                      {t("videoSetupDesc")}
                    </Notice>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* default video generation model */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("defaultVideoModel")}
                      </Label>
                      <GroupedModelSelect
                        value={defaultVideoModel}
                        valueProvider={defaultVideoProvider}
                        onChange={setDefaultVideoModel}
                        models={videoModelOptions}
                        loading={modelsLoading}
                        placeholder={enabledProviders.length === 0 ? t("enableProviderFirst") : t("selectVideoModel")}
                        disabled={videoModelOptions.length === 0}
                      />
                    </div>
                    {/* default resolution */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("defaultResolution")}
                      </Label>
                      <Select
                        value={defaultResolution}
                        onValueChange={(val) =>
                          setDefaultResolution(val as "720p" | "1080p")
                        }
                      >
                        <SelectTrigger className="w-full">
                          {/* Base UI Select.Value shows the raw value by default; use a function child to map it to a label */}
                          <SelectValue>
                            {(value: string) => resolutionOptions.find((o) => o.value === value)?.label ?? value}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {resolutionOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* default aspect ratio */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("defaultAspectRatio")}
                      </Label>
                      <Select
                        value={defaultAspectRatio}
                        onValueChange={(val) =>
                          setDefaultAspectRatio(
                            val as "9:16" | "16:9" | "1:1"
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          {/* Base UI Select.Value shows the raw value by default; use a function child to map it to a language-specific label */}
                          <SelectValue>
                            {(value: string) => {
                              const o = aspectRatioOptions.find((o) => o.value === value);
                              return o ? t(o.labelKey) : value;
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {aspectRatioOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {t(o.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {defaultVideoModel && (
                    <div className="mt-4 rounded-xl border border-border/60 bg-muted/25 px-4 py-3 text-xs">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                        <span><span className="text-muted-foreground">{t("videoRouteModel")}：</span>{selectedVideoModel?.name || defaultVideoModel}</span>
                        <span>
                          <span className="text-muted-foreground">{t("videoEffectiveResolution")}：</span>
                          <strong className="font-semibold text-foreground">{effectiveVideoResolution.effective}</strong>
                          {effectiveVideoResolution.adjusted && <span className="ml-1 text-muted-foreground">({t("videoFromPreference", { value: defaultResolution })})</span>}
                        </span>
                        {selectedAtlasFamily?.pricePerSecond != null && (
                          <span><span className="text-muted-foreground">{t("videoBillingTier")}：</span>≈ ${selectedAtlasFamily.pricePerSecond.toFixed(3)}/s</span>
                        )}
                      </div>
                      <p className="mt-2 leading-5 text-muted-foreground">{t("videoResolutionBehavior")}</p>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">{t("modelsFromProvidersHint")}</p>
                </CardContent>
              </Card>
            </div>
          </section>
          )}
          {/* Tab 3: character management */}
          {tab === "characters" && (
          <section className="min-w-0 flex-1">
            <PresenterManager />
          </section>
          )}
          {/* Tab 4: brand settings */}
          {tab === "brand" && (
          <section className="min-w-0 flex-1">
            <BrandSettings />
          </section>
          )}
        </div>

        {/* custom model endpoints + generation params (advanced, cross-cutting, collapsed) */}
        <div className="mt-6">
              {/* custom model endpoints + generation params (advanced, collapsed by default, does not disturb beginners) */}
              <details className="group rounded-xl border border-border/50 bg-card/30">
                <summary className="flex items-center justify-between cursor-pointer list-none select-none px-5 py-3.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                  <span>{t("advancedSection")}</span>
                  <svg className="size-4 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                </summary>
                <div className="px-1 pb-1 space-y-4">
                  <GenerationSettings selectedVideoProvider={selectedVideoProvider} />
                </div>
              </details>
        </div>

        {/* zustand persists every change instantly — say so instead of showing a fake save button */}
        <p className="mt-8 text-xs text-muted-foreground">{t("autoSaveHint")}</p>

        {/* 系统诊断：报障时让用户点开截图/复制，一次拿到版本、数据库、迁移、ffmpeg 状态（折叠，不与设置项抢注意力） */}
        <details className="group mt-4 rounded-lg border border-border/40">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
            <span>{t("diagnosticsTitle")}</span>
            <svg className="size-4 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
          </summary>
          <div className="px-4 pb-4">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadDiagnostics}>
                {diagnostics ? t("diagnosticsRefresh") : t("diagnosticsShow")}
              </Button>
              {diagnostics && (
                <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(diagnostics)}>
                  {t("diagnosticsCopy")}
                </Button>
              )}
            </div>
            {diagnostics && (
              <pre className="mt-3 max-h-64 overflow-auto rounded bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap break-all">{diagnostics}</pre>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{t("diagnosticsHint")}</p>
          </div>
        </details>
      </PageFrame>
  );
}

// ==================== character management component ====================

// ==================== brand settings component ====================

// watermark position options (labelKey is rendered per language inside the component)
const WATERMARK_POSITIONS = [
  { value: "top-left" as const, labelKey: "brandPositionTopLeft" },
  { value: "top-right" as const, labelKey: "brandPositionTopRight" },
  { value: "bottom-left" as const, labelKey: "brandPositionBottomLeft" },
  { value: "bottom-right" as const, labelKey: "brandPositionBottomRight" },
] as const;

function BrandSettings() {
  const t = useT("settings");
  const { brand, updateBrand, updateWatermark } = useBrandStore();

  return (
    <div className="space-y-6">
      {/* shop basic info */}
      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <h3 className="font-semibold text-sm">{t("brandShopTitle")}</h3>
          </div>

          <div className="grid gap-4">
            {/* shop name */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("brandNameLabel")}</Label>
              <Input
                value={brand.name}
                onChange={(e) => updateBrand({ name: e.target.value })}
                placeholder={t("brandNamePlaceholder")}
                className="text-sm"
              />
            </div>

            {/* Logo upload area */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Logo</Label>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/30 overflow-hidden">
                  {brand.logoUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local Data URL preview cannot use Next image optimization */}
                      <img
                        src={brand.logoUrl}
                        alt={t("brandLogoAlt")}
                        className="h-full w-full object-contain"
                      />
                    </>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/50">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          // convert the selected image to a Data URL for storage
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            updateBrand({ logoUrl: ev.target?.result as string });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors">
                      <LuUpload className="w-3 h-3" />
                      {t("brandUploadLogo")}
                    </span>
                  </label>
                  {brand.logoUrl && (
                    <button
                      onClick={() => updateBrand({ logoUrl: undefined })}
                      className="text-xs text-destructive hover:underline text-left"
                    >
                      {t("brandRemove")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* brand color settings */}
      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-600 text-white">
              <LuPalette className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm">{t("brandColorTitle")}</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* primary color */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("brandPrimaryColor")}</Label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="color"
                    value={brand.primaryColor}
                    onChange={(e) => updateBrand({ primaryColor: e.target.value })}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div
                    className="h-9 w-9 rounded-lg border border-border shadow-sm"
                    style={{ backgroundColor: brand.primaryColor }}
                  />
                </div>
                <Input
                  value={brand.primaryColor}
                  onChange={(e) => updateBrand({ primaryColor: e.target.value })}
                  className="font-mono text-xs uppercase flex-1"
                  maxLength={7}
                />
              </div>
            </div>

            {/* secondary color */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("brandSecondaryColor")}</Label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="color"
                    value={brand.secondaryColor}
                    onChange={(e) => updateBrand({ secondaryColor: e.target.value })}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div
                    className="h-9 w-9 rounded-lg border border-border shadow-sm"
                    style={{ backgroundColor: brand.secondaryColor }}
                  />
                </div>
                <Input
                  value={brand.secondaryColor}
                  onChange={(e) => updateBrand({ secondaryColor: e.target.value })}
                  className="font-mono text-xs uppercase flex-1"
                  maxLength={7}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* watermark settings */}
      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3 className="font-semibold text-sm">{t("brandWatermarkTitle")}</h3>
            </div>
            <Toggle
              checked={brand.watermark.enabled}
              label={t("brandWatermarkTitle")}
              onChange={(enabled) => updateWatermark({ enabled })}
            />
          </div>

          {brand.watermark.enabled && (
            <div className="space-y-4 pt-2">
              {/* watermark position */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("brandWatermarkPosition")}</Label>
                <div className="grid grid-cols-4 gap-2">
                  {WATERMARK_POSITIONS.map((pos) => (
                    <button
                      key={pos.value}
                      onClick={() => updateWatermark({ position: pos.value })}
                      className={`h-9 rounded-lg border text-xs font-medium transition-colors ${
                        brand.watermark.position === pos.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background hover:bg-accent text-muted-foreground"
                      }`}
                    >
                      {t(pos.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* opacity */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">{t("brandWatermarkOpacity")}</Label>
                  <span className="text-xs text-muted-foreground font-mono">
                    {Math.round(brand.watermark.opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={Math.round(brand.watermark.opacity * 100)}
                  onChange={(e) =>
                    updateWatermark({ opacity: Number(e.target.value) / 100 })
                  }
                  className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                  <span>10%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* outro settings */}
      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <h3 className="font-semibold text-sm">{t("brandOutroTitle")}</h3>
            </div>
            <Toggle
              checked={brand.outroEnabled}
              label={t("brandOutroTitle")}
              onChange={(enabled) => updateBrand({ outroEnabled: enabled })}
            />
          </div>

          {brand.outroEnabled && (
            <div className="space-y-1.5 pt-2">
              <Label className="text-xs text-muted-foreground">{t("brandOutroTextLabel")}</Label>
              <Textarea
                value={brand.outroText ?? ""}
                onChange={(e) => updateBrand({ outroText: e.target.value })}
                placeholder={t("brandOutroTextPlaceholder")}
                rows={2}
                className="text-sm resize-none"
              />
              <p className="text-[11px] text-muted-foreground/60">
                {t("brandOutroTip")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
