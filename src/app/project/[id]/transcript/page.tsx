"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuCaptions,
  LuCircleCheckBig,
  LuCpu,
  LuDownload,
  LuFileVideo,
  LuLoaderCircle,
  LuRotateCcw,
  LuScissors,
  LuShieldCheck,
  LuUpload,
  LuVolume2,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Notice } from "@/components/ui/notice";
import { PageFrame, PageHeader } from "@/components/studio/page";
import { useLocale, useT } from "@/lib/i18n";
import { decodeAudioForAsr } from "@/lib/browser-audio";
import {
  LOCAL_ASR_MODELS,
  type AsrWorkerMessage,
  type LocalAsrDevice,
  type LocalAsrModel,
} from "@/lib/local-asr";
import {
  DEFAULT_TRANSCRIPT_EDIT_PLAN,
  keepRangesForPlan,
  outputDuration,
  removedRangesForPlan,
  sanitizeTranscriptDocument,
  type TranscriptDocument,
  type TranscriptEditPlan,
} from "@/lib/transcript-editor";

interface CompositionResult {
  id: string;
  status: "pending" | "composing" | "done" | "failed";
  outputUrl?: string | null;
  downloadUrl?: string | null;
}

interface MediaEditRow {
  id: string;
  revision: number;
  status: "queued" | "rendering" | "done" | "failed";
  error?: string | null;
  composition?: CompositionResult | null;
}

interface MediaSourceRow {
  id: string;
  originalName: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  status: "uploaded" | "transcribing" | "ready" | "failed";
  progress: number;
  model?: string | null;
  device?: LocalAsrDevice | null;
  transcript?: TranscriptDocument | null;
  error?: string | null;
  edits: MediaEditRow[];
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function TranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT("transcript");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef(0);
  const [projectName, setProjectName] = useState("");
  const [sources, setSources] = useState<MediaSourceRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"upload" | "decode" | "transcribe" | "render" | null>(null);
  const [error, setError] = useState("");
  const [model, setModel] = useState<LocalAsrModel>(LOCAL_ASR_MODELS[0].id);
  const [language, setLanguage] = useState("auto");
  const [device, setDevice] = useState<LocalAsrDevice | null>(null);
  const [fallback, setFallback] = useState(false);
  const [phase, setPhase] = useState<"loading" | "transcribing" | null>(null);
  const [progress, setProgress] = useState(0);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [removeSilence, setRemoveSilence] = useState(false);
  const [burnSubtitles, setBurnSubtitles] = useState(true);

  const loadSources = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/project/${id}/media`, { headers: { "Accept-Language": locale } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("loadFailed"));
      const next = data.sources as MediaSourceRow[];
      setSources(next);
      setSelectedId((current) => current && next.some((source) => source.id === current) ? current : next[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loadFailed"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [id, locale, t]);

  useEffect(() => {
    void loadSources();
    void fetch(`/api/project/${id}`).then((response) => response.ok ? response.json() : null).then((project) => setProjectName(project?.name || "")).catch(() => {});
  }, [id, loadSources]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
  }, []);

  const hasRendering = sources.some((source) => source.edits.some((edit) => edit.status === "rendering" || edit.status === "queued"));
  useEffect(() => {
    if (!hasRendering) return;
    const timer = setInterval(() => void loadSources(true), 2500);
    return () => clearInterval(timer);
  }, [hasRendering, loadSources]);

  const selected = sources.find((source) => source.id === selectedId) ?? null;
  const transcript = useMemo(
    () => selected ? sanitizeTranscriptDocument(selected.transcript, selected.duration / 1000) : null,
    [selected],
  );
  const plan = useMemo<TranscriptEditPlan>(() => ({
    ...DEFAULT_TRANSCRIPT_EDIT_PLAN,
    removedWordIds: removedIds,
    removeSilence,
    burnSubtitles,
  }), [burnSubtitles, removeSilence, removedIds]);
  const keepRanges = useMemo(() => transcript ? keepRangesForPlan(transcript, plan) : [], [plan, transcript]);
  const editedSeconds = outputDuration(keepRanges);
  const removedSeconds = transcript ? removedRangesForPlan(transcript, plan).reduce((sum, range) => sum + range.end - range.start, 0) : 0;

  useEffect(() => {
    setRemovedIds([]);
    setRemoveSilence(false);
    setBurnSubtitles(true);
    setError("");
  }, [selectedId]);

  const patchSource = useCallback((sourceId: string, patch: Partial<MediaSourceRow>) => {
    setSources((current) => current.map((source) => source.id === sourceId ? { ...source, ...patch } : source));
  }, []);

  async function upload(file: File) {
    setBusy("upload");
    setError("");
    try {
      const response = await fetch(`/api/project/${id}/media`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "Accept-Language": locale,
        },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("uploadFailed"));
      await loadSources(true);
      setSelectedId(data.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("uploadFailed"));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function updateTranscriptState(sourceId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/project/${id}/media/${sourceId}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": locale },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("transcriptionFailed"));
    return data;
  }

  async function startTranscription() {
    if (!selected) return;
    let taskStarted = false;
    setError("");
    setFallback(false);
    setDevice(null);
    setProgress(0);
    progressRef.current = 0;
    setBusy("decode");
    try {
      const mediaResponse = await fetch(selected.url);
      if (!mediaResponse.ok) throw new Error(t("loadFailed"));
      const pcm = await decodeAudioForAsr(await mediaResponse.arrayBuffer());
      await updateTranscriptState(selected.id, { action: "start", model, language });
      taskStarted = true;
      patchSource(selected.id, { status: "transcribing", progress: 0, error: null });
      setBusy("transcribe");

      const worker = new Worker(new URL("../../../../workers/asr.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      heartbeatRef.current = setInterval(() => {
        void updateTranscriptState(selected.id, { action: "heartbeat", progress: progressRef.current }).catch(() => {});
      }, 15_000);

      worker.onmessage = async (event: MessageEvent<AsrWorkerMessage>) => {
        const message = event.data;
        if (message.type === "device") {
          setDevice(message.device);
          if (message.fallback) setFallback(true);
          return;
        }
        if (message.type === "progress") {
          setPhase(message.phase);
          const mapped = message.phase === "loading" ? Math.round(message.progress * 0.55) : Math.round(55 + message.progress * 0.44);
          progressRef.current = Math.max(progressRef.current, Math.min(99, mapped));
          setProgress(progressRef.current);
          return;
        }
        if (message.type === "complete") {
          try {
            await updateTranscriptState(selected.id, { action: "complete", transcript: message.transcript });
            await loadSources(true);
            setProgress(100);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("transcriptionFailed"));
          } finally {
            finishWorker();
          }
          return;
        }
        if (message.type === "error") {
          setError(message.error || t("transcriptionFailed"));
          await updateTranscriptState(selected.id, { action: "fail", error: message.error }).catch(() => {});
          patchSource(selected.id, { status: "failed", error: message.error });
          finishWorker();
        }
      };
      worker.onerror = (event) => {
        const message = event.message || t("transcriptionFailed");
        setError(message);
        void updateTranscriptState(selected.id, { action: "fail", error: message });
        patchSource(selected.id, { status: "failed", error: message });
        finishWorker();
      };
      worker.postMessage({ type: "transcribe", audio: pcm, model, language, preferWebGpu: true }, [pcm.buffer]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("transcriptionFailed");
      setError(message);
      if (taskStarted) await updateTranscriptState(selected.id, { action: "fail", error: message }).catch(() => {});
      finishWorker();
    }
  }

  function finishWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    setBusy(null);
    setPhase(null);
  }

  function toggleWord(wordId: string) {
    setRemovedIds((current) => current.includes(wordId) ? current.filter((id) => id !== wordId) : [...current, wordId]);
  }

  async function renderEdit() {
    if (!selected || !transcript) return;
    setBusy("render");
    setError("");
    try {
      const response = await fetch(`/api/project/${id}/media/${selected.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({ plan }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("renderFailed"));
      await loadSources(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("renderFailed"));
    } finally {
      setBusy(null);
    }
  }

  const activeRender = selected?.edits.some((edit) => edit.status === "rendering" || edit.status === "queued") ?? false;
  const originalSeconds = transcript?.duration ?? (selected?.duration ?? 0) / 1000;
  const progressLabel = busy === "decode"
    ? t("decoding")
    : phase === "loading"
      ? t("loadingModel", { n: progress })
      : t("transcribing");

  return (
    <PageFrame width="full" className="max-w-7xl">
      <PageHeader variant="compact" title={t("title")} description={t("subtitle")} context={<>          <Link href={`/project/${id}/assets`} className="inline-flex min-h-8 items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <LuArrowLeft className="h-4 w-4" />{t("back")}
          </Link><span aria-hidden="true">/</span><span>{projectName}</span></>} actions={<div className="flex max-w-md items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5 text-xs leading-5 text-emerald-700 dark:text-emerald-300">
          <LuShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{t("localPrivacy")}
        </div>} />

      {error && <Notice tone="danger" className="mb-5">{error}</Notice>}

      <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <div className="studio-surface p-4 shadow-none sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h2 className="font-semibold">{t("uploadTitle")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("uploadHint")}</p></div>
            <span className="rounded-lg bg-primary/10 p-2 text-primary"><LuUpload /></span>
          </div>
          <input ref={inputRef} className="hidden" type="file" accept=".mp4,.mov,.webm,.mkv,.m4v,video/mp4,video/quicktime,video/webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          <Button className="h-10 w-full" disabled={busy === "upload"} onClick={() => inputRef.current?.click()}>
            {busy === "upload" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuFileVideo />}
            {busy === "upload" ? t("uploading") : t("chooseVideo")}
          </Button>

          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("sources")}</h3>
          {loading ? <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><LuLoaderCircle className="animate-spin motion-reduce:animate-none" />{t("loading")}</div> : sources.length ? (
            <div className="space-y-2">
              {sources.map((source) => <button key={source.id} type="button" aria-pressed={source.id === selectedId} onClick={() => setSelectedId(source.id)} className={`w-full rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${source.id === selectedId ? "border-primary/40 bg-primary/8" : "border-border/50 bg-background/30 hover:border-border"}`}>
                <span className="block truncate text-sm font-medium">{source.originalName}</span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>{t("sourceMeta", { duration: formatDuration(source.duration / 1000), size: formatBytes(source.sizeBytes) })}</span>
                  <span className={source.status === "ready" ? "text-emerald-500" : source.status === "failed" ? "text-destructive" : ""}>{t(`status_${source.status}`)}</span>
                </span>
              </button>)}
            </div>
          ) : <div className="rounded-xl border border-dashed border-border p-5 text-center"><p className="text-sm font-medium">{t("noSource")}</p><p className="mt-1 text-xs text-muted-foreground">{t("noSourceHint")}</p></div>}
        </div>

        <div className="studio-surface p-4 shadow-none sm:p-5">
          {selected ? <>
            <div className="overflow-hidden rounded-xl bg-black"><video key={selected.id} src={selected.url} controls preload="metadata" className="aspect-video max-h-[460px] w-full object-contain" /></div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-xs font-medium text-muted-foreground">{t("model")}
                <select value={model} disabled={busy === "decode" || busy === "transcribe"} onChange={(event) => setModel(event.target.value as LocalAsrModel)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <option value={LOCAL_ASR_MODELS[0].id}>{t("modelTiny")}</option>
                  <option value={LOCAL_ASR_MODELS[1].id}>{t("modelBase")}</option>
                </select>
              </label>
              <label className="flex-1 text-xs font-medium text-muted-foreground">{t("language")}
                <select value={language} disabled={busy === "decode" || busy === "transcribe"} onChange={(event) => setLanguage(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <option value="auto">{t("languageAuto")}</option><option value="zh">{t("languageZh")}</option><option value="en">{t("languageEn")}</option>
                </select>
              </label>
              <Button className="h-10 sm:min-w-36" disabled={!selected.hasAudio || selected.duration > 45 * 60 * 1000 || busy === "decode" || busy === "transcribe"} onClick={() => void startTranscription()}>
                {busy === "decode" || busy === "transcribe" ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuCpu />}
                {transcript ? t("retryTranscribe") : t("startTranscribe")}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{!selected.hasAudio ? t("noAudio") : selected.duration > 45 * 60 * 1000 ? t("tooLong") : t("transcribeHint")}</span>
              {(device || selected.device) && <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground">{(device || selected.device) === "webgpu" ? t("deviceWebgpu") : t("deviceWasm")}</span>}
            </div>
            {(busy === "decode" || busy === "transcribe") && <div className="mt-4" role="status" aria-live="polite"><div className="mb-1.5 flex items-center justify-between text-xs"><span>{progressLabel}</span><span className="tabular-nums text-muted-foreground">{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(3, progress)}%` }} /></div>{fallback && <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{t("fallbackWasm")}</p>}</div>}
            {selected.error && selected.status === "failed" && <p className="mt-3 text-xs text-destructive">{selected.error}</p>}
          </> : <div className="flex min-h-80 flex-col items-center justify-center text-center"><LuFileVideo className="mb-3 h-8 w-8 text-muted-foreground" /><p className="text-sm font-medium">{t("noSource")}</p><p className="mt-1 text-xs text-muted-foreground">{t("noSourceHint")}</p></div>}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="studio-surface p-4 shadow-none sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="flex items-center gap-2 font-semibold"><LuScissors className="text-primary" />{t("editorTitle")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{transcript ? t("editorHint") : t("needTranscript")}</p></div>
            {transcript && <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{t("selectedWords", { n: removedIds.length })}</span><Button variant="outline" size="sm" disabled={!removedIds.length} onClick={() => setRemovedIds([])}><LuRotateCcw />{t("reset")}</Button></div>}
          </div>
          {transcript ? <div className="max-h-[520px] overflow-y-auto rounded-xl border border-border/50 bg-background/30 p-3 leading-8 sm:p-4">
            {transcript.words.map((word) => {
              const removed = removedIds.includes(word.id);
              return <button key={word.id} type="button" aria-pressed={removed} title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s`} onClick={() => toggleWord(word.id)} className={`mr-1 rounded px-1.5 py-0.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${removed ? "bg-destructive/12 text-destructive line-through decoration-2" : "hover:bg-primary/10"}`}>{word.text}</button>;
            })}
          </div> : <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">{selected ? t("needTranscript") : t("noSourceHint")}</div>}
        </div>

        <aside className="space-y-5">
          <div className="studio-surface p-4 shadow-none sm:p-5">
            <Checkbox
              checked={removeSilence}
              disabled={!transcript}
              onChange={(event) => setRemoveSilence(event.target.checked)}
              className="rounded-xl border border-border/60 bg-card/70 p-3"
              label={<span className="flex items-center gap-2"><LuVolume2 className="text-primary" aria-hidden="true" />{t("silence")}</span>}
              description={t("silenceHint", { n: transcript?.silenceRanges.length ?? 0 })}
            />
            <Checkbox
              checked={burnSubtitles}
              disabled={!transcript}
              onChange={(event) => setBurnSubtitles(event.target.checked)}
              className="mt-3 rounded-xl border border-border/60 bg-card/70 p-3"
              label={<span className="flex items-center gap-2"><LuCaptions className="text-primary" aria-hidden="true" />{t("subtitles")}</span>}
              description={t("subtitlesHint")}
            />

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/30 p-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("original")}</p><p className="mt-1 text-sm font-semibold tabular-nums">{formatDuration(originalSeconds)}</p></div>
              <div className="rounded-lg bg-primary/8 p-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("output")}</p><p className="mt-1 text-sm font-semibold tabular-nums text-primary">{formatDuration(editedSeconds)}</p></div>
              <div className="rounded-lg bg-destructive/8 p-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("removed")}</p><p className="mt-1 text-sm font-semibold tabular-nums text-destructive">-{formatDuration(removedSeconds)}</p></div>
            </div>
            <Button className="mt-4 h-10 w-full" disabled={!transcript || editedSeconds < 0.5 || busy === "render" || activeRender} onClick={() => void renderEdit()}>
              {busy === "render" || activeRender ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuScissors />}
              {busy === "render" || activeRender ? t("rendering") : t("render")}
            </Button>
          </div>

          <div className="studio-surface p-4 shadow-none sm:p-5">
            <h2 className="mb-3 font-semibold">{t("versions")}</h2>
            {selected?.edits.length ? <div className="space-y-2">{selected.edits.map((edit) => <div key={edit.id} className="rounded-xl border border-border/50 bg-background/30 p-3">
              <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-medium">{edit.status === "done" ? <LuCircleCheckBig className="text-emerald-500" /> : edit.status === "failed" ? <span className="h-2 w-2 rounded-full bg-destructive" /> : <LuLoaderCircle className="animate-spin text-primary motion-reduce:animate-none" />}{t("revision", { n: edit.revision })}</span><span className="text-[10px] uppercase text-muted-foreground">{edit.status === "done" ? t("done") : edit.status === "failed" ? t("failed") : t("rendering")}</span></div>
              {edit.error && <p className="mt-2 text-xs text-destructive">{edit.error}</p>}
              {edit.composition?.status === "done" && edit.composition.outputUrl && <><video controls preload="metadata" src={edit.composition.outputUrl} className="mt-3 aspect-video w-full rounded-lg bg-black object-contain" /><div className="mt-2 flex gap-2"><a href={edit.composition.downloadUrl || edit.composition.outputUrl} className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"><LuDownload />{t("download")}</a><Link href={`/project/${id}/export`} className="inline-flex h-7 items-center rounded-lg px-2.5 text-xs font-medium text-primary hover:bg-primary/10">{t("openExport")}</Link></div></>}
            </div>)}</div> : <p className="text-sm text-muted-foreground">{t("noVersions")}</p>}
          </div>
        </aside>
      </section>
    </PageFrame>
  );
}
