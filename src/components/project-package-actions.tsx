"use client";

import { useEffect, useRef, useState } from "react";
import { Download, PackageOpen, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export interface ProjectPackageProject {
  id: string;
  name: string;
}

interface ImportResult {
  projectId: string;
  conflictResolved: boolean;
}

type TransferPhase = "idle" | "estimating" | "preparing" | "downloading" | "uploading" | "validating" | "success" | "cancelled" | "error";

interface TransferState {
  phase: TransferPhase;
  completed: number;
  total: number;
  estimate: number;
  error?: string;
}

const IDLE: TransferState = { phase: "idle", completed: 0, total: 0, estimate: 0 };

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** order;
  return `${value >= 10 || order === 0 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[order]}`;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

function TransferStatus({ state, onCancel, onClose }: { state: TransferState; onCancel: () => void; onClose: () => void }) {
  const t = useT("projectsPage");
  if (state.phase === "idle") return null;
  const active = ["estimating", "preparing", "downloading", "uploading", "validating"].includes(state.phase);
  const percent = state.total > 0 ? Math.min(100, Math.round(state.completed / state.total * 100)) : 0;
  const label = state.phase === "estimating" ? t("packageEstimating")
    : state.phase === "preparing" ? t("packagePreparing")
      : state.phase === "downloading" ? t("packageDownloading")
        : state.phase === "uploading" ? t("packageUploading")
          : state.phase === "validating" ? t("packageValidating")
            : state.phase === "success" ? t("packageSuccess")
              : state.phase === "cancelled" ? t("packageCancelled") : t("packageFailed");
  return (
    <div className="fixed bottom-5 right-5 z-[80] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border/70 bg-card/95 p-4 shadow-2xl backdrop-blur-xl" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><PackageOpen className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          {state.estimate > 0 ? <p className="mt-1 text-xs text-muted-foreground">{t("packageEstimate", { size: formatBytes(state.estimate) })}</p> : null}
          {state.error ? <p className="mt-1 break-words text-xs text-destructive">{state.error}</p> : null}
        </div>
        {!active ? <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label={t("packageClose")}><X className="size-3.5" /></button> : null}
      </div>
      {active && state.phase !== "estimating" && state.phase !== "preparing" && state.phase !== "validating" ? (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} /></div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{formatBytes(state.completed)} / {formatBytes(state.total)}</p>
        </div>
      ) : active ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/3 animate-pulse rounded-full bg-primary" /></div> : null}
      {active ? <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={onCancel}>{t("packageCancel")}</Button> : null}
    </div>
  );
}

export function ProjectPackageExportButton({ project, className }: { project: ProjectPackageProject; className?: string }) {
  const t = useT("projectsPage");
  const [state, setState] = useState<TransferState>(IDLE);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const start = async () => {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setState({ ...IDLE, phase: "estimating" });
    try {
      const estimateResponse = await fetch(`/api/project/${project.id}/package?estimate=1`, { signal: current.signal });
      if (!estimateResponse.ok) throw new Error(await responseError(estimateResponse, t("packageEstimateFailed")));
      const estimate = await estimateResponse.json() as { estimatedPackageBytes: number };
      setState({ phase: "preparing", completed: 0, total: estimate.estimatedPackageBytes, estimate: estimate.estimatedPackageBytes });
      const response = await fetch(`/api/project/${project.id}/package`, { signal: current.signal });
      if (!response.ok) throw new Error(await responseError(response, t("packageExportFailed")));
      if (!response.body) throw new Error(t("packageExportFailed"));
      const total = Number(response.headers.get("content-length")) || estimate.estimatedPackageBytes;
      const reader = response.body.getReader();
      current.signal.addEventListener("abort", () => { void reader.cancel(); }, { once: true });
      const chunks: Uint8Array[] = [];
      let completed = 0;
      setState({ phase: "downloading", completed, total, estimate: estimate.estimatedPackageBytes });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        completed += value.byteLength;
        setState({ phase: "downloading", completed, total, estimate: estimate.estimatedPackageBytes });
      }
      if (current.signal.aborted) return;
      const blob = new Blob(chunks.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer), { type: "application/vnd.mora.project+zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project.name.replace(/[\\/\0-\x1f\x7f]/g, "-") || "project"}.mora`;
      link.click();
      URL.revokeObjectURL(url);
      setState({ phase: "success", completed, total, estimate: estimate.estimatedPackageBytes });
    } catch (error) {
      if (current.signal.aborted) setState((value) => ({ ...value, phase: "cancelled" }));
      else setState((value) => ({ ...value, phase: "error", error: error instanceof Error ? error.message : t("packageExportFailed") }));
    } finally {
      if (controller.current === current) controller.current = null;
    }
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setState((value) => ({ ...value, phase: "cancelled" }));
  };

  return <>
    <button type="button" onClick={() => void start()} disabled={state.phase !== "idle" && !["success", "cancelled", "error"].includes(state.phase)} title={t("packageExport")} aria-label={t("packageExportNamed", { name: project.name })} className={className ?? "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/65 transition-colors hover:bg-primary/10 hover:text-primary"}><Download className="size-3.5" /></button>
    <TransferStatus state={state} onCancel={cancel} onClose={() => setState(IDLE)} />
  </>;
}

export function ProjectPackageImportButton({ onImported }: { onImported?: (result: ImportResult) => void }) {
  const t = useT("projectsPage");
  const input = useRef<HTMLInputElement | null>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const [state, setState] = useState<TransferState>(IDLE);
  useEffect(() => () => request.current?.abort(), []);

  const choose = (file: File) => {
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    setState({ phase: "uploading", completed: 0, total: file.size, estimate: file.size });
    xhr.open("POST", "/api/project/package");
    xhr.setRequestHeader("Content-Type", "application/vnd.mora.project+zip");
    xhr.upload.onprogress = (event) => setState({ phase: "uploading", completed: event.loaded, total: event.total || file.size, estimate: file.size });
    xhr.upload.onload = () => setState({ phase: "validating", completed: file.size, total: file.size, estimate: file.size });
    xhr.onload = () => {
      request.current = null;
      let body: { error?: string; projectId?: string; conflictResolved?: boolean } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.projectId) {
        setState({ phase: "success", completed: file.size, total: file.size, estimate: file.size });
        onImported?.({ projectId: body.projectId, conflictResolved: body.conflictResolved === true });
      } else setState((value) => ({ ...value, phase: "error", error: body.error || t("packageImportFailed") }));
    };
    xhr.onerror = () => { request.current = null; setState((value) => ({ ...value, phase: "error", error: t("packageImportFailed") })); };
    xhr.onabort = () => { request.current = null; setState((value) => ({ ...value, phase: "cancelled" })); };
    xhr.send(file);
  };

  return <>
    <input ref={input} type="file" accept=".mora,application/vnd.mora.project+zip" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) choose(file); event.target.value = ""; }} />
    <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}><Upload className="size-4" />{t("packageImport")}</Button>
    <TransferStatus state={state} onCancel={() => request.current?.abort()} onClose={() => setState(IDLE)} />
  </>;
}
