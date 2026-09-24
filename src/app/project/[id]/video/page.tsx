"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Play, ChevronDown, ArrowRight, LoaderCircle } from "lucide-react";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { resolveTTSConfig, isPaidTTSReady, getTTSProviderMeta } from "@/lib/tts-presets";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT, useLocale } from "@/lib/i18n";
import { RENDER_PRESETS, DEFAULT_RENDER_PRESET, type RenderPreset } from "@/lib/compose-presets";
import { BUILTIN_STYLE_PACKS, parseStylePack, serializeStylePack, STYLE_PACK_FORMAT, type StylePack } from "@/lib/style-packs";
import { adTemplateStorageKey, adTemplateAppliedKey } from "@/lib/ad-template-storage";
import { buildHookVariants } from "@/lib/script-engine/hook-variants";
import type { ProductCategory } from "@/lib/script-engine/templates";
import { CAPTION_PRESET_IDS } from "@/lib/caption-presets";
import { ProjectHeader } from "@/components/project-header";
import { normalizeProductionMode, type ProductionMode } from "@/lib/production-mode";
import { buildAssetRows, type SavedAssetRow } from "@/lib/assets-view";
import {
  LOCAL_MOTION_KINDS,
  planLocalMotionSequence,
  type LocalMotionKind,
} from "@/lib/video-composer/local-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Shot } from "@/lib/domain/script";

// 视频片段
interface VideoClipItem {
  shotId: number;
  type: Shot["type"];
  duration: number;
  voiceover: string;
  camera: string;
  localMotion: LocalMotionKind | "auto";
  transition: "ai_start_end" | "ai_reference" | "direct_concat" | "ffmpeg_fade";
}

// 合成配置
interface ComposeConfig {
  ttsEnabled: boolean;
  ttsVoice: string;
  /** 免费 TTS 音色（未配置付费 TTS 时使用） */
  freeVoice: string;
  bgm: string;
  subtitleSize: number;
  subtitlePosition: "bottom" | "center" | "top";
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: "720p" | "1080p";
  /** 渲染质量预设：快速/标准/高清（决定分辨率 + 编码速度/质量） */
  renderPreset: RenderPreset;
  /** 带货：片尾购买 CTA 贴片 */
  ctaEnabled: boolean;
  ctaText: string;
  /** 带货：左下角商品卡贴片（商品图缩略+名+购买引导，需商品图） */
  productCard: boolean;
  /** caption style preset: standard boxed / bold punch / minimal / word-by-word karaoke */
  captionPreset: "standard" | "bold" | "minimal" | "karaoke";
  /** 旁白闪避：旁白一响自动压低 BGM、停顿回升，旁白更清晰 */
  bgmDuck: boolean;
  /** voice grounding: TTS de-broadcast chain + room-tone bed (default on; off = clean studio read) */
  voiceGround: boolean;
  /** Preserve the complete product silhouette and use restrained crop ranges. */
  productSafe: boolean;
}

// 免费配音音色（微软 Edge keyless TTS，无需 Key）——与后端 FREE_TTS_VOICES 对应
// label 改为 i18n key，渲染时经 t() 取对应语言文案
const freeVoiceOptions = [
  { value: "zh-CN-XiaoxiaoNeural", labelKey: "freeVoiceXiaoxiao" },
  { value: "zh-CN-XiaoyiNeural", labelKey: "freeVoiceXiaoyi" },
  { value: "zh-CN-YunxiNeural", labelKey: "freeVoiceYunxi" },
  { value: "zh-CN-YunyangNeural", labelKey: "freeVoiceYunyang" },
  { value: "zh-CN-YunjianNeural", labelKey: "freeVoiceYunjian" },
];

// 背景音乐选项（label 改为 i18n key）
const bgmOptions = [
  { value: "none", labelKey: "bgmNone" },
  { value: "upbeat", labelKey: "bgmUpbeat" },
  { value: "chill", labelKey: "bgmChill" },
  { value: "energetic", labelKey: "bgmEnergetic" },
  { value: "emotional", labelKey: "bgmEmotional" },
];

// 转场标签（值为 i18n key）
const transitionLabels: Record<string, string> = {
  ai_start_end: "transitionAiStartEnd",
  ai_reference: "transitionAiReference",
  direct_concat: "transitionDirectConcat",
  ffmpeg_fade: "transitionFfmpegFade",
};

// 镜头类型标签（labelKey 为 i18n key）
const shotTypeLabels: Record<Shot["type"], { labelKey: string; color: string }> = {
  hook: { labelKey: "shotHook", color: "bg-red-500/20 text-red-400" },
  pain_point: { labelKey: "shotPainPoint", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { labelKey: "shotProductReveal", color: "bg-blue-500/20 text-blue-400" },
  demo: { labelKey: "shotDemo", color: "bg-green-500/20 text-green-400" },
  social_proof: { labelKey: "shotSocialProof", color: "bg-sky-500/15 text-sky-500" },
  cta: { labelKey: "shotCta", color: "bg-amber-500/20 text-amber-400" },
};

interface DbShot {
  shotId: number;
  type: VideoClipItem["type"];
  duration: number;
  voiceover: string;
  camera: string;
  transition: VideoClipItem["transition"];
}

// 判断素材是图还是视频（视频用 <video> 当封面，图用 <img>）
const isVideoPath = (p: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(p);

export default function VideoPage() {
  const t = useT("video");
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { defaultResolution, defaultAspectRatio, tts, providers, motionIntensity, setMotionIntensity } = useSettingsStore();
  const [clips, setClips] = useState<VideoClipItem[]>([]);
  // 分镜缩略图：shotId → 素材文件路径（在时间线里直接预览每段画面）
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [projectName, setProjectName] = useState("");
  const [productionMode, setProductionMode] = useState<ProductionMode>("local");
  const auxiliaryCompose = productionMode === "ai" || searchParams.get("entry") === "ai";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<ComposeConfig>({
    ttsEnabled: true,
    ttsVoice: "female-gentle",
    freeVoice: "zh-CN-XiaoxiaoNeural",
    bgm: "upbeat",
    subtitleSize: 24,
    subtitlePosition: "bottom",
    aspectRatio: "9:16",
    resolution: "1080p",
    renderPreset: DEFAULT_RENDER_PRESET,
    ctaEnabled: false,
    ctaText: "", // 默认空，开启时按当前语言用 ctaPlaceholder 预填（避免英文用户拿到中文默认 CTA）
    productCard: false,
    captionPreset: "standard",
    bgmDuck: false,
    voiceGround: true,
    productSafe: true,
  });

  // 合成状态
  const [isComposing, setIsComposing] = useState(false);
  const [composeProgress, setComposeProgress] = useState(0);
  const [composeDone, setComposeDone] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  // 背景音乐
  const [bgm, setBgm] = useState<{ path: string; name: string } | null>(null);
  const [bgmUploading, setBgmUploading] = useState(false);
  // 是否已配置付费 TTS（否则配音走免费 Edge keyless TTS）
  const paidTtsReady = isPaidTTSReady(tts, providers);
  // 免费配音试听状态
  const [previewingVoice, setPreviewingVoice] = useState(false);

  // 试听免费音色：合成一小段并播放
  const previewFreeVoice = async () => {
    if (previewingVoice) return;
    setPreviewingVoice(true);
    try {
      const res = await fetch("/api/tts/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: config.freeVoice, text: t("ttsPreviewText") }),
      });
      if (!res.ok) throw new Error(t("errorPreviewFailed"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      /* 试听失败静默（不阻断主流程） */
    } finally {
      setPreviewingVoice(false);
    }
  };
  const uploadBgm = async (file: File) => {
    setBgmUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/project/${id}/bgm`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errorUploadFailed"));
      setBgm({ path: data.path, name: data.name });
    } catch {
      setBgm(null);
    } finally {
      setBgmUploading(false);
    }
  };

  // 载入真实分镜（已选脚本）+ 项目名 + 默认画面设置
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [projectRes, scriptsRes, assetsRes] = await Promise.all([
          fetch(`/api/project/${id}`),
          fetch(`/api/project/${id}/scripts`),
          fetch(`/api/project/${id}/assets`),
        ]);
        const project = projectRes.ok ? await projectRes.json() : null;
        const scripts = scriptsRes.ok ? await scriptsRes.json() : [];
        const assets = assetsRes.ok ? await assetsRes.json() : [];
        if (cancelled) return;
        const projectMode = normalizeProductionMode(project?.productionMode);
        if (project) {
          setProjectName(project.name ?? project.productName ?? "");
          setProductionMode(projectMode);
          setProjectCategory(typeof project.productCategory === "string" ? project.productCategory : "");
          if (Array.isArray(project.productionWorkflow)) {
            const voiceStage = project.productionWorkflow.find((stage: { id?: unknown }) => stage.id === "voice");
            if (voiceStage) setConfig((current) => ({ ...current, ttsEnabled: voiceStage.enabled !== false }));
          }
        }
        const selected = Array.isArray(scripts)
          ? scripts.find((s: { selected?: boolean }) => s.selected) ?? scripts[0]
          : null;
        if (!selected || !Array.isArray(selected.shots) || selected.shots.length === 0) {
          setLoadError(t("errorNoScript"));
          setClips([]);
        } else {
          // Use the exact same resolver as the preceding assets page. In local mode this
          // excludes stale AI/stock rows and falls back to the project's own product photos.
          const rows = buildAssetRows(
            selected.shots as Shot[],
            (Array.isArray(assets) ? assets : []) as SavedAssetRow[],
            Array.isArray(project?.productImages) ? project.productImages : [],
            projectMode,
          );
          setThumbs(Object.fromEntries(rows.flatMap((row) => row.thumbnailUrl ? [[row.shotId, row.thumbnailUrl]] : [])));
          // raw shots feed the variant matrix (hook rewrites need full Shot objects)
          setScriptShots(selected.shots as Shot[]);
          setClips(
            (selected.shots as DbShot[]).map((s) => ({
              shotId: s.shotId,
              type: s.type,
              duration: s.duration,
              voiceover: s.voiceover ?? "",
              camera: s.camera ?? "",
              localMotion: "auto",
              transition: s.transition ?? "ai_start_end",
            }))
          );
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : t("errorLoadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Project data is loaded once on entry; locale changes do not require a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 用设置里的默认分辨率/比例初始化一次
  useEffect(() => {
    setConfig((c) => ({ ...c, resolution: defaultResolution, aspectRatio: defaultAspectRatio }));
  }, [defaultResolution, defaultAspectRatio]);

  // Production-console preview hand-off: select the existing real fast profile
  // (720p / veryfast / CRF 26) without touching any paid generation stage.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("renderPreset") !== "fast") return;
    setConfig((current) => ({ ...current, renderPreset: "fast", resolution: RENDER_PRESETS.fast.resolution }));
  }, []);

  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);

  // 更新片段转场
  const updateTransition = (shotId: number, transition: string) => {
    setClips((prev) =>
      prev.map((c) =>
        c.shotId === shotId ? { ...c, transition: transition as VideoClipItem["transition"] } : c
      )
    );
  };

  const updateLocalMotion = (shotId: number, motion: LocalMotionKind | "auto") => {
    setClips((prev) => prev.map((clip) => (clip.shotId === shotId ? { ...clip, localMotion: motion } : clip)));
  };

  const motionPreviewKinds = useMemo(
    () => planLocalMotionSequence(clips.map((clip) => ({
      shotId: clip.shotId,
      shotType: clip.type,
      camera: clip.camera,
      override: clip.localMotion,
      intensity: motionIntensity,
      productSafe: config.productSafe,
    }))).map((plan) => plan.kind),
    [clips, motionIntensity, config.productSafe]
  );

  const motionOverrides = () => clips.flatMap((clip) =>
    clip.localMotion === "auto" ? [] : [{ shotId: clip.shotId, motion: clip.localMotion }]
  );

  // style packs: declarative JSON recipes (caption preset / BGM / quality / CTA / product card).
  // Novice-safe style pack: pure data validated against a whitelist — nothing executable.
  const packFileRef = useRef<HTMLInputElement>(null);
  const [packNotice, setPackNotice] = useState<string | null>(null);

  const applyStylePack = (pack: StylePack) => {
    const p = pack.compose;
    setConfig((c) => ({
      ...c,
      ...(p.captionPreset && { captionPreset: p.captionPreset }),
      ...(p.bgm && { bgm: p.bgm }),
      ...(p.bgmDuck !== undefined && { bgmDuck: p.bgmDuck }),
      ...(p.quality && { renderPreset: p.quality, resolution: RENDER_PRESETS[p.quality].resolution }),
      ...(p.aspectRatio && { aspectRatio: p.aspectRatio }),
      ...(p.ctaText ? { ctaEnabled: true, ctaText: p.ctaText } : {}),
      ...(p.productCard !== undefined && { productCard: p.productCard }),
    }));
    setPackNotice(t("stylePackApplied").replace("{name}", pack.name));
  };

  // Ad-template hand-off (set at project creation on the new-project page): apply the
  // template's compose recipe ONCE per project, through the same whitelisted style-pack
  // path — later manual tweaks are never overwritten on revisit.
  useEffect(() => {
    let cancelled = false;
    try {
      const stored = localStorage.getItem(adTemplateStorageKey(id));
      if (!stored || localStorage.getItem(adTemplateAppliedKey(id))) return;
      void (async () => {
        try {
          const response = await fetch("/api/ad-template/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stored }),
          });
          if (!response.ok || cancelled) return;
          const { template: tpl } = await response.json() as { template?: { name: { zh: string; en: string }; compose: StylePack["compose"] } };
          if (!tpl || cancelled) return;
          applyStylePack({
            format: STYLE_PACK_FORMAT,
            name: locale === "zh" ? tpl.name.zh : tpl.name.en,
            compose: tpl.compose,
          });
          localStorage.setItem(adTemplateAppliedKey(id), "1");
        } catch {
          // Template pre-fill is a convenience; keep the editor usable offline.
        }
      })();
    } catch {
      // localStorage unavailable — the pre-fill is a convenience, never a blocker
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const importStylePack = async (file: File) => {
    const pack = parseStylePack(await file.text());
    if (!pack) {
      setPackNotice(t("stylePackInvalid"));
      return;
    }
    applyStylePack(pack);
  };

  const exportStylePack = () => {
    const json = serializeStylePack({
      name: projectName || "my-style",
      compose: {
        captionPreset: config.captionPreset,
        bgm: config.bgm as StylePack["compose"]["bgm"],
        bgmDuck: config.bgmDuck,
        quality: config.renderPreset,
        aspectRatio: config.aspectRatio,
        ...(config.ctaEnabled && config.ctaText.trim() ? { ctaText: config.ctaText.trim() } : {}),
        productCard: config.productCard,
      },
    });
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "mora-style-pack.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // —— Variant matrix (Creatify-Batch / Higgsfield UGC Factory pattern): same assets,
  // hook copy × caption preset × BGM mood combos rendered as separate labeled outputs
  // for A/B testing. Zero extra AI-generation cost — only compose (FFmpeg + TTS) reruns. ——
  const [scriptShots, setScriptShots] = useState<Shot[]>([]);
  const [projectCategory, setProjectCategory] = useState("");
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixHooks, setMatrixHooks] = useState<Set<string>>(new Set(["base"]));
  const [matrixCaptions, setMatrixCaptions] = useState<Set<string>>(new Set());
  const [matrixBgms, setMatrixBgms] = useState<Set<string>>(new Set());
  const [matrixRunning, setMatrixRunning] = useState(false);
  const [matrixResults, setMatrixResults] = useState<Array<{ label: string; status: "composing" | "done" | "failed"; url?: string }>>([]);

  /** Hard cap on one batch (compose is FFmpeg-heavy and runs sequentially). */
  const MATRIX_MAX = 6;
  const MATRIX_BGM_MOODS = ["upbeat", "chill", "energetic", "emotional"] as const;

  // hook-pattern categories use the script-engine vocabulary; map the project's UI category in
  const matrixCategory = (
    ["beauty", "food", "home", "fashion", "tech"].includes(projectCategory)
      ? projectCategory
      : projectCategory === "digital"
        ? "tech"
        : "home"
  ) as ProductCategory;

  // zero-LLM hook rewrites from the validated pattern library (base + 2 alternatives)
  const hookVariants = useMemo(
    () => (scriptShots.length > 0 ? buildHookVariants({ shots: scriptShots }, matrixCategory, 2) : []),
    [scriptShots, matrixCategory]
  );

  const matrixCombos = useMemo(() => {
    const hooks = [...matrixHooks];
    const captions = [...matrixCaptions];
    const bgms = [...matrixBgms];
    const combos: Array<{ hookKey: string; hookLabel: string; caption: string; bgm: string; label: string }> = [];
    for (const h of hooks) {
      const hookLabel = h === "base" ? t("matrixBaseHook") : hookVariants.find((v) => v.hookId === h)?.hookName ?? h;
      for (const c of captions) {
        for (const b of bgms) {
          combos.push({ hookKey: h, hookLabel, caption: c, bgm: b, label: `${hookLabel}×${c}×${b}` });
        }
      }
    }
    return combos.slice(0, MATRIX_MAX);
  }, [matrixHooks, matrixCaptions, matrixBgms, hookVariants, t]);

  const toggleMatrixOpen = () => {
    setMatrixOpen((open) => {
      // seed caption/BGM dimensions from the current config on first open
      if (!open) {
        setMatrixCaptions((s) => (s.size === 0 ? new Set([config.captionPreset]) : s));
        setMatrixBgms((s) => (s.size === 0 ? new Set([config.bgm !== "none" ? config.bgm : "upbeat"]) : s));
      }
      return !open;
    });
  };

  const toggleInSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  /** Run the matrix: sequential compose per combo, each polled by its own compositionId. */
  const runMatrix = async () => {
    if (matrixRunning || matrixCombos.length === 0) return;
    setMatrixRunning(true);
    setMatrixResults(matrixCombos.map((c) => ({ label: c.label, status: "composing" as const })));
    for (let i = 0; i < matrixCombos.length; i++) {
      const combo = matrixCombos[i];
      try {
        // hook variant: in-memory voiceover override for shot 1 (the stored script stays untouched)
        const variant = combo.hookKey === "base" ? undefined : hookVariants.find((v) => v.hookId === combo.hookKey);
        const hookShot = variant?.script.shots[0];
        const res = await fetch(`/api/project/${id}/compose`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resolution: config.resolution,
            renderPreset: config.renderPreset,
            aspectRatio: config.aspectRatio,
            motionIntensity,
            productSafe: config.productSafe,
            motionOverrides: motionOverrides(),
            label: combo.label,
            ...(hookShot && { voiceoverOverrides: [{ shotId: hookShot.shotId, voiceover: hookShot.voiceover ?? "" }] }),
            ...(config.ctaEnabled && config.ctaText.trim() && { ctaText: config.ctaText.trim() }),
            ...(config.productCard && { productCard: true }),
            captionPreset: combo.caption,
            ...(config.bgmDuck && { bgmDuck: true }),
            ...(!config.voiceGround && { voiceGround: false }),
            // uploaded BGM stays fixed across combos; otherwise the mood dimension picks the free track
            ...(bgm?.path ? { bgmPath: bgm.path } : { freeBgm: true, bgmMood: combo.bgm }),
            ...(config.ttsEnabled && paidTtsReady && { ttsConfig: resolveTTSConfig(tts, providers) }),
            ...(config.ttsEnabled && !paidTtsReady && { freeTts: { enabled: true, voice: config.freeVoice } }),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.compositionId) throw new Error(data.error || "compose failed");
        // poll THIS composition by id (avoids the latest-row race across sequential renders)
        const url: string = await new Promise((resolve, reject) => {
          const poll = setInterval(async () => {
            try {
              const r = await fetch(`/api/project/${id}/compose?compositionId=${data.compositionId}`);
              const d = await r.json();
              const c = d.composition;
              if (!c) return;
              if (c.status === "done" && c.url) {
                clearInterval(poll);
                resolve(c.url);
              } else if (c.status === "failed") {
                clearInterval(poll);
                reject(new Error("failed"));
              }
            } catch {
              // transient poll failure — keep trying until the outer timeout
            }
          }, 3000);
          setTimeout(() => {
            clearInterval(poll);
            reject(new Error("timeout"));
          }, 300000);
        });
        setMatrixResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "done", url } : r)));
      } catch {
        setMatrixResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "failed" } : r)));
      }
    }
    setMatrixRunning(false);
  };

  // 真实合成：调用 compose API 跑 FFmpeg，配乐观进度动画，完成后拿到真实 mp4
  const startCompose = async () => {
    setIsComposing(true);
    setComposeError(null);
    setComposeDone(false);
    setOutputUrl(null);
    setComposeProgress(0);

    // 乐观进度：先爬到 90%，等真实结果回来再到 100%
    const timer = setInterval(() => {
      setComposeProgress((prev) => (prev >= 90 ? 90 : prev + 3));
    }, 200);

    try {
      // 提交合成任务（后台异步），随后轮询状态
      const res = await fetch(`/api/project/${id}/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution: config.resolution,
          renderPreset: config.renderPreset,
          aspectRatio: config.aspectRatio,
          motionIntensity,
          productSafe: config.productSafe,
          motionOverrides: motionOverrides(),
          ...(config.ctaEnabled && config.ctaText.trim() && { ctaText: config.ctaText.trim() }),
          ...(config.productCard && { productCard: true }),
          ...(config.captionPreset !== "standard" && { captionPreset: config.captionPreset }),
          ...(config.bgmDuck && { bgmDuck: true }),
          ...(bgm?.path && { bgmPath: bgm.path }),
          ...(!config.voiceGround && { voiceGround: false }),
          // 没上传 BGM 且选了非 none 的配乐情绪 → 自动取一条该情绪的免费 CC 配乐（之前这里漏发，下拉形同虚设）
          ...(!bgm?.path && config.bgm !== "none" && { freeBgm: true, bgmMood: config.bgm }),
          // 开启配音时：已配付费 TTS 走付费；否则走免费 Edge keyless TTS（无需 Key），合成为每镜生成口播音轨
          ...(config.ttsEnabled && paidTtsReady && {
            // 解析后的完整配置（含平台、复用的 Key、默认 baseUrl/模型/音色、可选 GroupId）
            ttsConfig: resolveTTSConfig(tts, providers),
          }),
          ...(config.ttsEnabled && !paidTtsReady && {
            freeTts: { enabled: true, voice: config.freeVoice },
          }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errorComposeFailed"));

      // 轮询合成状态，直到 done / failed（后台任务，避免长视频请求超时）
      const url: string = await new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const r = await fetch(`/api/project/${id}/compose?compositionId=${encodeURIComponent(data.compositionId)}`);
            const d = await r.json();
            const c = d.composition;
            if (!c) return;
            if (c.status === "done" && c.url) {
              clearInterval(poll);
              resolve(c.url);
            } else if (c.status === "failed") {
              clearInterval(poll);
              reject(new Error(t("errorComposeAssets")));
            }
          } catch {
            // 单次轮询失败忽略，继续重试
          }
        }, 3000);
        // 兜底超时：5 分钟
        setTimeout(() => {
          clearInterval(poll);
          reject(new Error(t("errorComposeTimeout")));
        }, 300000);
      });

      clearInterval(timer);
      setComposeProgress(100);
      setOutputUrl(url);
      setComposeDone(true);
    } catch (e) {
      clearInterval(timer);
      setComposeError(e instanceof Error ? e.message : t("errorComposeFailed"));
      setComposeProgress(0);
    } finally {
      setIsComposing(false);
    }
  };

  return (
    <div className="min-h-screen grid-bg legacy-studio-page">
      {/* project context strip: name + CLICKABLE step navigation — replaces the legacy
          inline non-clickable stepper this page carried while owned by a parallel session */}
      <ProjectHeader
        projectName={projectName || t("defaultProjectName")}
        productionMode={productionMode}
        showStepper={!auxiliaryCompose}
        centerLabel={auxiliaryCompose ? t("workspaceTitle") : undefined}
        backHref={auxiliaryCompose ? `/project/${id}/assets` : undefined}
        backLabel={auxiliaryCompose ? t("backToAiFlow") : undefined}
      />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/15 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t("workspaceTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {auxiliaryCompose ? t("workspaceAiHelperDesc") : t("workspaceLocalDesc")}
            </p>
          </div>
          {!auxiliaryCompose && (
            <Link href={`/project/${id}/assets?workspace=ai`}>
              <Button variant="outline" size="sm" className="text-xs border-primary/50 text-primary hover:bg-primary/10">
                {t("openAiHelper")}
              </Button>
            </Link>
          )}
        </div>
        {/* page-level load feedback: these states existed but were never rendered,
            leaving an empty timeline with no explanation */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t("stateLoading")}
          </div>
        )}
        {!loading && loadError && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Link href={`/project/${id}/assets${auxiliaryCompose && productionMode === "local" ? "?workspace=ai" : ""}`}>
              <Button variant="outline" size="sm">{t("backToAssets")}</Button>
            </Link>
          </div>
        )}
        <div className={`grid grid-cols-1 lg:grid-cols-3 gap-6 ${loading || loadError ? "hidden" : ""}`}>
          {/* 左侧：视频时间线 */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold">{t("timelineTitle")}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{t("timelineMeta", { count: clips.length, duration: totalDuration })}</p>
              </div>
              <Link href={`/project/${id}/assets${auxiliaryCompose && productionMode === "local" ? "?workspace=ai" : ""}`}>
                <Button variant="outline" size="sm" className="text-xs">
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                  {t("backToAssets")}
                </Button>
              </Link>
            </div>

            <div className="space-y-1">
              {clips.map((clip, index) => {
                const typeInfo = shotTypeLabels[clip.type];
                return (
                  <div key={clip.shotId}>
                    {/* 片段卡片 */}
                    <Card className="glass-card">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          {/* 缩略图：有已生成的画面就直接预览，否则回退占位图 */}
                          <div className="w-20 h-14 bg-muted/30 rounded-md shrink-0 overflow-hidden border border-border/30 relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                              <Play className="w-4 h-4 text-primary/60" />
                            </div>
                            {thumbs[clip.shotId] &&
                              (isVideoPath(thumbs[clip.shotId]) ? (
                                <video
                                  src={thumbs[clip.shotId]}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={thumbs[clip.shotId]}
                                  alt=""
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              ))}
                          </div>

                          {/* 信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={`${typeInfo.color} border-0 text-[10px]`}>
                                {t(typeInfo.labelKey)}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{clip.duration}s</span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {clip.voiceover}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <span className="shrink-0 text-[10px] text-muted-foreground">{t("motionShotLabel")}</span>
                              <select
                                value={clip.localMotion}
                                onChange={(event) => updateLocalMotion(clip.shotId, event.target.value as LocalMotionKind | "auto")}
                                aria-label={`${t("motionShotLabel")} ${clip.shotId}`}
                                title={clip.camera}
                                className="min-w-0 max-w-48 rounded border border-border/40 bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground outline-none focus:border-primary/60"
                              >
                                <option value="auto">{t("motionAuto")} · {t(`motion_${motionPreviewKinds[index]}`)}</option>
                                {LOCAL_MOTION_KINDS.map((motion) => (
                                  <option key={motion} value={motion}>{t(`motion_${motion}`)}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* 序号 */}
                          <span className="text-sm font-bold text-muted-foreground/30 shrink-0">
                            {String(clip.shotId).padStart(2, "0")}
                          </span>
                        </div>
                      </CardContent>
                    </Card>

                    {/* 转场选择器（最后一个片段后面不显示） */}
                    {index < clips.length - 1 && (
                      <div className="flex items-center justify-center py-1.5">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted/20 border border-border/30">
                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                          <select
                            value={clip.transition}
                            onChange={(e) => updateTransition(clip.shotId, e.target.value)}
                            className="text-[11px] text-muted-foreground bg-transparent border-none outline-none cursor-pointer"
                          >
                            <option value="ai_start_end">{t(transitionLabels.ai_start_end)}</option>
                            <option value="ai_reference">{t(transitionLabels.ai_reference)}</option>
                            <option value="direct_concat">{t(transitionLabels.direct_concat)}</option>
                            <option value="ffmpeg_fade">{t(transitionLabels.ffmpeg_fade)}</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右侧：合成配置 */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-base font-semibold">{t("composeSettings")}</h2>

            {/* style packs: apply a whole look at once; import shared packs / export the current settings */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-3">
                <Label className="text-sm font-medium">{t("stylePackLabel")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {BUILTIN_STYLE_PACKS.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => applyStylePack(p)}
                      title={p.description}
                      className="h-9 rounded-md text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-primary transition-[transform,background-color,border-color,color,box-shadow,opacity] px-1 truncate"
                    >
                      {p.name.split(" / ")[0]}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => packFileRef.current?.click()}
                    className="h-8 rounded-md text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 transition-[transform,background-color,border-color,color,box-shadow,opacity]"
                  >
                    {t("stylePackImport")}
                  </button>
                  <button
                    onClick={exportStylePack}
                    className="h-8 rounded-md text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 transition-[transform,background-color,border-color,color,box-shadow,opacity]"
                  >
                    {t("stylePackExport")}
                  </button>
                </div>
                <input
                  ref={packFileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importStylePack(f);
                    e.target.value = ""; // allow re-importing the same file
                  }}
                />
                {packNotice && <p className="text-[11px] text-primary">{packNotice}</p>}
                <p className="text-[11px] text-muted-foreground">{t("stylePackHint")}</p>
              </CardContent>
            </Card>

            {/* 配音设置 */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">{t("ttsLabel")}</Label>
                  {!paidTtsReady && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{t("ttsFreeBadge")}</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{t("ttsEnableLabel")}</span>
                  <Switch checked={config.ttsEnabled} onCheckedChange={(checked) => setConfig((c) => ({ ...c, ttsEnabled: checked }))} aria-label={t("ttsEnableLabel")} />
                </div>
                {config.ttsEnabled && paidTtsReady && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("ttsPaidHint", { provider: getTTSProviderMeta(tts.provider).label })}
                  </p>
                )}
                {config.ttsEnabled && !paidTtsReady && (
                  <div className="space-y-2">
                    <Select value={config.freeVoice} onValueChange={(v) => setConfig((c) => ({ ...c, freeVoice: v ?? c.freeVoice }))}>
                      <SelectTrigger className="bg-muted/30 border-border/50 text-xs">
                        {/* Base UI 的 Select.Value 默认显示原始 value，用函数子节点映射为中文标签 */}
                        <SelectValue>
                          {(value: string) => {
                            const o = freeVoiceOptions.find((o) => o.value === value);
                            return o ? t(o.labelKey) : value;
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {freeVoiceOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {t(o.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      onClick={previewFreeVoice}
                      disabled={previewingVoice}
                      className="text-[11px] text-primary hover:underline disabled:opacity-50"
                    >
                      {previewingVoice ? t("ttsPreviewing") : t("ttsPreviewCta")}
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 背景音乐 */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-3">
                <Label className="text-sm font-medium">{t("bgmSectionLabel")}</Label>
                <Select value={config.bgm} onValueChange={(v) => setConfig((c) => ({ ...c, bgm: v ?? c.bgm }))}>
                  <SelectTrigger className="bg-muted/30 border-border/50 text-xs">
                    {/* Base UI 的 Select.Value 默认显示原始 value，用函数子节点映射为中文标签 */}
                    <SelectValue>
                      {(value: string) => {
                        const o = bgmOptions.find((o) => o.value === value);
                        return o ? t(o.labelKey) : value;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {bgmOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {t(o.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* 旁白闪避：旁白一响压低 BGM、停顿回升，旁白更清晰 */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">{t("bgmDuckLabel")}</span>
                  <Switch checked={config.bgmDuck} onCheckedChange={(checked) => setConfig((c) => ({ ...c, bgmDuck: checked }))} aria-label={t("bgmDuckLabel")} />
                </div>
                {/* 人声落地：TTS 旁白过手机麦频段+AGC 压缩+房间底噪垫底，摆脱「播音棚干声」感（原生模型人声不经过此链） */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">{t("voiceGroundLabel")}</span>
                  <Switch checked={config.voiceGround} onCheckedChange={(checked) => setConfig((c) => ({ ...c, voiceGround: checked }))} aria-label={t("voiceGroundLabel")} />
                </div>
              </CardContent>
            </Card>

            {/* 字幕设置 */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-3">
                <Label className="text-sm font-medium">{t("subtitleLabel")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["bottom", "center", "top"] as const).map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      aria-pressed={config.subtitlePosition === pos}
                      onClick={() => setConfig((c) => ({ ...c, subtitlePosition: pos }))}
                      className={`h-9 rounded-md text-xs border transition-[transform,background-color,border-color,color,box-shadow,opacity] ${
                        config.subtitlePosition === pos
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {pos === "bottom" ? t("subtitleBottom") : pos === "center" ? t("subtitleCenter") : t("subtitleTop")}
                    </button>
                  ))}
                </div>
                {/* caption style preset: standard boxed / bold punch / minimal / karaoke word-by-word */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-xs text-muted-foreground">{t("captionStyleLabel")}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(["standard", "bold", "minimal", "karaoke"] as const).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        aria-pressed={config.captionPreset === preset}
                        onClick={() => setConfig((c) => ({ ...c, captionPreset: preset }))}
                        className={`h-9 rounded-md text-xs border transition-[transform,background-color,border-color,color,box-shadow,opacity] ${
                          config.captionPreset === preset
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {t(`captionPreset_${preset}`)}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t(`captionPresetDesc_${config.captionPreset}`)}</p>
                </div>
              </CardContent>
            </Card>

            {/* 带货转化：购买 CTA 片尾 */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-3">
                <Label className="text-sm font-medium">{t("complianceLabel")}</Label>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{t("ctaLabel")}</span>
                  <Switch
                    checked={config.ctaEnabled}
                    aria-label={t("ctaLabel")}
                    onCheckedChange={(checked) => setConfig((c) => ({
                      ...c,
                      ctaEnabled: checked,
                      ctaText: checked && !c.ctaText.trim() ? t("ctaPlaceholder") : c.ctaText,
                    }))}
                  />
                </div>
                {config.ctaEnabled && (
                  <Input
                    value={config.ctaText}
                    onChange={(e) => setConfig((c) => ({ ...c, ctaText: e.target.value }))}
                    placeholder={t("ctaPlaceholder")}
                    className="bg-muted/30 border-border/50 text-xs"
                  />
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{t("productCardLabel")}</span>
                  <Switch checked={config.productCard} onCheckedChange={(checked) => setConfig((c) => ({ ...c, productCard: checked }))} aria-label={t("productCardLabel")} />
                </div>
              </CardContent>
            </Card>

            {/* 画面设置 */}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-4">
                <Label className="text-sm font-medium">{t("canvasLabel")}</Label>
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">{t("motionIntensityLabel")}</span>
                  <div className="grid grid-cols-3 gap-2">
                    {(["subtle", "normal", "strong"] as const).map((intensity) => (
                      <button
                        key={intensity}
                        type="button"
                        aria-pressed={motionIntensity === intensity}
                        onClick={() => setMotionIntensity(intensity)}
                        className={`h-9 rounded-md text-xs border transition-[transform,background-color,border-color,color,box-shadow,opacity] ${
                          motionIntensity === intensity
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {t(`motionIntensity_${intensity}`)}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t("motionIntensityDesc")}</p>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/10 px-3 py-2.5">
                  <div className="pr-3">
                    <p className="text-xs text-muted-foreground">{t("productSafeLabel")}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground/80">{t("productSafeDesc")}</p>
                  </div>
                  <Switch
                    checked={config.productSafe}
                    onCheckedChange={(checked) => setConfig((current) => ({ ...current, productSafe: checked }))}
                    aria-label={t("productSafeLabel")}
                  />
                </div>
                {/* 输出档位：一次选择同时决定分辨率与编码质量，避免下方重复选择分辨率 */}
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">{t("renderQualityLabel")}</span>
                  <div className="grid grid-cols-3 gap-2">
                    {(["fast", "standard", "hd"] as const).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        aria-pressed={config.renderPreset === preset}
                        onClick={() =>
                          setConfig((c) => ({ ...c, renderPreset: preset, resolution: RENDER_PRESETS[preset].resolution }))
                        }
                        className={`flex flex-col items-center gap-0.5 rounded-md py-1.5 text-xs border transition-[transform,background-color,border-color,color,box-shadow,opacity] ${
                          config.renderPreset === preset
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        <span className="font-medium">{t(`renderPreset_${preset}`)}</span>
                        <span className="text-[10px] opacity-70">{t(`renderPresetMeta_${preset}`)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t(`renderPresetDesc_${config.renderPreset}`)}</p>
                </div>
                {/* 比例 */}
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">{t("aspectRatioLabel")}</span>
                  <div className="grid grid-cols-3 gap-2">
                    {(["9:16", "16:9", "1:1"] as const).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        aria-pressed={config.aspectRatio === ratio}
                        onClick={() => setConfig((c) => ({ ...c, aspectRatio: ratio }))}
                        className={`h-9 rounded-md text-xs border transition-[transform,background-color,border-color,color,box-shadow,opacity] ${
                          config.aspectRatio === ratio
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {ratio === "9:16" ? t("aspectVertical") : ratio === "16:9" ? t("aspectHorizontal") : t("aspectSquare")}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 合成按钮 */}
            <div className="space-y-3">
              {/* 背景音乐（可选，合成时混入并自动压低让位配音） */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/10">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{t("bgmOptionalTitle")}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{bgm ? t("bgmSelected", { name: bgm.name }) : t("bgmUploadHint")}</p>
                </div>
                <label className="shrink-0">
                  <input type="file" accept="audio/*" className="hidden" disabled={isComposing || bgmUploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBgm(f); e.target.value = ""; }} />
                  <span className={`inline-flex items-center h-8 px-3 rounded-md border border-border/60 text-xs cursor-pointer hover:border-primary/50 ${(isComposing || bgmUploading) ? "opacity-50 pointer-events-none" : ""}`}>
                    {bgmUploading ? t("bgmUploading") : bgm ? t("bgmReplace") : t("bgmUploadCta")}
                  </span>
                </label>
              </div>

              {/* 合成进度 */}
              {(isComposing || composeDone) && (
                <div>
                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-200 ${composeDone ? "bg-emerald-500" : "brand-gradient"}`}
                      style={{ width: `${composeProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    {composeDone ? t("composeDoneMsg") : t("composingMsg", { progress: composeProgress })}
                  </p>
                </div>
              )}

              {/* 合成失败提示 */}
              {composeError && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <p className="text-xs text-destructive">{composeError}</p>
                </div>
              )}

              {/* 成片预览 */}
              {composeDone && outputUrl && (
                <div className="rounded-lg overflow-hidden border border-border/50 bg-black">
                  <video src={outputUrl} controls className="w-full max-h-[360px]" />
                </div>
              )}

              <Button
                onClick={startCompose}
                disabled={isComposing || clips.length === 0}
                className="w-full brand-gradient text-white"
              >
                {isComposing ? (
                  <>
                    <LoaderCircle className="animate-spin mr-2 h-4 w-4" />
                    {t("composing")}
                  </>
                ) : composeDone ? (
                  t("composeRedo")
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-1" />
                    {t("composeStart")}
                  </>
                )}
              </Button>

              {composeDone && outputUrl && (
                <>
                  <a href={`${outputUrl}?download=1`} download>
                    <Button variant="outline" className="w-full">{t("downloadVideo")}</Button>
                  </a>
                  <Link href={`/project/${id}/export`}>
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                      {t("nextExport")}
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Link>
                </>
              )}

              {/* Variant matrix (Creatify-Batch pattern): hook × caption × BGM combos as
                  labeled outputs — same assets, compose-only reruns, zero AI-gen cost */}
              {clips.length > 0 && (
                <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
                  <button
                    type="button"
                    onClick={toggleMatrixOpen}
                    className="w-full flex items-center justify-between text-sm font-medium"
                  >
                    <span>🧪 {t("matrixTitle")}</span>
                    <span className="text-xs text-muted-foreground">{matrixOpen ? "−" : "+"}</span>
                  </button>
                  {matrixOpen && (
                    <div className="space-y-3 text-xs pt-1">
                      <p className="text-muted-foreground leading-relaxed">{t("matrixDesc")}</p>
                      <div>
                        <p className="font-medium mb-1.5">{t("matrixHooks")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {[{ key: "base", name: t("matrixBaseHook") }, ...hookVariants.map((v) => ({ key: v.hookId, name: v.hookName }))].map((h) => (
                            <button
                              key={h.key}
                              type="button"
                              onClick={() => toggleInSet(setMatrixHooks, h.key)}
                              className={`rounded-full border px-2 py-0.5 transition-[transform,background-color,border-color,color,box-shadow,opacity] ${
                                matrixHooks.has(h.key)
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border/60 text-muted-foreground hover:border-primary/40"
                              }`}
                            >
                              {h.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="font-medium mb-1.5">{t("matrixCaptions")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {CAPTION_PRESET_IDS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => toggleInSet(setMatrixCaptions, c)}
                              className={`rounded-full border px-2 py-0.5 transition-[transform,background-color,border-color,color,box-shadow,opacity] ${
                                matrixCaptions.has(c)
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border/60 text-muted-foreground hover:border-primary/40"
                              }`}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="font-medium mb-1.5">{t("matrixBgms")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {MATRIX_BGM_MOODS.map((b) => (
                            <button
                              key={b}
                              type="button"
                              onClick={() => toggleInSet(setMatrixBgms, b)}
                              className={`rounded-full border px-2 py-0.5 transition-[transform,background-color,border-color,color,box-shadow,opacity] ${
                                matrixBgms.has(b)
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border/60 text-muted-foreground hover:border-primary/40"
                              }`}
                            >
                              {b}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{t("matrixCount", { n: matrixCombos.length, max: MATRIX_MAX })}</span>
                        <Button
                          size="sm"
                          className="text-xs"
                          disabled={matrixRunning || matrixCombos.length === 0 || isComposing}
                          onClick={runMatrix}
                        >
                          {matrixRunning ? (
                            <>
                              <LoaderCircle className="animate-spin mr-1 h-3 w-3" />
                              {t("matrixRunning", {
                                done: matrixResults.filter((r) => r.status !== "composing").length,
                                total: matrixResults.length,
                              })}
                            </>
                          ) : (
                            t("matrixRun", { n: matrixCombos.length })
                          )}
                        </Button>
                      </div>
                      {matrixResults.length > 0 && (
                        <div className="space-y-1">
                          {matrixResults.map((r) => (
                            <div key={r.label} className="flex items-center gap-2 truncate">
                              {r.status === "composing" ? (
                                <LoaderCircle className="animate-spin h-3 w-3 shrink-0 text-muted-foreground" />
                              ) : r.status === "done" ? (
                                <span className="text-emerald-500 shrink-0">✓</span>
                              ) : (
                                <span className="text-destructive shrink-0">✗</span>
                              )}
                              <span className="truncate text-muted-foreground">{r.label}</span>
                              {r.url && (
                                <a href={r.url} target="_blank" rel="noreferrer" className="text-primary underline shrink-0">
                                  {t("matrixView")}
                                </a>
                              )}
                            </div>
                          ))}
                          <p className="text-[10px] text-muted-foreground pt-1">{t("matrixExportHint")}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
