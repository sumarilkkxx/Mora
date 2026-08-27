"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  LuActivity,
  LuArrowLeft,
  LuBadgeDollarSign,
  LuBrainCircuit,
  LuCheck,
  LuCircleAlert,
  LuClock3,
  LuFilm,
  LuGitBranch,
  LuLoaderCircle,
  LuRefreshCw,
  LuRoute,
  LuSave,
  LuScissors,
  LuShieldCheck,
  LuSparkles,
  LuTags,
  LuWandSparkles,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { PageFrame } from "@/components/studio/page";
import { useLocale, useT } from "@/lib/i18n";
import { getVideoModelCapabilities } from "@/lib/model-capabilities";
import {
  buildPreviewPlan,
  buildWorkflowPlan,
  diagnoseGenerationFailure,
  estimateProduction,
  repairPlanFromQc,
  routeModel,
  type CreativeIntent,
  type ProjectMediaInsight,
  type ProductionSnapshot,
  type RepairAction,
  type RoutingGoal,
  type SemanticAsset,
  type VersionTree,
  type VisualBible,
  type WorkflowStageId,
  type WorkflowStagePlan,
} from "@/lib/production-system";
import type { Model } from "@/lib/providers/types";
import { useSettingsStore } from "@/lib/stores/settings-store";
import type { QcReport } from "@/lib/video-composer/qc";

interface ProductionOverview {
  project: { id: string; name: string; sourceVideoUrl?: string | null };
  workflow: WorkflowStagePlan[] | null;
  creativeIntent: CreativeIntent | null;
  visualBible: VisualBible | null;
  mediaInsights: ProjectMediaInsight[];
  snapshots: ProductionSnapshot[];
  semanticAssets: SemanticAsset[];
  versionTree: VersionTree;
  latestRun: { id: string; status: string; stage: string; error?: string | null } | null;
  latestComposition: { id: string; status: string; duration?: number | null; resolution?: "720p" | "1080p" | null; aspectRatio?: "9:16" | "16:9" | "1:1" | null } | null;
  latestFailure: { source: "task" | "pipeline"; id: string; stage: string; error: string } | null;
  selectedScript: { id: string; shotCount: number; totalDuration: number } | null;
  counts: { scripts: number; assets: number; clips: number; tasks: number; compositions: number };
}

const EMPTY_BIBLE: VisualBible = {
  characterAnchors: [], productAnchors: [], wardrobeAnchors: [], environmentAnchors: [], lightingAnchors: [], forbiddenChanges: [],
};

const EMPTY_INTENT: CreativeIntent = { subject: "" };
const OPTIONAL_STAGES = new Set<WorkflowStageId>(["analyze", "motion", "voice", "qc", "release"]);

function splitList(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
}

function priceOf(model: Model | undefined): number | undefined {
  const raw = Number(model?.extra?.priceBase);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  const match = model?.description?.match(/\$\s*([\d.]+)/);
  const parsed = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatDate(value: Date | string | null | undefined, locale: "zh" | "en") {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function Section({ title, hint, icon, children }: { title: string; hint?: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="studio-surface min-w-0 p-4 shadow-none sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">{icon}</span>
        <div className="min-w-0"><h2 className="font-semibold tracking-tight">{title}</h2>{hint && <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>}</div>
      </div>
      {children}
    </section>
  );
}

export default function ProductionPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT("production");
  const locale = useLocale();
  const { providers, customModels, defaultImageModel, defaultVideoModel, chainMode, setDefaultVideoModel } = useSettingsStore();
  const [overview, setOverview] = useState<ProductionOverview | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStagePlan[]>([]);
  const [bible, setBible] = useState<VisualBible>(EMPTY_BIBLE);
  const [intent, setIntent] = useState<CreativeIntent>(EMPTY_INTENT);
  const [goal, setGoal] = useState<RoutingGoal>("balanced");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"workflow" | "memory" | "snapshot" | "qc" | "repair" | null>(null);
  const [status, setStatus] = useState("");
  const [repairs, setRepairs] = useState<RepairAction[]>([]);

  const loadOverview = useCallback(async () => {
    const response = await fetch(`/api/project/${id}/production`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("loadFailed"));
    const next = data as ProductionOverview;
    setOverview(next);
    const initialWorkflow = next.workflow?.length ? next.workflow : buildWorkflowPlan({
      hasSourceMedia: Boolean(next.project.sourceVideoUrl || next.mediaInsights.length),
      aiKeyframes: Boolean(defaultImageModel),
      aiMotion: Boolean(defaultVideoModel),
      nativeAudio: false,
    });
    setWorkflow(initialWorkflow);
    setBible(next.visualBible ?? EMPTY_BIBLE);
    setIntent(next.creativeIntent ?? { subject: next.project.name || "" });
  }, [defaultImageModel, defaultVideoModel, id, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadOverview();
        const enabled = Object.entries(providers).filter(([, value]) => value.enabled && value.apiKey).map(([name, value]) => ({ name, apiKey: value.apiKey, baseUrl: value.baseUrl }));
        if (!enabled.length || cancelled) return;
        const response = await fetch("/api/ai/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providers: enabled }) });
        const data = await response.json();
        const fetched = response.ok && Array.isArray(data.models) ? data.models as Model[] : [];
        const enabledNames = new Set(enabled.map((item) => item.name));
        const extras: Model[] = customModels.filter((item) => enabledNames.has(item.provider) && !fetched.some((model) => model.id === item.modelId)).map((item) => ({
          id: item.modelId, name: item.name, provider: item.provider, mediaType: item.mediaType, supportsAudio: item.supportsAudio,
          modes: item.mediaType === "image" ? ["text-to-image", "image-to-image"] : ["text-to-video", "image-to-video"],
          extra: { custom: true },
        }));
        if (!cancelled) setModels([...fetched, ...extras]);
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [customModels, loadOverview, providers, t]);

  const videoModels = useMemo(() => models.filter((model) => model.mediaType === "video"), [models]);
  const routeDecision = useMemo(() => routeModel(videoModels.map((model) => {
    const capability = getVideoModelCapabilities(model.id, model.supportsAudio);
    const id = model.id.toLowerCase();
    return {
      id: model.id, name: model.name, modes: model.modes, supportsAudio: model.supportsAudio,
      supportsLastFrame: capability.lastFrame, pricePerCall: priceOf(model),
      quality: /pro|max|quality|master/.test(id) ? 3 : /lite|turbo|fast/.test(id) ? 1 : 2,
      speed: /lite|turbo|fast|flash/.test(id) ? 3 : /pro|max|quality/.test(id) ? 1 : 2,
    };
  }), { mode: "image-to-video", goal, requireLastFrame: chainMode !== "off" }), [chainMode, goal, videoModels]);

  const estimate = useMemo(() => estimateProduction({
    shotCount: overview?.selectedScript?.shotCount || Math.max(1, overview?.counts.assets || 1), workflow,
    imageUnitUsd: priceOf(models.find((model) => model.id === defaultImageModel)),
    videoUnitUsd: priceOf(models.find((model) => model.id === (routeDecision.selected?.id || defaultVideoModel))),
  }), [defaultImageModel, defaultVideoModel, models, overview, routeDecision.selected?.id, workflow]);

  const previewPlan = useMemo(() => buildPreviewPlan({ duration: overview?.selectedScript?.totalDuration || 15, hasGeneratedMotion: Boolean(overview?.counts.clips) }), [overview]);
  const diagnosis = overview?.latestFailure ? diagnoseGenerationFailure(overview.latestFailure.error) : null;

  const toggleWorkflowStage = (id: WorkflowStageId) => {
    if (!OPTIONAL_STAGES.has(id)) return;
    setWorkflow((current) => {
      const enabled = !(current.find((stage) => stage.id === id)?.enabled ?? true);
      let next = current.map((stage) => stage.id === id ? { ...stage, enabled } : stage);
      if (id === "qc" && !enabled) next = next.map((stage) => stage.id === "release" ? { ...stage, enabled: false } : stage);
      if (id === "release" && enabled) next = next.map((stage) => stage.id === "qc" ? { ...stage, enabled: true } : stage);
      if (id === "motion") {
        next = next.map((stage) => stage.id === "voice" ? { ...stage, dependsOn: enabled ? ["motion"] : ["keyframes"] } : stage);
      }
      const voiceEnabled = next.find((stage) => stage.id === "voice")?.enabled ?? false;
      const motionEnabled = next.find((stage) => stage.id === "motion")?.enabled ?? false;
      next = next.map((stage) => stage.id === "compose" ? { ...stage, dependsOn: voiceEnabled ? ["voice"] : motionEnabled ? ["motion"] : ["keyframes"] } : stage);
      return next;
    });
  };

  const patchProduction = async (payload: Record<string, unknown>, kind: typeof busy) => {
    setBusy(kind); setStatus("");
    try {
      const response = await fetch(`/api/project/${id}/production`, { method: "PATCH", headers: { "Content-Type": "application/json", "Accept-Language": locale }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("statusError"));
      setStatus(t("saved"));
      await loadOverview();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("statusError"));
    } finally { setBusy(null); }
  };

  const runQc = async () => {
    if (!overview?.latestComposition?.id) return;
    setBusy("qc"); setStatus(""); setRepairs([]);
    try {
      const response = await fetch(`/api/project/${id}/qc`, { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": locale }, body: JSON.stringify({ compositionId: overview.latestComposition.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("statusError"));
      setRepairs(repairPlanFromQc(data as QcReport));
      setStatus(data.status === "ok" ? t("qcPassed") : t("qcPlanned"));
    } catch (error) { setStatus(error instanceof Error ? error.message : t("statusError")); }
    finally { setBusy(null); }
  };

  const applyAutomaticRepairs = async () => {
    const composition = overview?.latestComposition;
    if (!composition || !repairs.length || repairs.some((repair) => !repair.automatic)) return;
    setBusy("repair"); setStatus("");
    try {
      const response = await fetch(`/api/project/${id}/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({
          resolution: composition.resolution || "1080p",
          aspectRatio: composition.aspectRatio || "9:16",
          freeTts: { enabled: true },
          bgmDuck: repairs.some((repair) => repair.action === "remix-audio"),
          label: t("repairVersionLabel"),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("statusError"));
      setRepairs([]);
      setStatus(t("repairStarted"));
      await loadOverview();
    } catch (error) { setStatus(error instanceof Error ? error.message : t("statusError")); }
    finally { setBusy(null); }
  };

  if (loading && !overview) return <main className="flex min-h-[60vh] items-center justify-center"><div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LuLoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />{t("loading")}</div></main>;
  if (!overview) return <PageFrame width="content"><Notice tone="danger">{status || t("loadFailed")}</Notice></PageFrame>;

  return (
    <PageFrame width="full" className="max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href={`/project/${id}/assets`} className="mb-3 inline-flex min-h-8 items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><LuArrowLeft className="h-4 w-4" />{t("back")}</Link>
          <p className="mb-1 truncate text-xs font-medium uppercase tracking-[0.18em] text-primary">{overview.project.name}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex self-start gap-2 sm:self-auto">
          <Link href={`/project/${id}/transcript`} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/8 px-3 text-sm font-medium text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><LuScissors />{t("textEditor")}</Link>
          <Button variant="outline" className="h-10" disabled={busy === "snapshot"} onClick={() => patchProduction({ action: "snapshot" }, "snapshot")}>
            {busy === "snapshot" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuGitBranch />}{t("snapshot")}
          </Button>
        </div>
      </header>

      <div role="status" aria-live="polite" className="mb-4 min-h-5 text-sm text-primary">{status}</div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-primary/25 bg-primary/8 p-4"><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><LuBadgeDollarSign className="h-4 w-4 text-primary" />{t("cost")}</div><div className="text-xl font-bold tabular-nums">{t("usdRange", { min: estimate.rangeUsd.min.toFixed(2), max: estimate.rangeUsd.max.toFixed(2) })}</div><p className="mt-1 text-[11px] text-muted-foreground">{estimate.unknownCalls ? t("unknownCalls", { n: estimate.unknownCalls }) : t("priceKnown")}</p></div>
        <div className="studio-surface rounded-2xl p-4 shadow-none"><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><LuClock3 className="h-4 w-4 text-primary" />{t("time")}</div><div className="text-xl font-bold tabular-nums">{t("minuteRange", { min: Math.max(1, Math.ceil(estimate.estimatedSeconds.min / 60)), max: Math.max(1, Math.ceil(estimate.estimatedSeconds.max / 60)) })}</div><p className="mt-1 text-[11px] text-muted-foreground">{t("shots", { n: overview.selectedScript?.shotCount || overview.counts.assets })}</p></div>
        <div className="studio-surface rounded-2xl p-4 shadow-none"><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><LuActivity className="h-4 w-4 text-primary" />{t("projectState")}</div><div className="text-xl font-bold">{overview.latestRun?.status ? t(`run_${overview.latestRun.status}`) : t("ready")}</div><p className="mt-1 text-[11px] text-muted-foreground">{t("outputCounts", { assets: overview.counts.assets, videos: overview.counts.compositions })}</p></div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-5">
          <Section title={t("workflow")} hint={t("workflowHint")} icon={<LuRoute className="h-4 w-4" />}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {workflow.map((stage) => {
                const optional = OPTIONAL_STAGES.has(stage.id);
                return <button key={stage.id} type="button" disabled={!optional} aria-pressed={stage.enabled} onClick={() => toggleWorkflowStage(stage.id)} className={`min-h-20 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default ${stage.enabled ? "border-primary/30 bg-primary/8" : "border-border/50 bg-background/25 opacity-60"}`}>
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{t(`stage_${stage.id}`)}</span><span className={`h-2 w-2 rounded-full ${stage.enabled ? "bg-emerald-400" : "bg-muted-foreground/40"}`} /></span>
                  <span className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground"><span className="rounded bg-muted/40 px-1.5 py-0.5">{t(`execution_${stage.execution}`)}</span><span className="rounded bg-muted/40 px-1.5 py-0.5">{t(`billing_${stage.billing}`)}</span></span>
                </button>;
              })}
            </div>
            <Button className="mt-4 h-10" disabled={busy === "workflow"} onClick={() => patchProduction({ productionWorkflow: workflow }, "workflow")}><LuSave />{busy === "workflow" ? t("saving") : t("saveWorkflow")}</Button>
          </Section>

          <Section title={t("memory")} hint={t("memoryHint")} icon={<LuBrainCircuit className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground sm:col-span-2">{t("subject")}<input value={intent.subject} onChange={(event) => setIntent((current) => ({ ...current, subject: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background/50 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary" /></label>
              {(["action", "environment", "lighting", "camera"] as const).map((field) => <label key={field} className="text-xs font-medium text-muted-foreground">{t(field)}<input value={intent[field] ?? ""} onChange={(event) => setIntent((current) => ({ ...current, [field]: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background/50 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary" /></label>)}
              {(["characterAnchors", "productAnchors", "wardrobeAnchors", "forbiddenChanges"] as const).map((field) => <label key={field} className="text-xs font-medium text-muted-foreground">{t(field)}<input value={bible[field].join(", ")} placeholder={t("commaHint")} onChange={(event) => setBible((current) => ({ ...current, [field]: splitList(event.target.value) }))} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background/50 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary" /></label>)}
            </div>
            <Button className="mt-4 h-10" disabled={busy === "memory"} onClick={() => patchProduction({ creativeIntent: intent, visualBible: bible }, "memory")}><LuSave />{busy === "memory" ? t("saving") : t("saveMemory")}</Button>
          </Section>

          <Section title={t("versions")} icon={<LuGitBranch className="h-4 w-4" />}>
            {!overview.versionTree.scripts.length && !overview.versionTree.generations.length && !overview.snapshots.length ? <p className="text-sm text-muted-foreground">{t("noVersions")}</p> : <div className="grid gap-4 md:grid-cols-2">
              <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("snapshots")}</h3><div className="space-y-2">{overview.snapshots.slice(0, 5).map((item) => <div key={item.id} className="rounded-lg border border-border/50 bg-background/30 px-3 py-2"><p className="truncate text-sm font-medium">{item.label}</p><p className="mt-1 text-[11px] text-muted-foreground">{formatDate(item.createdAt, locale)} · {item.assetIds.length} {t("assetsUnit")}</p></div>)}</div></div>
              <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("generations")}</h3><div className="space-y-2">{overview.versionTree.generations.slice(0, 6).map((item) => <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/30 px-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.label}</p><p className="text-[11px] text-muted-foreground">{item.kind}{item.shotId != null ? ` · #${item.shotId}` : ""}</p></div><span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px]">{item.status}</span></div>)}</div></div>
            </div>}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title={t("router")} hint={t("routerHint")} icon={<LuWandSparkles className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-2">{(["balanced", "cost", "speed", "quality", "consistency"] as RoutingGoal[]).map((item) => <button key={item} type="button" aria-pressed={goal === item} onClick={() => setGoal(item)} className={`min-h-9 rounded-lg border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary ${goal === item ? "border-primary/40 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>{t(`goal_${item}`)}</button>)}</div>
            {routeDecision.selected ? <div className="mt-4 rounded-xl border border-primary/25 bg-primary/8 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{t("recommended")}</p><p className="mt-1 break-words text-sm font-semibold">{routeDecision.selected.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{priceOf(videoModels.find((model) => model.id === routeDecision.selected?.id)) == null ? t("priceUnknown") : t("perCall", { price: priceOf(videoModels.find((model) => model.id === routeDecision.selected?.id))!.toFixed(3) })}</p><Button className="mt-3 h-9 w-full" disabled={defaultVideoModel === routeDecision.selected.id} onClick={() => { setDefaultVideoModel(routeDecision.selected!.id); setStatus(t("modelApplied")); }}><LuCheck />{defaultVideoModel === routeDecision.selected.id ? t("applied") : t("applyModel")}</Button></div> : <p className="mt-4 text-sm text-muted-foreground">{t("noModel")}</p>}
          </Section>

          <Section title={t("assets")} hint={t("assetCount", { n: overview.semanticAssets.length })} icon={<LuTags className="h-4 w-4" />}>
            {overview.semanticAssets.length ? <div className="space-y-3">{overview.semanticAssets.slice(0, 8).map((asset) => <div key={asset.id} className="rounded-xl border border-border/50 bg-background/30 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">#{asset.shotId} · {asset.mediaType}</span><span className="text-[10px] text-muted-foreground">{asset.commercialStatus}</span></div><div className="mt-2 flex flex-wrap gap-1">{asset.tags.length ? asset.tags.slice(0, 6).map((tag) => <span key={tag} className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">{tag}</span>) : <span className="text-[11px] text-muted-foreground">{t("noTags")}</span>}</div></div>)}</div> : <p className="text-sm text-muted-foreground">{t("noTags")}</p>}
            {overview.mediaInsights.length > 0 && <div className="mt-4 border-t border-border/50 pt-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("mediaInsights")}</p>{overview.mediaInsights.slice(0, 3).map((insight) => <p key={insight.id} className="mb-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{insight.summary}</p>)}</div>}
          </Section>

          <Section title={t("diagnosis")} icon={<LuCircleAlert className="h-4 w-4" />}>
            {diagnosis ? <div><p className="text-sm leading-6">{diagnosis.message[locale]}</p><p className="mt-3 text-xs font-medium text-muted-foreground">{t("recover")}</p><div className="mt-2 flex flex-wrap gap-1.5">{diagnosis.actions.map((action) => <span key={action} className="rounded-full border border-amber-500/25 bg-amber-500/8 px-2.5 py-1 text-[11px] text-amber-300">{t(`recovery_${action}`)}</span>)}</div></div> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><LuShieldCheck className="h-4 w-4 text-emerald-400" />{t("noFailure")}</p>}
          </Section>

          <Section title={t("preview")} hint={t("previewDesc")} icon={<LuFilm className="h-4 w-4" />}>
            <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span className="rounded-full border border-border/60 px-2 py-1">{previewPlan.resolution}</span><span className="rounded-full border border-border/60 px-2 py-1">{previewPlan.videoPreset}</span><span className="rounded-full border border-border/60 px-2 py-1">CRF {previewPlan.crf}</span></div>
            <Link href={`/project/${id}/video?renderPreset=fast`} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><LuFilm className="h-4 w-4" />{t("previewCta")}</Link>
          </Section>

          <Section title={t("repairs")} icon={<LuSparkles className="h-4 w-4" />}>
            <Button className="h-10 w-full" disabled={overview.latestComposition?.status !== "done" || busy === "qc"} onClick={runQc}>{busy === "qc" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuRefreshCw />}{busy === "qc" ? t("qcRunning") : t("runQc")}</Button>
            {!overview.latestComposition?.id && <p className="mt-2 text-xs text-muted-foreground">{t("noComposition")}</p>}
            {repairs.length > 0 && <div className="mt-3 space-y-2">{repairs.map((repair) => <div key={repair.checkId} className="rounded-lg border border-border/50 bg-background/30 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{t(`stage_${repair.stage}`)}</span><span className="text-[10px] text-muted-foreground">{repair.automatic ? t("freeAutoFix") : t("manualReview")}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{repair.message[locale]}</p></div>)}{repairs.every((repair) => repair.automatic) && <Button variant="outline" className="h-10 w-full" disabled={busy === "repair"} onClick={applyAutomaticRepairs}>{busy === "repair" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuSparkles />}{busy === "repair" ? t("repairStarting") : t("applyFreeRepairs")}</Button>}</div>}
          </Section>
        </div>
      </div>
    </PageFrame>
  );
}
