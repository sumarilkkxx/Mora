"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Scissors } from "lucide-react";
import { PageFrame, PageHeader } from "@/components/studio/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { isPaidTTSReady, resolveTTSConfig } from "@/lib/tts-presets";
import type { EditPlan } from "@/lib/auto-edit/contract";
import { briefChanged, canRetry, completedSteps, draftChanged, exportFor, initialDraft, isActive, playableRun, plansFor, readDraft, requiresReview, runLabel, runStep, type EditRun, type EditSource, type WorkspaceDraft } from "@/lib/auto-edit/workspace";
import { CopyStage, PlanStage, ResultStage, SourceStage } from "./auto-edit/edit-stages";
import { TaskFeedback, TechnicalDetails, VersionMenu, WorkflowSteps, WorkspaceLoading } from "./auto-edit/workspace-chrome";
import ui from "./auto-edit-workspace.module.css";

type Action = "analyze" | "rewrite-copy" | "approve-copy" | "manual" | "retry" | "export" | "cancel";
const storageKey = (project: string, run: string) => `mora:edit-draft:v1:${project}:${run}`;

export default function AutoEditWorkspace({ projectId }: { projectId: string }) {
  const locale = useLocale(); const en = locale === "en";
  const tr = (zh: string, english: string) => en ? english : zh;
  const [sources, setSources] = useState<EditSource[]>([]);
  const [runs, setRuns] = useState<EditRun[]>([]);
  const [selected, setSelected] = useState("");
  const [viewStep, setViewStep] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [musicUploading, setMusicUploading] = useState(false);
  const [musicError, setMusicError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, WorkspaceDraft>>({});
  const [storageFailed, setStorageFailed] = useState(false);
  const [pendingRun, setPendingRun] = useState<EditRun | null>(null);
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const uploadLock = useRef(false);
  const requestId = useRef("");
  const requestSignature = useRef("");
  const knownDrafts = useRef(new Set<string>());
  const configured = useSettingsStore(state => Boolean(state.llm.baseUrl && state.llm.model && state.llm.visionModel));
  const current = runs.find(row => row.id === selected);
  const owner = current?.id ?? "new";
  const base = initialDraft(current, sources[0]?.id ?? "", en);
  const draft = drafts[owner] ?? base;
  const dirty = draftChanged(draft, base);
  const changedBrief = Boolean(current && briefChanged(draft, base));
  const changedCopy = draft.copy.voiceover !== base.copy.voiceover;
  const plans = plansFor(current, runs);
  const progress = runStep(current);
  const shown = viewStep ?? progress;
  const result = playableRun(current, runs);
  const hdExport = exportFor(result, runs);
  const activeRun = runs.find(isActive);
  const locked = loading || busy || Boolean(activeRun) || uploading || musicUploading;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/project/${projectId}/auto-edit`, { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not read task state");
    const rows: EditRun[] = data.runs;
    setRuns(rows); setPollError(false);
    return rows;
  }, [projectId]);

  const moveToRun = useCallback((id: string) => {
    setSelected(id); setViewStep(null);
    const url = new URL(window.location.href); url.searchParams.set("run", id);
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [rows, response] = await Promise.all([refresh(controller.signal), fetch(`/api/project/${projectId}/media`, { signal: controller.signal })]);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load source videos");
        if (controller.signal.aborted) return;
        setSources(data.sources); setError("");
        const requested = new URLSearchParams(window.location.search).get("run");
        const row = rows.find(item => item.id === requested) ?? rows[0];
        if (row) moveToRun(row.id);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Request failed"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [projectId, refresh, moveToRun, reload]);

  // Poll all running versions, even when inspecting a saved parent video.
  const polling = Boolean(activeRun);
  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(controller.signal); } catch { if (!controller.signal.aborted) setPollError(true); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
    }
    timer = setTimeout(poll, 2500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [polling, refresh]);

  useEffect(() => {
    if (loading) return;
    const key = storageKey(projectId, owner);
    if (knownDrafts.current.has(key)) return;
    knownDrafts.current.add(key);
    try {
      const saved = readDraft(localStorage.getItem(key));
      if (saved) queueMicrotask(() => setDrafts(old => ({ ...old, [owner]: saved })));
    } catch { /* A blocked store does not prevent editing. */ }
  }, [projectId, owner, loading]);

  useEffect(() => {
    if (!dirty || !storageFailed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, storageFailed]);

  function updateDraft(next: WorkspaceDraft) {
    setDrafts(old => ({ ...old, [owner]: next }));
    try { localStorage.setItem(storageKey(projectId, owner), JSON.stringify(next)); setStorageFailed(false); }
    catch { setStorageFailed(true); }
  }

  function clearDraft(id: string) {
    setDrafts(old => { const next = { ...old }; delete next[id]; return next; });
    try { localStorage.removeItem(storageKey(projectId, id)); } catch { /* Keep current editing usable. */ }
  }

  function selectRun(row: EditRun) {
    if (row.id === current?.id) return;
    if (dirty) setPendingRun(row); else moveToRun(row.id);
  }

  async function submit(action: Action, target = current, plan?: EditPlan, rewriteInstruction?: string) {
    if (loading || lock.current || uploadLock.current || (action !== "cancel" && runs.some(isActive))) return;
    if (action === "manual" && (changedBrief || changedCopy)) return;
    if (action === "export" && exportFor(target, runs)) return;
    lock.current = true; setBusy(true); setError("");
    const signature = JSON.stringify({ action, run: target?.id, draft, plan, rewriteInstruction });
    if (!requestId.current || requestSignature.current !== signature) requestId.current = crypto.randomUUID();
    requestSignature.current = signature;
    const state = useSettingsStore.getState();
    const exportAction = action === "export" || (action === "retry" && target?.checkpoint.operation === "export");
    const credentials = exportAction || action === "cancel" ? undefined : { llm: state.llm, ...(isPaidTTSReady(state.tts, state.providers) ? { tts: resolveTTSConfig(state.tts, state.providers) } : {}) };
    try {
      const response = await fetch(`/api/project/${projectId}/auto-edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action, runId: target?.id, sourceId: draft.sourceId, requestId: requestId.current, credentials,
        brief: action === "analyze" || action === "manual" ? { ...draft.brief, locale: en ? "en" : "zh" } : undefined,
        copy: action === "approve-copy" ? draft.copy : undefined, rewriteInstruction: action === "rewrite-copy" ? rewriteInstruction : undefined, plan,
      }) });
      const data = await response.json();
      if (!response.ok) { requestId.current = ""; throw new Error(data.error || "Request failed"); }
      requestId.current = "";
      if (action === "analyze" || action === "approve-copy" || action === "rewrite-copy") clearDraft(owner);
      if (data.runId && !exportAction && action !== "cancel") moveToRun(data.runId);
      if (action === "export") setViewStep(3);
      try { await refresh(); }
      catch { setLoading(true); setReload(value => value + 1); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { lock.current = false; setBusy(false); }
  }

  async function uploadFile(file: File | undefined, music: boolean) {
    if (!file || lock.current || uploadLock.current || activeRun) return;
    const allowed = music ? /\.(mp3|wav|aac|m4a)$/i : /\.(mp4|mov|webm|mkv|m4v)$/i;
    if (!allowed.test(file.name) || file.size > (music ? 20 : 1024) * 1024 * 1024) {
      const message = music ? tr("请选择 20 MB 以内的 MP3、WAV、AAC 或 M4A 文件。", "Choose an MP3, WAV, AAC or M4A under 20 MB.") : tr("请选择 1 GB 以内的 MP4、MOV、WebM、MKV 或 M4V 视频。", "Choose a supported video under 1 GB.");
      if (music) setMusicError(message); else setError(message); return;
    }
    uploadLock.current = true;
    if (music) { setMusicUploading(true); setMusicError(""); } else { setUploading(true); setError(""); }
    try {
      const form = new FormData(); if (music) form.append("file", file);
      const response = await fetch(`/api/project/${projectId}/${music ? "bgm" : "media"}`, { method: "POST", body: music ? form : file,
        headers: music ? undefined : { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "Accept-Language": locale } });
      const data = await response.json();
      if (!response.ok || !(music ? data.path : data.id)) throw new Error(data.error || tr("上传失败，请重试。", "Upload failed. Please retry."));
      if (music) updateDraft({ ...draft, bgmName: file.name, brief: { ...draft.brief, bgm: data.path } });
      else {
        const media = await fetch(`/api/project/${projectId}/media`); const list = await media.json();
        if (!media.ok) throw new Error(list.error || "Could not refresh media");
        setSources(list.sources); updateDraft({ ...draft, sourceId: data.id });
      }
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Upload failed"; if (music) setMusicError(message); else setError(message); }
    finally { uploadLock.current = false; setUploading(false); setMusicUploading(false); }
  }

  const complete = completedSteps(current, plans);
  const available = [true, Boolean(current?.checkpoint.promotionCopy) || progress === 1,
    Boolean(plans.length) || progress === 2, Boolean(result) || progress === 3];
  const saved = dirty ? (storageFailed ? tr("草稿尚未保存，请勿关闭页面", "Draft not saved; keep this page open") : tr("草稿保存在本机 · 尚未应用到成片", "Draft saved locally · not applied to video")) : tr("与当前版本一致", "Matches this version");
  const showTask = current && (isActive(current) || canRetry(current)) && shown === progress && !(shown === 3 && result);

  return <PageFrame width="wide" className={ui.page}>
    <PageHeader variant="compact" title={tr("AI 智能成片", "AI smart edit")} description={tr("从素材到成片，每一步由你确认。", "From source to video, with you in control.")}
      actions={<>{runs.length ? <VersionMenu runs={runs} currentId={current?.id} en={en} disabled={busy} onSelect={selectRun} /> : null}<Link href={`/project/${projectId}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}><Scissors />{tr("精细剪辑", "Detailed editor")}</Link></>} />
    <WorkflowSteps selected={shown} progress={progress} complete={complete} available={available} running={isActive(current)} review={Boolean(current && requiresReview(current))} en={en} onSelect={setViewStep} />
    {error ? <Notice tone="danger" title={tr("操作未完成", "Action not completed")} action={<Button variant="outline" size="sm" onClick={() => { setLoading(true); setReload(v => v + 1); }}>{tr("重新读取", "Reload")}</Button>}>{error}</Notice> : null}
    {pollError ? <Notice tone="warning">{tr("暂时无法读取最新进度，正在重试。已保存的数据不会被清空。", "Unable to refresh progress. Retrying without discarding saved data.")}</Notice> : null}
    {!loading && current && activeRun && shown !== progress ? <div className={ui.contextLine} role="status">{runLabel(activeRun, en)} · {tr("正在查看已保存的内容", "Viewing saved content")}</div> : null}
    {!loading && current && !isActive(current) && runs[0]?.id !== current.id ? <div className={ui.contextLine}>{tr("正在查看历史记录", "Viewing a saved version")} · {runLabel(current, en)}</div> : null}
    {!loading && dirty ? <Notice tone={storageFailed ? "warning" : "info"} title={saved} action={<Button size="sm" variant="ghost" onClick={() => setPendingRun(current ?? ({ id: "new" } as EditRun))}>{tr("放弃修改…", "Discard changes…")}</Button>}>
      {!current ? tr("设置已保留，可以继续分析素材。", "Settings saved. Continue by analyzing the source.") : changedBrief ? tr("素材或目标已修改，请回到第一步重新分析，再继续生成新版本。", "Source or settings changed. Analyze again before creating a new version.") : tr("确认文案并重新生成方案后，修改才会应用到新成片。", "Approve the copy and recreate plans to apply changes to a new video.")}
    </Notice> : null}
    {loading ? <WorkspaceLoading en={en} /> : <>
      {shown === 0 ? <SourceStage sources={sources} draft={draft} en={en} locked={locked} configured={configured} uploading={uploading} musicUploading={musicUploading} musicError={musicError} onChange={updateDraft} onUpload={file => void uploadFile(file, false)} onMusic={file => void uploadFile(file, true)} onSubmit={() => void submit("analyze")} /> : null}
      {showTask ? <TaskFeedback run={current} en={en} busy={busy} onRetry={() => void submit("retry")} onCancel={() => void submit("cancel")} /> : null}
      {shown === 1 && current?.checkpoint.promotionCopy && !showTask ? <CopyStage draft={draft} run={current} en={en} locked={locked || changedBrief} saved={saved} onChange={copy => updateDraft({ ...draft, copy })} onBack={() => setViewStep(0)} onApprove={() => void submit("approve-copy")} onRewrite={instruction => void submit("rewrite-copy", current, undefined, instruction)} /> : null}
      {shown === 2 && plans.length > 0 && !showTask ? <PlanStage key={`${current?.id}-${plans.length}`} plans={plans} currentPlan={current?.checkpoint.plan} copyStrategy={draft.copy.strategy} style={draft.brief.style} en={en} locked={locked || changedBrief || changedCopy} onBack={() => setViewStep(changedBrief || !current?.checkpoint.promotionCopy ? 0 : 1)} onChoose={plan => void submit("manual", current, plan)} /> : null}
      {shown === 3 && result ? <ResultStage run={result} exportRun={hdExport} en={en} locked={locked} onBack={() => setViewStep(2)} onExport={() => void submit("export", result)} onRetry={row => void submit("retry", row)} onCancel={row => void submit("cancel", row)} /> : null}
      {current ? <TechnicalDetails run={current} en={en} /> : null}
    </>}
    <Dialog open={Boolean(pendingRun)} onOpenChange={open => { if (!open) setPendingRun(null); }}>
      <DialogContent><DialogTitle>{tr("当前有未应用的修改", "You have unapplied changes")}</DialogTitle><DialogDescription>{storageFailed ? tr("本机存储不可用，请保留当前页面或明确放弃修改。", "Local storage is unavailable. Stay here or discard the changes.") : tr("草稿已保存在本机。可以保留草稿，或放弃修改后继续。", "Your draft is saved locally. Keep it or discard the changes before continuing.")}</DialogDescription>
        <DialogFooter><Button variant="ghost" onClick={() => setPendingRun(null)}>{tr("继续编辑", "Keep editing")}</Button>
          {pendingRun?.id !== owner ? <Button variant="outline" disabled={storageFailed} onClick={() => { if (pendingRun) moveToRun(pendingRun.id); setPendingRun(null); }}>{tr("保留草稿并切换", "Keep draft and switch")}</Button> : null}
          <Button variant="outline" onClick={() => { clearDraft(owner); if (pendingRun && pendingRun.id !== owner) moveToRun(pendingRun.id); setPendingRun(null); }}>{tr("放弃修改", "Discard changes")}</Button>
        </DialogFooter></DialogContent>
    </Dialog>
  </PageFrame>;
}
