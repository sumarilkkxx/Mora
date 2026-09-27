"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Download, FileJson2, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useT } from "@/lib/i18n";

interface DiagnosticPreviewFile {
  path: string;
  category: string;
  sizeBytes: number;
  content: string;
}

interface DiagnosticPreview {
  id: string;
  generatedAt: string;
  riskNotice: string;
  missing: string[];
  files: DiagnosticPreviewFile[];
}

type Phase = "idle" | "generating" | "ready" | "exporting" | "exported" | "cancelled" | "error";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export function DiagnosticBundlePanel() {
  const t = useT("settings");
  const controller = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<DiagnosticPreview | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => controller.current?.abort(), []);

  const selected = preview?.files.find(file => file.path === selectedPath) ?? preview?.files[0];

  const generate = async () => {
    const current = new AbortController();
    controller.current = current;
    setPreview(null);
    setSelectedPath(null);
    setError("");
    setPhase("generating");
    try {
      const response = await fetch("/api/diagnostics", { signal: current.signal, cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, t("diagnosticsGenerateFailed")));
      const draft = await response.json() as DiagnosticPreview;
      if (current.signal.aborted) return;
      setPreview(draft);
      setSelectedPath(draft.files[0]?.path ?? null);
      setPhase("ready");
    } catch (cause) {
      if (current.signal.aborted) setPhase("cancelled");
      else {
        setError(cause instanceof Error ? cause.message : t("diagnosticsGenerateFailed"));
        setPhase("error");
      }
    } finally {
      if (controller.current === current) controller.current = null;
    }
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    if (preview) void fetch(`/api/diagnostics?draftId=${encodeURIComponent(preview.id)}`, { method: "DELETE" });
    setPreview(null);
    setSelectedPath(null);
    setPhase("cancelled");
  };

  const exportBundle = async () => {
    if (!preview) return;
    const current = new AbortController();
    controller.current = current;
    setError("");
    setPhase("exporting");
    try {
      const response = await fetch("/api/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: preview.id }),
        signal: current.signal,
      });
      if (!response.ok) throw new Error(await responseError(response, t("diagnosticsExportFailed")));
      const blob = await response.blob();
      if (current.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mora-diagnostics-${preview.generatedAt.replace(/[:.]/g, "-")}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setPreview(null);
      setSelectedPath(null);
      setPhase("exported");
    } catch (cause) {
      if (current.signal.aborted) setPhase("cancelled");
      else {
        setError(cause instanceof Error ? cause.message : t("diagnosticsExportFailed"));
        setPhase("error");
      }
    } finally {
      if (controller.current === current) controller.current = null;
    }
  };

  const busy = phase === "generating" || phase === "exporting";
  return (
    <section className="min-w-0 flex-1 space-y-4" aria-labelledby="diagnostic-bundle-title">
      <div>
        <h2 id="diagnostic-bundle-title" className="text-lg font-semibold">{t("diagnosticsTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("diagnosticsDescription")}</p>
      </div>

      <Card className="glass-card">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <p>{t("diagnosticsSafety")}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void generate()} disabled={busy}>
              {phase === "generating" ? <LoaderCircle className="size-4 animate-spin" /> : <FileJson2 className="size-4" />}
              {phase === "generating" ? t("diagnosticsGenerating") : t("diagnosticsGenerate")}
            </Button>
            {preview ? <Button type="button" onClick={() => void exportBundle()} disabled={busy}>
              {phase === "exporting" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {phase === "exporting" ? t("diagnosticsExporting") : t("diagnosticsExport")}
            </Button> : null}
            {busy || preview ? <Button type="button" variant="outline" onClick={cancel}><X className="size-4" />{t("diagnosticsCancel")}</Button> : null}
          </div>

          {phase === "cancelled" ? <p role="status" className="text-sm text-muted-foreground">{t("diagnosticsCancelled")}</p> : null}
          {phase === "exported" ? <p role="status" className="text-sm text-emerald-600">{t("diagnosticsExported")}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          {preview ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p>{preview.riskNotice}</p>
              </div>
              {preview.missing.length ? <p className="text-sm text-amber-700">{t("diagnosticsMissing", { sections: preview.missing.map(name => t(`diagnosticsSection_${name}`)).join("、") })}</p> : null}
              <div className="grid gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
                <div className="space-y-2" aria-label={t("diagnosticsFiles")}>
                  {preview.files.map(file => (
                    <button key={file.path} type="button" onClick={() => setSelectedPath(file.path)} className={`w-full rounded-xl border p-3 text-left transition-colors ${selected?.path === file.path ? "border-primary/50 bg-primary/5" : "border-border/60 hover:bg-muted/40"}`}>
                      <span className="block text-sm font-medium">{file.path}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{t(`diagnosticsCategory_${file.category}`)} · {formatBytes(file.sizeBytes)}</span>
                    </button>
                  ))}
                </div>
                <pre className="max-h-[28rem] min-h-52 overflow-auto rounded-xl border border-border/60 bg-muted/25 p-4 text-xs leading-relaxed whitespace-pre-wrap break-all" aria-label={t("diagnosticsPreview")}>{selected?.content}</pre>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
