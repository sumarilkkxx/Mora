"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowLeft, LuCaptions, LuCheck, LuDownload, LuFilm, LuLoaderCircle,
  LuPlus, LuSave, LuScissors, LuSparkles, LuTrash2, LuUpload,
} from "react-icons/lu";
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
  GUIDED_EDIT_STYLES,
  GUIDED_EDIT_ROLES,
  MAX_GUIDED_OUTPUT_SECONDS,
  MAX_GUIDED_SPEECH_RATE,
  MIN_GUIDED_SPEECH_RATE,
  SCENE_LABELS,
  buildGuidedScriptBeats,
  detectGuidedCaptionLanguage,
  scaleGuidedBeatDurations,
  type GuidedEditBrief,
  type GuidedEditPlanDocument,
  type GuidedScene,
  type GuidedScriptBeat,
  type GuidedEditRole,
  type GuidedEditStyle,
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
  error?: string | null;
  document: GuidedEditPlanDocument;
  composition?: {
    status: string;
    outputUrl?: string | null;
    downloadUrl?: string | null;
  } | null;
}

const ACCEPT = ".mp4,.mov,.webm,.mkv,.m4v,video/mp4,video/quicktime,video/webm";

function seconds(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

export default function GuidedEditWorkspace() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const t = useT("guidedEdit");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const voiceoverRef = useRef<HTMLInputElement>(null);
  const [projectName, setProjectName] = useState("");
  const [sources, setSources] = useState<MediaSourceRow[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [brief, setBrief] = useState<GuidedEditBrief>(DEFAULT_GUIDED_EDIT_BRIEF);
  const [scenes, setScenes] = useState<GuidedScene[]>([]);
  const [beats, setBeats] = useState<GuidedScriptBeat[]>([]);
  const [activeBeatId, setActiveBeatId] = useState("");
  const [planId, setPlanId] = useState("");
  const [latestPlan, setLatestPlan] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"upload" | "voiceover" | "analyze" | "save" | "render" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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
        setPlanId(plan.id);
        setSourceId(plan.document.timeline[0]?.sourceId || nextSources[0]?.id || "");
        setBrief(plan.document.brief);
        setScenes(plan.document.scenes);
        setBeats(plan.document.beats);
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

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  const rendering = latestPlan?.status === "rendering";
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void loadWorkspace(true), 2500);
    return () => clearInterval(timer);
  }, [loadWorkspace, rendering]);

  const estimatedDuration = useMemo(() => beats.reduce((sum, beat) => sum + beat.estimatedDuration, 0), [beats]);
  const speechRate = brief.speechRate ?? 1;
  const editStyle = brief.editStyle ?? "natural";
  const durationTooLong = estimatedDuration > MAX_GUIDED_OUTPUT_SECONDS + 0.01;

  function patchBrief(patch: Partial<GuidedEditBrief>) {
    setBrief((current) => ({ ...current, ...patch }));
    setMessage("");
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("localVoiceFailed")); }
    finally { setBusy(null); }
  }

  function buildBeats() {
    const next = buildGuidedScriptBeats(brief);
    setBeats(next);
    setActiveBeatId(next[0]?.id || "");
    setMessage("");
  }

  function toggleSceneBinding(sceneId: string) {
    if (!activeBeatId) return;
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
      await loadWorkspace(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("renderFailed")); }
    finally { setBusy(null); }
  }

  if (loading) return <PageFrame width="full"><div className="flex min-h-[60vh] items-center justify-center"><LuLoaderCircle className="size-7 animate-spin text-primary motion-reduce:animate-none" /></div></PageFrame>;

  const activeBeat = beats.find((beat) => beat.id === activeBeatId) ?? null;
  const output = latestPlan?.composition?.status === "done" ? latestPlan.composition : null;
  const needsVoiceover = brief.audioMode === "uploaded_voice" || brief.audioMode === "local_voice";
  const voiceoverReady = !needsVoiceover || Boolean(brief.voiceoverFile);

  return (
    <PageFrame width="full" className="guided-edit-workspace">
      <PageHeader
        eyebrow={t("workspaceEyebrow")}
        title={projectName || t("workspaceTitle")}
        description={t("workspaceDescription")}
        actions={<div className="flex gap-2"><Link href={backHref}><Button variant="ghost"><LuArrowLeft />{t(fromTaskCenter ? "backTasks" : "backProjects")}</Button></Link><Link href={exportHref}><Button variant="outline">{t("openExport")}</Button></Link></div>}
      />
      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}
      {message ? <Notice tone="success" className="mb-4"><LuCheck className="mr-2 inline size-4" />{message}</Notice> : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(300px,.85fr)_minmax(400px,1.2fr)_minmax(300px,.8fr)]">
        <Surface className="min-w-0 p-4 sm:p-5">
          <SectionHeader title={t("sourceTitle")} description={t("sourceDescription")} />
          <input ref={inputRef} hidden type="file" accept={ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          <div className="mb-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy === "upload"} onClick={() => inputRef.current?.click()}>{busy === "upload" ? <LuLoaderCircle className="animate-spin" /> : <LuUpload />}{t("uploadSource")}</Button>
            <Button size="sm" disabled={!selectedSource || busy === "analyze"} onClick={() => void analyzeScenes()}>{busy === "analyze" ? <LuLoaderCircle className="animate-spin" /> : <LuFilm />}{busy === "analyze" ? t("analyzingScenes") : t("analyzeScenes")}</Button>
          </div>
          {sources.length > 1 ? <select className="mb-4 h-9 w-full rounded-[10px] border border-input bg-card px-3 text-sm" value={sourceId} onChange={(event) => { const next = sources.find((source) => source.id === event.target.value); setSourceId(event.target.value); setScenes(next?.scenes ?? []); }}>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.originalName}</option>)}
          </select> : null}
          {!selectedSource ? <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border text-center"><LuUpload className="mb-3 size-7 text-muted-foreground" /><p className="text-sm font-medium">{t("noSource")}</p></div> : scenes.length === 0 ? <div className="relative flex min-h-48 overflow-hidden rounded-xl border border-border/70 bg-muted text-white shadow-sm">
            {selectedSource.posterUrl ? <>
              {/* eslint-disable-next-line @next/next/no-img-element -- persistent local first-frame poster */}
              <img src={selectedSource.posterUrl} alt={t("sourcePreviewAlt", { name: selectedSource.originalName })} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/5" />
            </> : <div className="absolute inset-0 grid place-items-center bg-muted"><LuFilm className="size-8 text-muted-foreground" /></div>}
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
                    {bound ? <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><LuCheck className="size-3" /></span> : null}
                  </button>
                  <select value={scene.label} onChange={(event) => setScenes((current) => current.map((item) => item.id === scene.id ? { ...item, label: event.target.value as SceneLabel, selected: event.target.value !== "unused" } : item))} className="h-8 w-full border-0 bg-card px-2 text-[11px] outline-none">
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
            <SegmentedItem selected={brief.inputMode === "guided"} onClick={() => patchBrief({ inputMode: "guided" })}>{t("modeGuided")}</SegmentedItem>
            <SegmentedItem selected={brief.inputMode === "full_script"} onClick={() => patchBrief({ inputMode: "full_script" })}>{t("modeFullScript")}</SegmentedItem>
          </SegmentedControl>
          <div className="mt-4 grid gap-4">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("productName")}</span><Input value={brief.productName} onChange={(event) => patchBrief({ productName: event.target.value })} placeholder={t("productNamePlaceholder")} /></label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("promotionGoal")}</span><Textarea value={brief.promotionGoal} onChange={(event) => patchBrief({ promotionGoal: event.target.value })} placeholder={t("promotionGoalPlaceholder")} className="min-h-20" /></label>
            {brief.inputMode === "full_script" ? <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("fullScript")}</span><Textarea value={brief.fullScript} onChange={(event) => patchBrief({ fullScript: event.target.value })} placeholder={t("fullScriptPlaceholder")} className="min-h-44" /></label> : <>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("hook")}</span><Textarea value={brief.hook} onChange={(event) => patchBrief({ hook: event.target.value })} placeholder={t("hookPlaceholder")} className="min-h-20" /></label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("introduction")}</span><Textarea value={brief.introduction} onChange={(event) => patchBrief({ introduction: event.target.value })} placeholder={t("introductionPlaceholder")} className="min-h-20" /></label>
              {brief.sellingPoints.map((point, index) => <div key={index} className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <div className="flex items-center justify-between gap-3"><span>{t("sellingPoint", { n: index + 1 })}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeSellingPoint", { n: index + 1 })} title={t("removeSellingPoint", { n: index + 1 })} onClick={() => patchBrief({ sellingPoints: brief.sellingPoints.filter((_, itemIndex) => itemIndex !== index) })}><LuTrash2 /></Button></div>
                <Textarea value={point} onChange={(event) => patchBrief({ sellingPoints: brief.sellingPoints.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} placeholder={t("sellingPointPlaceholder")} className="min-h-20" />
              </div>)}
              {brief.sellingPoints.length < 6 ? <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => patchBrief({ sellingPoints: [...brief.sellingPoints, ""] })}><LuPlus />{t("addSellingPoint")}</Button> : null}
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("usageScene")}</span><Textarea value={brief.usageScene} onChange={(event) => patchBrief({ usageScene: event.target.value })} placeholder={t("usageScenePlaceholder")} className="min-h-20" /></label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("cta")}</span><Textarea value={brief.cta} onChange={(event) => patchBrief({ cta: event.target.value })} placeholder={t("ctaPlaceholder")} className="min-h-20" /></label>
            </>}
            <Button onClick={buildBeats}><LuSparkles />{t("buildScript")}</Button>
          </div>
          {beats.length ? <div className="mt-5 space-y-2 border-t border-border/60 pt-5">
            {beats.map((beat) => <button key={beat.id} type="button" onClick={() => setActiveBeatId(beat.id)} className={`w-full rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] ${activeBeatId === beat.id ? "border-primary bg-primary/[.055] ring-2 ring-primary/10" : "border-border/70 bg-card hover:bg-muted/30"}`}>
              <div className="flex items-center justify-between gap-2"><select value={beat.role} onClick={(event) => event.stopPropagation()} onChange={(event) => setBeats((current) => current.map((item) => item.id === beat.id ? { ...item, role: event.target.value as GuidedEditRole } : item))} className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold text-primary">
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
                <div className="overflow-x-auto border-b border-border/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div role="tablist" aria-label={t("editStyle")} className="flex min-w-max gap-4">
                    {GUIDED_EDIT_STYLES.map((style) => <button key={style} type="button" role="tab" aria-selected={editStyle === style} onClick={() => patchBrief({ editStyle: style as GuidedEditStyle })} className={`relative pb-2 text-xs font-semibold transition-colors ${editStyle === style ? "text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground"}`}>{t(`editStyle_${style}`)}</button>)}
                  </div>
                </div>
                <div role="tabpanel" className="rounded-xl bg-muted/35 px-3 py-2.5"><p className="text-xs font-semibold text-foreground">{t(`editStyle_${editStyle}`)}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t(`editStyle_${editStyle}Hint`)}</p></div>
              </div>
              <label className="block space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("aspectRatio")}</span><select value={brief.aspectRatio} onChange={(event) => patchBrief({ aspectRatio: event.target.value as GuidedEditBrief["aspectRatio"] })} className="h-10 w-full rounded-[10px] border border-input bg-card px-3 text-sm text-foreground"><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option></select></label>
              <label className="block space-y-1.5 text-xs font-medium text-muted-foreground"><span>{t("audioMode")}</span><select value={brief.audioMode} onChange={(event) => { const audioMode = event.target.value as GuidedEditBrief["audioMode"]; patchBrief({ audioMode, ...(audioMode === brief.audioMode ? {} : { voiceoverFile: undefined, voiceoverName: undefined }) }); }} className="h-10 w-full rounded-[10px] border border-input bg-card px-3 text-sm text-foreground"><option value="muted">{t("audioMuted")}</option><option value="original">{t("audioOriginal")}</option><option value="uploaded_voice">{t("audioUploadedVoice")}</option><option value="local_voice">{t("audioLocalVoice")}</option></select></label>
              {brief.audioMode === "uploaded_voice" ? <div className="rounded-xl border border-border/70 bg-muted/25 p-3"><input ref={voiceoverRef} type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVoiceover(file); }} /><Button type="button" variant="outline" size="sm" className="w-full" disabled={busy === "voiceover"} onClick={() => voiceoverRef.current?.click()}>{busy === "voiceover" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuUpload />}{brief.voiceoverName || t("uploadVoiceover")}</Button><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{t("voiceoverHint")}</p></div> : null}
              {brief.audioMode === "local_voice" ? <div className="rounded-xl border border-border/70 bg-muted/25 p-3"><label className="mb-2 block space-y-1.5 text-[11px] font-medium text-muted-foreground"><span>{t("microsoftVoice")}</span><select value={brief.voiceoverVoice ?? DEFAULT_FREE_VOICE} onChange={(event) => patchBrief({ voiceoverVoice: event.target.value, voiceoverFile: undefined, voiceoverName: undefined })} className="h-9 w-full rounded-[9px] border border-input bg-card px-2 text-xs text-foreground">{FREE_TTS_VOICES.map((voice) => <option key={voice.value} value={voice.value}>{voice.label}</option>)}</select></label><Button type="button" variant="outline" size="sm" className="w-full" disabled={busy === "voiceover" || !beats.length} onClick={() => void synthesizeLocalVoice()}>{busy === "voiceover" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuSparkles />}{brief.voiceoverFile ? t("regenerateLocalVoice") : t("generateLocalVoice")}</Button><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{brief.voiceoverFile ? t("localVoiceReady") : t("localVoiceHint")}</p></div> : null}
              <Checkbox checked={brief.burnSubtitles} onChange={(event) => patchBrief({ burnSubtitles: event.target.checked })} label={<span className="flex items-center gap-2"><LuCaptions className="text-primary" />{t("burnSubtitles")}</span>} description={t("burnSubtitlesHint")} />
              {brief.burnSubtitles ? <div className="grid grid-cols-2 gap-3 rounded-xl border border-border/70 bg-muted/25 p-3"><label className="space-y-1.5 text-[11px] font-medium text-muted-foreground"><span>{t("captionLanguage")}</span><select value={brief.captionLanguage} onChange={(event) => patchBrief({ captionLanguage: event.target.value as GuidedEditBrief["captionLanguage"] })} className="h-9 w-full rounded-[9px] border border-input bg-card px-2 text-xs text-foreground"><option value="auto">{t("captionLanguageAuto")}</option><option value="zh">{t("captionLanguageZh")}</option><option value="en">{t("captionLanguageEn")}</option></select></label><label className="space-y-1.5 text-[11px] font-medium text-muted-foreground"><span>{t("captionSize")}</span><select value={brief.captionSize} onChange={(event) => patchBrief({ captionSize: event.target.value as GuidedEditBrief["captionSize"] })} className="h-9 w-full rounded-[9px] border border-input bg-card px-2 text-xs text-foreground"><option value="small">{t("captionSizeSmall")}</option><option value="medium">{t("captionSizeMedium")}</option><option value="large">{t("captionSizeLarge")}</option></select></label><p className="col-span-2 text-[11px] leading-4 text-muted-foreground">{t("captionFontHint")}</p></div> : null}
            </div>
            <div className={`mt-5 rounded-xl p-3 ${durationTooLong ? "bg-destructive/8" : "bg-muted/35"}`}><p className="text-sm font-semibold tabular-nums">{t("estimatedOutput", { seconds: seconds(estimatedDuration) })}</p><p className={`mt-1 text-xs leading-5 ${durationTooLong ? "text-destructive" : "text-muted-foreground"}`}>{durationTooLong ? t("durationTooLong", { seconds: Math.ceil(estimatedDuration), max: MAX_GUIDED_OUTPUT_SECONDS }) : t("autoDurationHint", { max: MAX_GUIDED_OUTPUT_SECONDS })}</p></div>
            <div className="mt-4 grid gap-2"><Button variant="outline" disabled={!beats.length || durationTooLong || busy === "save" || rendering} onClick={() => void savePlan()}>{busy === "save" ? <LuLoaderCircle className="animate-spin" /> : <LuSave />}{busy === "save" ? t("savingPlan") : t("savePlan")}</Button><Button size="lg" disabled={!beats.length || durationTooLong || !selectedSource || !voiceoverReady || busy !== null || rendering} onClick={() => void render()}>{busy === "render" || rendering ? <LuLoaderCircle className="animate-spin" /> : <LuScissors />}{busy === "render" || rendering ? t("rendering") : t("render")}</Button></div>
          </Surface>
          {output?.outputUrl ? <Surface className="overflow-hidden p-3"><h2 className="mb-3 px-1 text-sm font-semibold">{t("latestVersion")}</h2><video controls preload="metadata" src={output.outputUrl} className="aspect-video w-full rounded-xl bg-black object-contain" /><a href={output.downloadUrl || output.outputUrl} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border border-border bg-card text-sm font-semibold hover:bg-muted/60"><LuDownload />{t("download")}</a></Surface> : null}
          {latestPlan?.error ? <Notice tone="danger">{latestPlan.error}</Notice> : null}
        </aside>
      </div>
    </PageFrame>
  );
}
