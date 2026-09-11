"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  LuCheck,
  LuClipboard,
  LuFileVideo,
  LuImage,
  LuLoaderCircle,
  LuSave,
  LuScanSearch,
  LuUpload,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/lib/i18n";
import type { MediaAnalysisResult } from "@/lib/media-analysis";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { PageFrame, PageHeader } from "@/components/studio/page";
import { Notice } from "@/components/ui/notice";

interface AnalysisResponse extends MediaAnalysisResult {
  metadata: {
    width: number;
    height: number;
    size: number;
    duration?: number;
    hasAudio?: boolean;
    shotCount?: number;
    frameTimes?: number[];
  };
}

interface ProjectOption { id: string; name: string }

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/35 p-3">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <p className="text-sm leading-6 text-foreground">{value || "—"}</p>
    </div>
  );
}

export default function MediaLabPage() {
  const t = useT("mediaLab");
  const locale = useLocale();
  const llm = useSettingsStore((state) => state.llm);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const configured = Boolean(llm.baseUrl && llm.apiKey && llm.model);
  const isVideo = file?.type.startsWith("video/") ?? false;

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/project").then(async (response) => response.ok ? response.json() : []).then((rows) => {
      if (cancelled || !Array.isArray(rows)) return;
      const options = rows.map((row) => ({ id: String(row.id), name: String(row.name || row.id) }));
      setProjects(options);
      setProjectId((current) => current || options[0]?.id || "");
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const fileMeta = useMemo(() => {
    if (!file) return "";
    const mb = file.size / 1024 / 1024;
    return `${file.name} · ${mb < 1 ? `${Math.round(file.size / 1024)} KB` : `${mb.toFixed(1)} MB`}`;
  }, [file]);

  const chooseFile = (next: File | null) => {
    setFile(next);
    setResult(null);
    setError("");
    setCopied(false);
    setSaveStatus("");
  };

  const analyze = async () => {
    if (!file || !configured || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("llmConfig", JSON.stringify(llm));
      const response = await fetch("/api/media/analyze", {
        method: "POST",
        headers: { "Accept-Language": locale },
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("failed"));
      setResult(data as AnalysisResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("failed"));
    } finally {
      setLoading(false);
    }
  };

  const copyPrompt = async () => {
    if (!result?.reusablePrompt) return;
    await navigator.clipboard.writeText(result.reusablePrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const saveToProject = async () => {
    if (!result || !projectId || saving) return;
    setSaving(true);
    setSaveStatus("");
    try {
      const response = await fetch(`/api/project/${projectId}/production`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({ mediaInsight: { mediaType: result.mediaType, summary: result.summary, tags: result.subjects, reusablePrompt: result.reusablePrompt } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("saveFailed"));
      setSaveStatus(t("savedToProject"));
    } catch (caught) {
      setSaveStatus(caught instanceof Error ? caught.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageFrame width="wide">
      <PageHeader title={t("eyebrow")} description={t("subtitle")} />

      <div className="grid gap-6 lg:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
        <section aria-label={t("choose")} className="space-y-4">
          <div className="studio-surface overflow-hidden shadow-none">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
            {previewUrl ? (
              <div className="relative flex aspect-[4/3] items-center justify-center bg-black/45">
                {isVideo ? (
                  <video src={previewUrl} controls preload="metadata" className="h-full w-full object-contain" />
                ) : (
                  // Blob previews cannot be optimized by next/image and are revoked on replacement.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="" className="h-full w-full object-contain" />
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center px-6 text-center outline-none transition-colors hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
              >
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <LuUpload className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-semibold">{t("dropTitle")}</span>
                <span className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{t("dropHint")}</span>
              </button>
            )}
            {file && (
              <div className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  {isVideo ? <LuFileVideo className="h-4 w-4 shrink-0" /> : <LuImage className="h-4 w-4 shrink-0" />}
                  <span className="truncate">{fileMeta}</span>
                </div>
                <button type="button" onClick={() => inputRef.current?.click()} className="min-h-8 shrink-0 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  {t("replace")}
                </button>
              </div>
            )}
          </div>

          {!configured && (
            <Notice tone="warning" title={t("needVision")} action={<Link href="/settings" className="inline-flex min-h-8 items-center text-xs font-semibold underline underline-offset-4">{t("configure")}</Link>} />
          )}
          {error && <Notice tone="danger">{error}</Notice>}

          <Button onClick={analyze} disabled={!file || !configured || loading} className="h-11 w-full brand-gradient text-white">
            {loading ? <LuLoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <LuScanSearch className="mr-2 h-4 w-4" aria-hidden="true" />}
            {loading ? t("analyzing") : t("analyze")}
          </Button>
          {loading && (
            <div role="status" className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
              {["stageSample", "stageVision", "stagePrompt"].map((key, index) => (
                <div key={key} className={`rounded-lg border px-2 py-2 ${index === 0 ? "border-primary/40 bg-primary/10 text-primary" : "border-border/50"}`}>{t(key)}</div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="analysis-heading" aria-live="polite" className="studio-surface min-w-0 p-4 shadow-none sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 id="analysis-heading" className="text-lg font-semibold">{t("resultTitle")}</h2>
            {result && (
              <div className="text-xs text-muted-foreground">
                {result.metadata.width}×{result.metadata.height}
                {result.metadata.duration ? ` · ${result.metadata.duration.toFixed(1)}s` : ""}
              </div>
            )}
          </div>

          {!result ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-border/60 px-8 text-center text-sm text-muted-foreground">
              <LuScanSearch className="mb-4 h-8 w-8 opacity-40" aria-hidden="true" />
              {t("empty")}
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("summary")}</h3>
                <p className="text-sm leading-6">{result.summary}</p>
                {result.subjects.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2" aria-label={t("subjects")}>
                    {result.subjects.map((subject) => <span key={subject} className="rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 text-xs text-primary">{subject}</span>)}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("visualStyle")}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <InfoCell label={t("lighting")} value={result.visualStyle.lighting} />
                  <InfoCell label={t("palette")} value={result.visualStyle.palette} />
                  <InfoCell label={t("composition")} value={result.visualStyle.composition} />
                  <InfoCell label={t("camera")} value={result.visualStyle.camera} />
                </div>
              </div>

              {result.motion && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("motion")}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <InfoCell label={t("pacing")} value={result.motion.pacing} />
                    <InfoCell label={t("sceneRhythm")} value={result.motion.sceneRhythm} />
                  </div>
                  {result.motion.cameraMoves.length > 0 && <p className="mt-2 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">{t("cameraMoves")}：</span>{result.motion.cameraMoves.join(" · ")}</p>}
                </div>
              )}

              <div className="rounded-xl border border-primary/25 bg-primary/8 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">{t("prompt")}</h3>
                  <button type="button" onClick={copyPrompt} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    {copied ? <LuCheck className="h-3.5 w-3.5" /> : <LuClipboard className="h-3.5 w-3.5" />}
                    {t(copied ? "copied" : "copy")}
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6">{result.reusablePrompt}</p>
                {result.negativePrompt && <p className="mt-3 border-t border-primary/15 pt-3 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">{t("negativePrompt")}：</span>{result.negativePrompt}</p>}
              </div>

              <div className="rounded-xl border border-border/60 bg-background/30 p-4">
                <label htmlFor="media-project" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("saveProject")}</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <select id="media-project" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSaveStatus(""); }} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    {projects.length ? projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>) : <option value="">{t("noProject")}</option>}
                  </select>
                  <Button onClick={saveToProject} disabled={!projectId || saving} className="h-10">
                    {saving ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <LuSave aria-hidden="true" />}
                    {saving ? t("saving") : t("saveInsight")}
                  </Button>
                </div>
                <div role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-primary">{saveStatus}</div>
              </div>

              {result.suggestedUses.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("uses")}</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {result.suggestedUses.map((use) => <li key={use} className="flex gap-2 rounded-lg bg-muted/20 px-3 py-2 text-xs leading-5"><LuCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />{use}</li>)}
                  </ul>
                </div>
              )}

              {result.metadata.shotCount != null && (
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full border border-border/60 px-2.5 py-1">{t("shots", { n: result.metadata.shotCount })}</span>
                  <span className="rounded-full border border-border/60 px-2.5 py-1">{t(result.metadata.hasAudio ? "audio" : "silent")}</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </PageFrame>
  );
}
