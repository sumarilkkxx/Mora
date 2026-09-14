"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Captions,
  Check,
  Download,
  Film,
  LoaderCircle,
  Focus,
  MoveHorizontal,
  Plus,
  Save,
  Scan,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Video,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { PageFrame, PageHeader, SectionHeader, SegmentedControl, SegmentedItem, Surface } from "@/components/studio/page";
import { useLocale, useT } from "@/lib/i18n";
import { DEFAULT_FREE_VOICE, FREE_TTS_VOICES } from "@/lib/tts-voices";
import {
  applyGuidedSpeechRate,
  DEFAULT_GUIDED_EDIT_BRIEF,
  GUIDED_EDIT_TEMPLATES,
  GUIDED_PROMOTION_GOALS,
  GUIDED_EDIT_ROLES,
  MAX_GUIDED_OUTPUT_SECONDS,
  MAX_GUIDED_SPEECH_RATE,
  MIN_GUIDED_SPEECH_RATE,
  SCENE_LABELS,
  buildGuidedScriptBeats,
  detectGuidedCaptionLanguage,
  estimateSpeechDuration,
  missingGuidedBriefFields,
  recommendedGuidedTemplate,
  sanitizeGuidedEditBrief,
  scaleGuidedBeatDurations,
  type GuidedEditBrief,
  type GuidedEditPlanDocument,
  type GuidedScene,
  type GuidedScriptBeat,
  type GuidedEditRole,
  type GuidedEditStyle,
  type GuidedPromotionGoal,
  type GuidedTemplateId,
  type SceneLabel,
} from "@/lib/guided-edit";

interface MediaSourceRow {
  id: string;
  originalName: string;
  url: string;
  posterUrl?: string | null;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sceneStatus: "pending" | "analyzing" | "ready" | "failed";
  scenes?: GuidedScene[] | null;
}

interface PlanRow {
  id: string;
  revision: number;
  status: "draft" | "ready" | "rendering" | "done" | "failed";
  active?: boolean;
  error?: string | null;
  document: GuidedEditPlanDocument;
  composition?: {
    status: string;
    duration?: number | null;
    outputUrl?: string | null;
    downloadUrl?: string | null;
  } | null;
}

const ACCEPT = ".mp4,.mov,.webm,.mkv,.m4v,video/mp4,video/quicktime,video/webm";

function seconds(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

const GUIDED_STYLE_OPTIONS = [
  { value: "natural", icon: Video },
  { value: "slow_zoom", icon: Scan },
  { value: "dynamic_focus", icon: Focus },
  { value: "product_pan", icon: MoveHorizontal },
  { value: "handheld", icon: Film },
  { value: "impact", icon: Zap },
] as const;

export default function GuidedEditWorkspace() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const t = useT("guidedEdit");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const voiceoverRef = useRef<HTMLInputElement>(null);
  const voiceoverSectionRef = useRef<HTMLDivElement>(null);
  const renderSectionRef = useRef<HTMLDivElement>(null);
  const [projectName, setProjectName] = useState("");
  const [sources, setSources] = useState<MediaSourceRow[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [brief, setBrief] = useState<GuidedEditBrief>(DEFAULT_GUIDED_EDIT_BRIEF);
  const [scenes, setScenes] = useState<GuidedScene[]>([]);
  const [beats, setBeats] = useState<GuidedScriptBeat[]>([]);
  const [draftBeats, setDraftBeats] = useState<GuidedScriptBeat[] | null>(null);
  const [activeBeatId, setActiveBeatId] = useState("");
  const [planId, setPlanId] = useState("");
  const [latestPlan, setLatestPlan] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"upload" | "voiceover" | "analyze" | "save" | "render" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [scriptNeedsUpdate, setScriptNeedsUpdate] = useState(false);
  const [planNeedsUpdate, setPlanNeedsUpdate] = useState(false);
  const [actualOutputDuration, setActualOutputDuration] = useState<number | null>(null);

  const selectedSource = sources.find((source) => source.id === sourceId) ?? sources[0] ?? null;
  const fromTaskCenter = searchParams.get("from") === "tasks";
  const backHref = fromTaskCenter ? "/tasks" : "/projects";
  const exportHref = `/project/${id}/export${fromTaskCenter ? "?from=tasks" : ""}`;

  const loadWorkspace = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [projectResponse, mediaResponse, planResponse] = await Promise.all([
        fetch(`/api/project/${id}`, { headers: { "Accept-Language": locale } }),
        fetch(`/api/project/${id}/media`, { headers: { "Accept-Language": locale } }),
        fetch(`/api/project/${id}/edit-plan`, { headers: { "Accept-Language": locale } }),
      ]);
      const [project, mediaData, planData] = await Promise.all([
        projectResponse.json(), mediaResponse.json(), planResponse.json(),
      ]);
      if (!projectResponse.ok || !mediaResponse.ok || !planResponse.ok) {
        throw new Error(project.error || mediaData.error || planData.error || t("loadFailed"));
      }
      const nextSources = Array.isArray(mediaData.sources) ? mediaData.sources as MediaSourceRow[] : [];
      const plans = Array.isArray(planData.plans) ? planData.plans as PlanRow[] : [];
      const plan = plans[0] ?? null;
      setProjectName(project.name || "");
      setSources(nextSources);
      setLatestPlan(plan);
      if (plan) {
        const loadedBrief = sanitizeGuidedEditBrief(plan.document.brief);
        setPlanId(plan.id);
        setSourceId(plan.document.timeline[0]?.sourceId || nextSources[0]?.id || "");
        setBrief(loadedBrief);
        setScenes(plan.document.scenes);
        setBeats(plan.document.beats);
        setDraftBeats(null);
        setScriptNeedsUpdate(false);
        setPlanNeedsUpdate(false);
        setActiveBeatId((current) => current && plan.document.beats.some((beat) => beat.id === current) ? current : plan.document.beats[0]?.id || "");
      } else {
        setSourceId((current) => current || nextSources[0]?.id || "");
        setBrief((current) => ({
          ...current,
          projectName: current.projectName || project.name || "",
          productName: current.productName || project.productName || "",
          promotionGoal: current.promotionGoal || project.productDescription || "",
        }));
        if (nextSources[0]?.scenes?.length) setScenes(nextSources[0].scenes);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadFailed"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [id, locale, t]);

  // Render polling deliberately updates only server-owned task/output state. Re-loading the full
  // workspace here used to overwrite promotion copy, scene bindings and settings typed while a
  // render was in progress.
  const refreshRenderStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/project/${id}/edit-plan`, { headers: { "Accept-Language": locale } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("loadFailed"));
      const plans = Array.isArray(data.plans) ? data.plans as PlanRow[] : [];
      setLatestPlan(plans[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadFailed"));
    }
  }, [id, locale, t]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    setActualOutputDuration(null);
  }, [latestPlan?.composition?.outputUrl]);

  const rendering = latestPlan?.status === "rendering";
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void refreshRenderStatus(), 2500);
    return () => clearInterval(timer);
  }, [refreshRenderStatus, rendering]);

  const estimatedDuration = useMemo(() => beats.reduce((sum, beat) => sum + beat.estimatedDuration, 0), [beats]);
  const speechRate = brief.speechRate ?? 1;
  const editStyle = brief.editStyle ?? "natural";
  const durationTooLong = estimatedDuration > MAX_GUIDED_OUTPUT_SECONDS + 0.01;

  function patchBrief(patch: Partial<GuidedEditBrief>) {
    setBrief((current) => ({ ...current, ...patch }));
    setPlanNeedsUpdate(true);
    setActualOutputDuration(null);
    setMessage("");
  }

  function patchScriptBrief(patch: Partial<GuidedEditBrief>) {
    patchBrief(patch);
    setScriptNeedsUpdate(true);
    setDraftBeats(null);
  }

  function scrollToStep(target: React.RefObject<HTMLElement | null>) {
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    });
  }

  function alignBeatsToVoiceover(duration: unknown) {
    setBeats((current) => scaleGuidedBeatDurations(current, duration));
  }

  function changeSpeechRate(value: number) {
    const nextRate = Math.min(MAX_GUIDED_SPEECH_RATE, Math.max(MIN_GUIDED_SPEECH_RATE, Number(value.toFixed(2))));
    setBrief((current) => ({
      ...current,
      speechRate: nextRate,
      ...(current.audioMode === "local_voice" ? { voiceoverFile: undefined, voiceoverName: undefined } : {}),
    }));
    setBeats((current) => applyGuidedSpeechRate(current, nextRate));
    setPlanNeedsUpdate(true);
    setActualOutputDuration(null);
    setMessage("");
  }

  async function upload(file: File) {
    setBusy("upload"); setError("");
    try {
      const response = await fetch(`/api/project/${id}/media`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "Accept-Language": locale },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("createFailed"));
      setSourceId(data.id);
      setScenes([]);
      await loadWorkspace(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("createFailed")); }
    finally { setBusy(null); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function analyzeScenes() {
    if (!selectedSource) return;
    setBusy("analyze"); setError("");
    try {
      const response = await fetch(`/api/project/${id}/media/${selectedSource.id}/scenes`, { method: "POST", headers: { "Accept-Language": locale } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("loadFailed"));
      setScenes(data.scenes);
      setSources((current) => current.map((source) => source.id === selectedSource.id ? { ...source, sceneStatus: "ready", scenes: data.scenes } : source));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("loadFailed")); }
    finally { setBusy(null); }
  }

  async function uploadVoiceover(file: File) {
    setBusy("voiceover"); setError("");
    try {
      const response = await fetch(`/api/project/${id}/voiceover`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "Accept-Language": locale },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("voiceoverUploadFailed"));
      alignBeatsToVoiceover(data.duration);
      patchBrief({ audioMode: "uploaded_voice", voiceoverFile: data.fileName, voiceoverName: data.originalName });
      scrollToStep(renderSectionRef);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("voiceoverUploadFailed")); }
    finally { setBusy(null); if (voiceoverRef.current) voiceoverRef.current.value = ""; }
  }

  async function synthesizeLocalVoice() {
    if (!beats.length) { setError(t("planRequired")); return; }
    setBusy("voiceover"); setError("");
    try {
      const detected = detectGuidedCaptionLanguage(beats.map((beat) => beat.text).join(" "));
      const language = brief.captionLanguage === "en" || (brief.captionLanguage === "auto" && detected === "en") ? "en" : "zh";
      const response = await fetch(`/api/project/${id}/voiceover/local`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({ beats, language, speechRate, voice: brief.voiceoverVoice ?? DEFAULT_FREE_VOICE }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("localVoiceFailed"));
      alignBeatsToVoiceover(data.duration);
      patchBrief({ audioMode: "local_voice", voiceoverFile: data.fileName, voiceoverName: data.originalName, voiceoverVoice: data.voice ?? brief.voiceoverVoice ?? DEFAULT_FREE_VOICE });
      setMessage(t("localVoiceReady"));
      scrollToStep(renderSectionRef);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("localVoiceFailed")); }
    finally { setBusy(null); }
  }

  function prepareScriptDraft() {
    const missingFields = brief.inputMode === "guided" ? missingGuidedBriefFields(brief) : [];
    if (missingFields.length) {
      setError(t("requiredFieldsMissing", { fields: missingFields.map((field) => t(`field_${field}`)).join("、") }));
      return;
    }
    const next = buildGuidedScriptBeats(brief);
    if (!next.length) { setError(t("copyRequired")); return; }
    setDraftBeats(next);
    setError("");
    setMessage("");
  }

  function approveScriptDraft() {
    if (!draftBeats?.length) { prepareScriptDraft(); return; }
    const next = draftBeats.filter((beat) => beat.text.trim()).map((beat, index) => ({
      ...beat,
      id: `beat-${index + 1}`,
      text: beat.text.trim(),
      estimatedDuration: estimateSpeechDuration(beat.text, speechRate),
    }));
    if (!next.length) { setError(t("copyRequired")); return; }
    setBeats(next);
    setDraftBeats(null);
    setActiveBeatId(next[0]?.id || "");
    setScriptNeedsUpdate(false);
    setPlanNeedsUpdate(true);
    if (brief.audioMode === "local_voice" || brief.audioMode === "uploaded_voice") {
      setBrief((current) => ({ ...current, voiceoverFile: undefined, voiceoverName: undefined }));
    }
    setError("");
    setMessage(t("scriptApproved"));
    scrollToStep(brief.audioMode === "local_voice" || brief.audioMode === "uploaded_voice" ? voiceoverSectionRef : renderSectionRef);
  }

  function toggleSceneBinding(sceneId: string) {
    if (!activeBeatId) return;
    setPlanNeedsUpdate(true);
    setBeats((current) => current.map((beat) => beat.id !== activeBeatId ? beat : {
      ...beat,
      sceneIds: beat.sceneIds.includes(sceneId) ? beat.sceneIds.filter((id) => id !== sceneId) : [...beat.sceneIds, sceneId],
    }));
  }

  async function savePlan(): Promise<string | null> {
    if (!selectedSource) { setError(t("sourceRequired")); return null; }
    if (!beats.length) { setError(t("planRequired")); return null; }
    if (durationTooLong) { setError(t("durationTooLong", { seconds: Math.ceil(estimatedDuration), max: MAX_GUIDED_OUTPUT_SECONDS })); return null; }
    setBusy("save"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/project/${id}/edit-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({ planId: planId || undefined, sourceId: selectedSource.id, brief, scenes, beats }),
      });
      const plan = await response.json() as PlanRow & { error?: string };
      if (!response.ok) throw new Error(plan.error || t("saveFailed"));
      setPlanId(plan.id);
      setLatestPlan(plan);
      setBrief(plan.document.brief);
      setScenes(plan.document.scenes);
      setBeats(plan.document.beats);
      setPlanNeedsUpdate(false);
      setMessage(t("ready"));
      return plan.id;
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("saveFailed")); return null; }
    finally { setBusy(null); }
  }

  async function render() {
    const savedId = await savePlan();
    if (!savedId) return;
    setBusy("render"); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/project/${id}/edit-plan/${savedId}/render`, { method: "POST", headers: { "Accept-Language": locale } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("renderFailed"));
      setLatestPlan((current) => current ? { ...current, status: "rendering" } : current);
      await refreshRenderStatus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("renderFailed")); }
    finally { setBusy(null); }
  }

  if (loading) return <PageFrame width="full"><div className="flex min-h-[60vh] items-center justify-center"><LoaderCircle className="size-7 animate-spin text-primary motion-reduce:animate-none" /></div></PageFrame>;

  const activeBeat = beats.find((beat) => beat.id === activeBeatId) ?? null;
  const output = latestPlan?.composition?.status === "done" ? latestPlan.composition : null;
  const currentOutput = output && !planNeedsUpdate ? output : null;
  const needsVoiceover = brief.audioMode === "uploaded_voice" || brief.audioMode === "local_voice";
  const scriptReady = beats.length > 0 && !scriptNeedsUpdate;
  const voiceoverReady = scriptReady && (!needsVoiceover || Boolean(brief.voiceoverFile));
  const workflowStep = !scriptReady ? 1 : !voiceoverReady ? 2 : 3;
  const renderReady = Boolean(selectedSource) && voiceoverReady && !durationTooLong;

  function runWorkflowAction() {
    if (workflowStep === 1) {
      if (draftBeats) approveScriptDraft();
      else prepareScriptDraft();
      return;
    }
    if (workflowStep === 2) {
      if (brief.audioMode === "uploaded_voice") voiceoverRef.current?.click();
      else void synthesizeLocalVoice();
      return;
    }
    void render();
  }

  const workflowActionLabel = workflowStep === 1
    ? t(draftBeats ? "confirmScript" : "generateDraft")
    : workflowStep === 2
      ? (brief.audioMode === "uploaded_voice" ? t("uploadVoiceover") : t("generateLocalVoice"))
      : t("render");
  const workflowActionDisabled = busy !== null || rendering || (workflowStep === 3 && !renderReady);
  const currentActualDuration = planNeedsUpdate ? null : actualOutputDuration;
  const displayedDuration = currentActualDuration ?? estimatedDuration;
  const durationKind = currentActualDuration ? "actual" : brief.voiceoverFile ? "voiceover" : "estimate";

  return (
    <PageFrame width="full" className="guided-edit-workspace">
      <PageHeader
        variant="compact"
        context={projectName}
        title={t("workspaceEyebrow")}
        description={t("workspaceDescription")}
        actions={<div className="flex flex-wrap gap-2"><Link href={`/project/${id}/auto-edit`}><Button variant="outline">{locale === "en" ? "AI automatic editing" : "AI 自动剪辑"}</Button></Link><Link href={backHref}><Button variant="ghost"><ArrowLeft />{t(fromTaskCenter ? "backTasks" : "backProjects")}</Button></Link><Link href={exportHref}><Button variant="outline">{t("openExport")}</Button></Link></div>}
      />
      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}
      {message ? <Notice tone="success" className="mb-4"><Check className="mr-2 inline size-4" />{message}</Notice> : null}

      <Surface className="mb-5 border-primary/20 bg-primary/[.035] p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("workflowTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {currentOutput ? t("workflowDone") : rendering ? t("workflowRendering") : t(`workflowStep${workflowStep}Hint`)}
            </p>
          </div>
          {currentOutput ? <Link href={exportHref}><Button variant="outline"><ArrowRight />{t("openExport")}</Button></Link> : <Button size="lg" onClick={runWorkflowAction} disabled={workflowActionDisabled}>
            {busy !== null || rendering ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : workflowStep === 3 ? <Scissors /> : <ArrowRight />}
            {rendering ? t("rendering") : workflowActionLabel}
          </Button>}
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-3" aria-label={t("workflowTitle")}>
          {[t("workflowStepScript"), t("workflowStepVoice"), t("workflowStepRender")].map((label, index) => {
            const step = index + 1;
            const complete = currentOutput ? true : step < workflowStep;
            const active = !currentOutput && step === workflowStep;
            return <li key={label} aria-current={active ? "step" : undefined} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold ${active ? "border-primary bg-card text-primary shadow-sm" : complete ? "border-emerald-500/25 bg-emerald-500/[.07] text-foreground" : "border-border/60 bg-card/55 text-muted-foreground"}`}>
              <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] ${active ? "bg-primary text-primary-foreground" : complete ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>{complete ? <Check className="size-3.5" /> : step}</span>
              {label}
            </li>;
          })}
        </ol>
      </Surface>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(300px,.85fr)_minmax(400px,1.2fr)_minmax(300px,.8fr)]">
        <Surface className="min-w-0 p-4 sm:p-5">
          <SectionHeader title={t("sourceTitle")} description={t("sourceDescription")} />
          <input ref={inputRef} hidden type="file" accept={ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          <div className="mb-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy === "upload"} onClick={() => inputRef.current?.click()}>{busy === "upload" ? <LoaderCircle className="animate-spin" /> : <Upload />}{t("uploadSource")}</Button>
            <Button size="sm" disabled={!selectedSource || busy === "analyze"} onClick={() => void analyzeScenes()}>{busy === "analyze" ? <LoaderCircle className="animate-spin" /> : <Film />}{busy === "analyze" ? t("analyzingScenes") : t("analyzeScenes")}</Button>
          </div>
          {sources.length > 1 ? <select className="mb-4 h-9 w-full rounded-[10px] border border-input bg-card px-3 text-sm" value={sourceId} onChange={(event) => { const next = sources.find((source) => source.id === event.target.value); setSourceId(event.target.value); setScenes(next?.scenes ?? []); }}>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.originalName}</option>)}
          </select> : null}
          {!selectedSource ? <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border text-center"><Upload className="mb-3 size-7 text-muted-foreground" /><p className="text-sm font-medium">{t("noSource")}</p></div> : scenes.length === 0 ? <div className="relative flex min-h-48 overflow-hidden rounded-xl border border-border/70 bg-muted text-white shadow-sm">
            {selectedSource.posterUrl ? <>
              {/* eslint-disable-next-line @next/next/no-img-element -- persistent local first-frame poster */}
              <img src={selectedSource.posterUrl} alt={t("sourcePreviewAlt", { name: selectedSource.originalName })} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/5" />
            </> : <div className="absolute inset-0 grid place-items-center bg-muted"><Film className="size-8 text-muted-foreground" /></div>}
            <div className={`relative mt-auto w-full px-4 pb-4 pt-16 ${selectedSource.posterUrl ? "" : "text-foreground"}`}>
              <p className="truncate text-sm font-semibold" title={selectedSource.originalName}>{selectedSource.originalName}</p>
              <p className={`mt-1 text-xs ${selectedSource.posterUrl ? "text-white/75" : "text-muted-foreground"}`}>{t("noScenes")}</p>
            </div>
          </div> : <>
            <p className="mb-3 text-xs text-muted-foreground">{activeBeat ? t("sceneBindingHint", { beat: activeBeat.text }) : t("selectBeatFirst")}</p>
            <div className="grid max-h-[680px] grid-cols-2 gap-2 overflow-y-auto pr-1">
              {scenes.map((scene) => {
                const bound = activeBeat?.sceneIds.includes(scene.id) ?? false;
                return <div key={scene.id} className={`overflow-hidden rounded-xl border bg-card ${bound ? "border-primary ring-2 ring-primary/15" : "border-border/70"}`}>
                  <button type="button" onClick={() => toggleSceneBinding(scene.id)} className="relative block aspect-video w-full bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local extracted scene frame; next/image adds no caching value */}
                    {scene.thumbnailUrl ? <img src={scene.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                    <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{seconds(scene.start)}–{seconds(scene.end)}s</span>
                    {bound ? <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span> : null}
                  </button>
                  <select value={scene.label} onChange={(event) => { setPlanNeedsUpdate(true); setScenes((current) => current.map((item) => item.id === scene.id ? { ...item, label: event.target.value as SceneLabel, selected: event.target.value !== "unused" } : item)); }} className="h-8 w-full border-0 bg-card px-2 text-[11px] outline-none">
                    {SCENE_LABELS.map((label) => <option key={label} value={label}>{t(`sceneLabel_${label}`)}</option>)}
                  </select>
                </div>;
              })}
            </div>
          </>}
        </Surface>

        <Surface className="min-w-0 p-4 sm:p-5">
          <SectionHeader title={t("copyTitle")} description={t("copyDescription")} />
          <SegmentedControl label={t("copyTitle")}>
            <SegmentedItem selected={brief.inputMode === "guided"} onClick={() => patchScriptBrief({ inputMode: "guided", ...(brief.sellingPoints.length ? {} : { sellingPoints: [""] }) })}>{t("modeGuided")}</SegmentedItem>
            <SegmentedItem selected={brief.inputMode === "full_script"} onClick={() => patchScriptBrief({ inputMode: "full_script" })}>{t("modeFullScript")}</SegmentedItem>
          </SegmentedControl>
          <div className="mt-4 grid gap-4">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("productName")} <span className="text-destructive">*</span></span><Input value={brief.productName} onChange={(event) => patchScriptBrief({ productName: event.target.value })} placeholder={t("productNamePlaceholder")} /></label>
            {brief.inputMode === "full_script" ? <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("fullScript")} <span className="text-destructive">*</span></span><Textarea value={brief.fullScript} onChange={(event) => patchScriptBrief({ fullScript: event.target.value })} placeholder={t("fullScriptPlaceholder")} className="min-h-44" /></label> : <>
              <fieldset className="space-y-2"><legend className="text-xs font-medium text-muted-foreground">{t("promotionGoalType")} <span className="text-destructive">*</span></legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {GUIDED_PROMOTION_GOALS.map((goal) => <button key={goal} type="button" role="radio" aria-checked={brief.promotionGoalType === goal} onClick={() => patchScriptBrief({ promotionGoalType: goal as GuidedPromotionGoal, templateId: recommendedGuidedTemplate(goal as GuidedPromotionGoal) })} className={`min-h-11 cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 ${brief.promotionGoalType === goal ? "border-primary bg-primary/[.07] text-primary" : "border-border/70 bg-card text-muted-foreground hover:border-primary/35 hover:bg-muted/30"}`}>{t(`promotionGoal_${goal}`)}</button>)}
              </div></fieldset>
              <div className="rounded-xl border border-primary/15 bg-primary/[.035] px-3 py-2.5"><label className="flex items-center justify-between gap-3 text-xs"><span><strong className="text-foreground">{t("recommendedStructure")}</strong><span className="ml-1 text-muted-foreground">{t(`template_${brief.templateId}`)}</span></span><select aria-label={t("changeTemplate")} value={brief.templateId} onChange={(event) => patchScriptBrief({ templateId: event.target.value as GuidedTemplateId })} className="h-8 rounded-lg border border-input bg-card px-2 text-xs text-foreground">{GUIDED_EDIT_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{t(`template_${template.id}`)}</option>)}</select></label></div>
              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/15 p-3"><div><p className="text-xs font-semibold text-foreground">{t("coreFacts")} <span className="text-destructive">*</span></p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("coreFactsHint")}</p></div>
                {brief.sellingPoints.map((point, index) => <div key={index} className="space-y-1.5 text-xs font-medium text-muted-foreground"><div className="flex items-center justify-between gap-3"><label htmlFor={`guided-core-fact-${index}`}>{t("coreFact", { n: index + 1 })}</label>{brief.sellingPoints.length > 1 ? <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeSellingPoint", { n: index + 1 })} title={t("removeSellingPoint", { n: index + 1 })} onClick={() => patchScriptBrief({ sellingPoints: brief.sellingPoints.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 /></Button> : null}</div><Textarea id={`guided-core-fact-${index}`} value={point} onChange={(event) => patchScriptBrief({ sellingPoints: brief.sellingPoints.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} placeholder={t("sellingPointPlaceholder")} className="min-h-16" /></div>)}
                {brief.sellingPoints.length < 6 ? <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => patchScriptBrief({ sellingPoints: [...brief.sellingPoints, ""] })}><Plus />{t("addCoreFact")}</Button> : null}
              </div>
              {brief.templateId === "local_store" ? <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("location")} <span className="text-destructive">*</span></span><Input value={brief.location} onChange={(event) => patchScriptBrief({ location: event.target.value })} placeholder={t("locationPlaceholder")} /></label> : null}
              {brief.templateId === "promotion_offer" ? <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("offer")} <span className="text-destructive">*</span></span><Textarea value={brief.offer} onChange={(event) => patchScriptBrief({ offer: event.target.value })} placeholder={t("offerPlaceholder")} className="min-h-16" /></label> : null}
              <details className="group rounded-xl border border-border/70 bg-card"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/20"><span>{t("optionalDetails")}</span><span className="text-muted-foreground transition-transform group-open:rotate-45"><Plus /></span></summary><div className="grid gap-4 border-t border-border/60 p-3">
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("promotionGoal")}</span><Textarea value={brief.promotionGoal} onChange={(event) => patchBrief({ promotionGoal: event.target.value })} placeholder={t("promotionGoalPlaceholder")} className="min-h-16" /></label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("hook")}</span><Textarea value={brief.hook} onChange={(event) => patchScriptBrief({ hook: event.target.value })} placeholder={t("hookPlaceholder")} className="min-h-16" /></label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("introduction")}</span><Textarea value={brief.introduction} onChange={(event) => patchScriptBrief({ introduction: event.target.value })} placeholder={t("introductionPlaceholder")} className="min-h-16" /></label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("audience")}</span><Input value={brief.audience} onChange={(event) => patchScriptBrief({ audience: event.target.value })} placeholder={t("audiencePlaceholder")} /></label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("usageScene")}</span><Textarea value={brief.usageScene} onChange={(event) => patchScriptBrief({ usageScene: event.target.value })} placeholder={t("usageScenePlaceholder")} className="min-h-16" /></label>
                {brief.templateId !== "local_store" ? <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("location")}</span><Input value={brief.location} onChange={(event) => patchScriptBrief({ location: event.target.value })} placeholder={t("locationPlaceholder")} /></label> : null}
                {brief.templateId !== "promotion_offer" ? <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("offer")}</span><Textarea value={brief.offer} onChange={(event) => patchScriptBrief({ offer: event.target.value })} placeholder={t("offerPlaceholder")} className="min-h-16" /></label> : null}
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("cta")}</span><Textarea value={brief.cta} onChange={(event) => patchScriptBrief({ cta: event.target.value })} placeholder={t("ctaPlaceholder")} className="min-h-16" /></label>
              </div></details>
            </>}
            {draftBeats ? <div className="rounded-xl border border-primary/30 bg-primary/[.035] p-3"><div className="mb-3"><p className="text-sm font-semibold text-foreground">{t("draftTitle")}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("draftHint")}</p></div><div className="space-y-2">{draftBeats.map((beat, index) => <label key={beat.id} className="block space-y-1.5"><span className="text-[11px] font-semibold text-primary">{index + 1}. {t(`beatRole_${beat.role}`)}</span><Textarea value={beat.text} onChange={(event) => setDraftBeats((current) => current?.map((item) => item.id === beat.id ? { ...item, text: event.target.value } : item) ?? null)} className="min-h-16 bg-card text-sm" /></label>)}</div></div> : null}
            <div className={`rounded-xl border p-3 transition-[border-color,background-color,box-shadow] ${workflowStep === 1 ? "border-primary/45 bg-primary/[.055] ring-4 ring-primary/10" : "border-border/60 bg-muted/20"}`}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className={`text-[11px] font-semibold ${workflowStep === 1 ? "text-primary" : "text-muted-foreground"}`}>{workflowStep === 1 ? t("nextStep") : t("stepComplete")}</span>
                {workflowStep > 1 ? <Check className="size-4 text-emerald-600" /> : <ArrowRight className="size-4 text-primary" />}
              </div>
              <Button className="w-full" onClick={draftBeats ? approveScriptDraft : prepareScriptDraft}>{draftBeats ? <Check /> : <Sparkles />}{t(draftBeats ? "confirmScript" : "generateDraft")}</Button>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{workflowStep === 1 ? t(draftBeats ? "confirmScriptHint" : "generateDraftHint") : t("scriptReadyHint")}</p>
            </div>
          </div>
          {beats.length ? <div className="mt-5 space-y-2 border-t border-border/60 pt-5">
            {beats.map((beat) => <button key={beat.id} type="button" onClick={() => setActiveBeatId(beat.id)} className={`w-full rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] ${activeBeatId === beat.id ? "border-primary bg-primary/[.055] ring-2 ring-primary/10" : "border-border/70 bg-card hover:bg-muted/30"}`}>
              <div className="flex items-center justify-between gap-2"><select value={beat.role} onClick={(event) => event.stopPropagation()} onChange={(event) => { setPlanNeedsUpdate(true); setBeats((current) => current.map((item) => item.id === beat.id ? { ...item, role: event.target.value as GuidedEditRole } : item)); }} className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold text-primary">
                {GUIDED_EDIT_ROLES.map((role) => <option key={role} value={role}>{t(`beatRole_${role}`)}</option>)}
              </select><span className="text-[10px] text-muted-foreground">{t("beatDuration", { seconds: seconds(beat.estimatedDuration) })}</span></div>
              <p className="mt-2 text-sm leading-6 text-foreground">{beat.text}</p><p className="mt-1.5 text-[10px] text-muted-foreground">{t("boundScenes", { n: beat.sceneIds.length })}</p>
            </button>)}
          </div> : null}
        </Surface>

        <aside className="min-w-0 space-y-5">
          <Surface className="p-4 sm:p-5">
            <SectionHeader title={t("planTitle")} description={t("planDescription")} />
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground"><span>{t("speechRate")}</span><strong className="text-sm tabular-nums text-foreground">{speechRate.toFixed(2)}×</strong></span>
                <input type="range" min={MIN_GUIDED_SPEECH_RATE} max={MAX_GUIDED_SPEECH_RATE} step="0.05" value={speechRate} onChange={(event) => changeSpeechRate(Number(event.target.value))} disabled={brief.audioMode === "uploaded_voice" && Boolean(brief.voiceoverFile)} className="h-1.5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-45" />
              </label>
              <div className="space-y-2.5">
                <span className="text-xs font-medium text-muted-foreground">{t("editStyle")}</span>
                <div role="radiogroup" aria-label={t("editStyle")} className="grid grid-cols-2 gap-2">
                  {GUIDED_STYLE_OPTIONS.map(({ value, icon: Icon }) => <button key={value} type="button" role="radio" aria-checked={editStyle === value} onClick={() => patchBrief({ editStyle: value as GuidedEditStyle })} className={`min-h-16 cursor-pointer rounded-xl border p-2.5 text-left transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 ${editStyle === value ? "border-primary bg-primary/[.065] shadow-sm ring-2 ring-primary/10" : "border-border/70 bg-card hover:border-primary/35 hover:bg-muted/35"}`}>
                    <span className="flex items-center gap-2"><span className={`grid size-7 place-items-center rounded-lg ${editStyle === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><Icon className="size-3.5" /></span><span className="text-xs font-semibold text-foreground">{t(`editStyle_${value}`)}</span></span>
                    <span className="mt-1.5 block text-[10px] font-medium text-muted-foreground">{t(`editStyle_${value}Mood`)}</span>
                  </button>)}
                </div>
                <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[.07] to-transparent px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-primary">{t("styleEffect")}</p><p className="mt-1 text-[11px] leading-5 text-foreground/80">{t(`editStyle_${editStyle}Hint`)}</p></div>
              </div>
              <label className="block space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("aspectRatio")}</span><select value={brief.aspectRatio} onChange={(event) => patchBrief({ aspectRatio: event.target.value as GuidedEditBrief["aspectRatio"] })} className="h-10 w-full rounded-[10px] border border-input bg-card px-3 text-sm text-foreground"><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option></select></label>
              <label className="block space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("audioMode")}</span><select value={brief.audioMode} onChange={(event) => { const audioMode = event.target.value as GuidedEditBrief["audioMode"]; patchBrief({ audioMode, ...(audioMode === brief.audioMode ? {} : { voiceoverFile: undefined, voiceoverName: undefined }) }); }} className="h-10 w-full rounded-[10px] border border-input bg-card px-3 text-sm text-foreground"><option value="muted">{t("audioMuted")}</option><option value="original">{t("audioOriginal")}</option><option value="uploaded_voice">{t("audioUploadedVoice")}</option><option value="local_voice">{t("audioLocalVoice")}</option></select></label>
              {brief.audioMode === "uploaded_voice" ? <div ref={voiceoverSectionRef} aria-current={workflowStep === 2 ? "step" : undefined} className={`scroll-mt-24 rounded-xl border p-3 transition-[border-color,background-color,box-shadow] ${workflowStep === 2 ? "border-primary/50 bg-primary/[.055] ring-4 ring-primary/10" : "border-border/70 bg-muted/25"}`}><div className="mb-2 flex items-center justify-between"><span className={`text-[11px] font-semibold ${workflowStep === 2 ? "text-primary" : "text-muted-foreground"}`}>{workflowStep === 2 ? t("nextStep") : voiceoverReady ? t("stepComplete") : t("workflowStepVoice")}</span>{voiceoverReady ? <Check className="size-4 text-emerald-600" /> : null}</div><input ref={voiceoverRef} type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVoiceover(file); }} /><Button type="button" variant={workflowStep === 2 ? "default" : "outline"} size="sm" className="w-full" disabled={busy === "voiceover" || !scriptReady} onClick={() => voiceoverRef.current?.click()}>{busy === "voiceover" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Upload />}{brief.voiceoverName || t("workflowStep2UploadAction")}</Button><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{scriptReady ? t("voiceoverHint") : t("planRequired")}</p></div> : null}
              {brief.audioMode === "local_voice" ? <div ref={voiceoverSectionRef} aria-current={workflowStep === 2 ? "step" : undefined} className={`scroll-mt-24 rounded-xl border p-3 transition-[border-color,background-color,box-shadow] ${workflowStep === 2 ? "border-primary/50 bg-primary/[.055] ring-4 ring-primary/10" : "border-border/70 bg-muted/25"}`}><div className="mb-2 flex items-center justify-between"><span className={`text-[11px] font-semibold ${workflowStep === 2 ? "text-primary" : "text-muted-foreground"}`}>{workflowStep === 2 ? t("nextStep") : voiceoverReady ? t("stepComplete") : t("workflowStepVoice")}</span>{voiceoverReady ? <Check className="size-4 text-emerald-600" /> : null}</div><label className="mb-2 block space-y-1.5 text-[11px] font-medium text-muted-foreground"><span>{t("microsoftVoice")}</span><select value={brief.voiceoverVoice ?? DEFAULT_FREE_VOICE} onChange={(event) => patchBrief({ voiceoverVoice: event.target.value, voiceoverFile: undefined, voiceoverName: undefined })} className="h-9 w-full rounded-[9px] border border-input bg-card px-2 text-xs text-foreground">{FREE_TTS_VOICES.map((voice) => <option key={voice.value} value={voice.value}>{voice.label}</option>)}</select></label><Button type="button" variant={workflowStep === 2 ? "default" : "outline"} size="sm" className="w-full" disabled={busy === "voiceover" || !scriptReady} onClick={() => void synthesizeLocalVoice()}>{busy === "voiceover" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <AudioLines />}{brief.voiceoverFile ? t("regenerateLocalVoice") : t("workflowStep2Action")}</Button><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{!scriptReady ? t("planRequired") : brief.voiceoverFile ? t("localVoiceReady") : t("localVoiceHint")}</p></div> : null}
              <Checkbox checked={brief.burnSubtitles} onChange={(event) => patchBrief({ burnSubtitles: event.target.checked })} label={<span className="flex items-center gap-2"><Captions className="text-primary" />{t("burnSubtitles")}</span>} description={t("burnSubtitlesHint")} />
              {brief.burnSubtitles ? <div className="grid grid-cols-2 gap-3 rounded-xl border border-border/70 bg-muted/25 p-3"><label className="space-y-1.5 text-[11px] font-medium text-muted-foreground"><span>{t("captionLanguage")}</span><select value={brief.captionLanguage} onChange={(event) => patchBrief({ captionLanguage: event.target.value as GuidedEditBrief["captionLanguage"] })} className="h-9 w-full rounded-[9px] border border-input bg-card px-2 text-xs text-foreground"><option value="auto">{t("captionLanguageAuto")}</option><option value="zh">{t("captionLanguageZh")}</option><option value="en">{t("captionLanguageEn")}</option></select></label><label className="space-y-1.5 text-[11px] font-medium text-muted-foreground"><span>{t("captionSize")}</span><select value={brief.captionSize} onChange={(event) => patchBrief({ captionSize: event.target.value as GuidedEditBrief["captionSize"] })} className="h-9 w-full rounded-[9px] border border-input bg-card px-2 text-xs text-foreground"><option value="small">{t("captionSizeSmall")}</option><option value="medium">{t("captionSizeMedium")}</option><option value="large">{t("captionSizeLarge")}</option></select></label><p className="col-span-2 text-[11px] leading-4 text-muted-foreground">{t("captionFontHint")}</p></div> : null}
            </div>
            <div className={`mt-5 rounded-xl border p-3 ${durationTooLong ? "border-destructive/20 bg-destructive/8" : durationKind === "actual" ? "border-emerald-500/20 bg-emerald-500/[.06]" : "border-border/60 bg-muted/35"}`}><p className="text-sm font-semibold tabular-nums">{t(`outputDuration_${durationKind}`, { seconds: seconds(displayedDuration) })}</p><p className={`mt-1 text-xs leading-5 ${durationTooLong ? "text-destructive" : "text-muted-foreground"}`}>{durationTooLong ? t("durationTooLong", { seconds: Math.ceil(estimatedDuration), max: MAX_GUIDED_OUTPUT_SECONDS }) : t(`outputDuration_${durationKind}Hint`, { max: MAX_GUIDED_OUTPUT_SECONDS })}</p></div>
            <div ref={renderSectionRef} aria-current={workflowStep === 3 && !currentOutput ? "step" : undefined} className={`mt-4 grid scroll-mt-24 gap-2 rounded-xl border p-3 transition-[border-color,background-color,box-shadow] ${workflowStep === 3 && !currentOutput ? "border-primary/50 bg-primary/[.055] ring-4 ring-primary/10" : "border-border/60 bg-muted/15"}`}><div className="flex items-center justify-between"><span className={`text-[11px] font-semibold ${workflowStep === 3 && !currentOutput ? "text-primary" : "text-muted-foreground"}`}>{currentOutput ? t("stepComplete") : workflowStep === 3 ? t("finalStep") : t("workflowStepRender")}</span>{currentOutput ? <Check className="size-4 text-emerald-600" /> : null}</div><Button variant="outline" disabled={!scriptReady || durationTooLong || busy === "save" || rendering} onClick={() => void savePlan()}>{busy === "save" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Save />}{busy === "save" ? t("savingPlan") : t("savePlan")}</Button><Button size="lg" disabled={!renderReady || busy !== null || rendering} onClick={() => void render()}>{busy === "render" || rendering ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Scissors />}{busy === "render" || rendering ? t("rendering") : currentOutput ? t("rerender") : t("workflowStep3Action")}</Button>{!renderReady && !rendering ? <p className="text-center text-[11px] leading-4 text-muted-foreground">{!scriptReady ? t("planRequired") : !selectedSource ? t("sourceRequired") : !voiceoverReady ? t("voiceoverRequired") : t("durationTooLong", { seconds: Math.ceil(estimatedDuration), max: MAX_GUIDED_OUTPUT_SECONDS })}</p> : <p className="text-center text-[11px] leading-4 text-muted-foreground">{currentOutput ? t("renderCompleteHint") : t("renderActionHint")}</p>}</div>
          </Surface>
          {output?.outputUrl ? <Surface className="overflow-hidden p-3"><h2 className="mb-3 px-1 text-sm font-semibold">{t("latestVersion")}</h2><video controls preload="metadata" src={output.outputUrl} onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0) setActualOutputDuration(duration); }} className="aspect-video w-full rounded-xl bg-black object-contain" /><a href={output.downloadUrl || output.outputUrl} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border border-border bg-card text-sm font-semibold hover:bg-muted/60"><Download />{t("download")}</a></Surface> : null}
          {latestPlan?.error ? <Notice tone="danger">{latestPlan.error}</Notice> : null}
        </aside>
      </div>
    </PageFrame>
  );
}
