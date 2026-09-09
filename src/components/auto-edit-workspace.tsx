"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageFrame, PageHeader, Surface } from "@/components/studio/page";
import { useLocale } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { isPaidTTSReady, resolveTTSConfig } from "@/lib/tts-presets";
import type { EditBrief, Checkpoint, EditPlan, EditStatus } from "@/lib/auto-edit/contract";

interface Source { id: string; originalName: string; duration: number; url: string }
interface Run { id: string; sourceId: string; parentId?: string; status: EditStatus; stage: string; brief: EditBrief; checkpoint: Checkpoint; url: string | null; error: string | null; quality: string }
const ACTIVE = ["queued", "running", "cancel_requested"];
const STAGES: Record<string, [string, string]> = {
  selected: ["已采用方案或补充要求", "Plan or clarification applied"],
  queued: ["等待执行", "Queued"], preparing: ["读取素材", "Reading source"], analyzing: ["分析画面", "Understanding frames"], transcribing: ["本地语音转写（首次需下载模型）", "Local transcription (first run downloads model)"], planning: ["AI 制定剪辑方案", "Planning the edit"], voicing: ["制作旁白与校准时长", "Preparing voiceover"], rendering: ["执行剪辑", "Rendering"], checking: ["检查成片", "Checking output"], complete: ["成片已完成", "Complete"], candidates: ["选择剪辑方案", "Choose a plan"], waiting_input: ["等待补充", "Input needed"],
};
const STATUS: Record<EditStatus, [string, string]> = { queued: ["等待", "Queued"], running: ["运行中", "Running"], cancel_requested: ["正在取消", "Cancelling"], cancelled: ["已取消", "Cancelled"], interrupted: ["已中断", "Interrupted"], failed: ["失败", "Failed"], done: ["完成", "Done"], needs_review: ["需复核", "Needs review"], waiting_input: ["待选择或补充", "Input needed"] };

export default function AutoEditWorkspace({ projectId }: { projectId: string }) {
  const locale = useLocale();
  const en = locale === "en";
  const tr = (zh: string, english: string) => en ? english : zh;
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState<15 | 20 | 30>(15);
  const [aspect, setAspect] = useState<EditBrief["aspect"]>("9:16");
  const [audio, setAudio] = useState<EditBrief["audio"]>("voiceover");
  const [style, setStyle] = useState<EditBrief["style"]>("auto");
  const [captions, setCaptions] = useState(true);
  const [bgm, setBgm] = useState("");
  const [revision, setRevision] = useState("");
  const [editing, setEditing] = useState<EditPlan | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const restored = useRef(false);
  const llm = useSettingsStore(s => s.llm);
  const configured = Boolean(llm.baseUrl && llm.model && llm.visionModel);
  const current = runs.find(r => r.id === selected) ?? runs[0];
  const active = runs.some(r => ACTIVE.includes(r.status));
  const source = sources.find(s => s.id === sourceId);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/project/${projectId}/auto-edit`, { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setRuns(data.runs);
    if (!restored.current && data.runs.length) {
      restored.current = true;
      const id = new URLSearchParams(window.location.search).get("run");
      const row: Run = data.runs.find((r: Run) => r.id === id) ?? data.runs[0];
      setSelected(row.id); setSourceId(row.sourceId); setInstruction(row.brief.instruction); setTarget(row.brief.target); setAspect(row.brief.aspect); setAudio(row.brief.audio); setStyle(row.brief.style); setCaptions(row.brief.captions); setBgm(row.brief.bgm ?? "");
    }
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([refresh(controller.signal), fetch(`/api/project/${projectId}/media`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSources(data.sources);
      setSourceId(previous => previous || data.sources[0]?.id || "");
      if (!restored.current) setAspect(useSettingsStore.getState().defaultAspectRatio);
    })]).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, refresh]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setInterval(() => { void refresh(controller.signal).catch(() => {}); }, 3000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [active, refresh]);
  async function submit(action: string, plan?: EditPlan) {
    if (busy) return;
    setBusy(true); setError("");
    const state = useSettingsStore.getState();
    const credentials = { llm: state.llm, ...(isPaidTTSReady(state.tts, state.providers) ? { tts: resolveTTSConfig(state.tts, state.providers) } : {}) };
    const brief: EditBrief = { instruction, target, aspect, audio, style, captions, locale: en ? "en" : "zh", ...(bgm ? { bgm } : {}) };
    try {
      const response = await fetch(`/api/project/${projectId}/auto-edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, sourceId, runId: current?.id, requestId: requestId.current, credentials: action === "cancel" || action === "export" ? undefined : credentials, brief: action === "revise" ? { ...brief, instruction: `${current?.brief.instruction}\n用户修改 / Requested change: ${revision}` } : action === "manual" && !editing ? current?.brief : action === "start" || action === "manual" ? brief : undefined, plan }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      requestId.current = crypto.randomUUID();
      if (data.runId) { setSelected(data.runId); const url = new URL(window.location.href); url.searchParams.set("run", data.runId); window.history.replaceState(null, "", url); }
      setEditing(null);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  function choose(run: Run) {
    const url = new URL(window.location.href); url.searchParams.set("run", run.id); window.history.replaceState(null, "", url);
    setSelected(run.id); setSourceId(run.sourceId); setInstruction(run.brief.instruction); setTarget(run.brief.target); setAspect(run.brief.aspect); setAudio(run.brief.audio); setStyle(run.brief.style); setCaptions(run.brief.captions); setBgm(run.brief.bgm ?? ""); setEditing(null);
  }
  const field = "w-full rounded-lg border border-input bg-card p-2 text-sm";
  return <PageFrame width="content">
    <PageHeader title={tr("AI 自动剪辑", "AI automatic editing")} description={tr("上传原视频，描述推广目标，AI 自动选镜头、写文案并交付成片。", "Describe your promotion goal. AI selects footage, writes copy and delivers an edit.")} actions={<Link href={`/project/${projectId}/edit`}><Button variant="outline">{tr("手动剪辑", "Manual editor")}</Button></Link>} />
    {loading ? <p role="status">{tr("读取素材与历史任务…", "Loading sources and runs…")}</p> : null}
    {error ? <p role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
    <div className="grid gap-5 lg:grid-cols-2">
      <Surface className="space-y-4 p-5">
        <label className="block space-y-2"><span>{tr("原视频 · 最长 5 分钟", "Source · up to 5 minutes")}</span><select className={field} value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">{tr("选择素材", "Select source")}</option>{sources.map(s => <option key={s.id} value={s.id}>{s.originalName} · {(s.duration / 1000).toFixed(1)}s</option>)}</select></label>
        {!sources.length && !loading ? <Link href="/project/edit/new" className="text-primary underline">{tr("上传视频", "Upload a video")}</Link> : null}
        {source ? <video src={source.url} controls preload="metadata" className="max-h-56 w-full rounded-xl bg-black" /> : null}
        {source && source.duration > 300000 ? <p role="alert" className="text-sm text-destructive">{tr("该视频超过 5 分钟，请使用较短素材或返回手动剪辑。", "This source exceeds 5 minutes. Use a shorter source or the manual editor.")}</p> : null}
        <label className="block space-y-2"><span>{tr("推广要求", "Editing instructions")}</span><textarea className={field} rows={4} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder={tr("例如：突出商品外观和操作细节，节奏清爽。价格和优惠请在此补充。", "Example: highlight the design and controls with a clear pace. Supply any prices or offers here.")} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label>{tr("目标时长", "Duration")}<select className={field} value={target} onChange={e => setTarget(Number(e.target.value) as 15 | 20 | 30)}>{[15, 20, 30].map(n => <option key={n} value={n}>{n}s</option>)}</select></label>
          <label>{tr("画面比例", "Aspect ratio")}<select className={field} value={aspect} onChange={e => setAspect(e.target.value as EditBrief["aspect"])}>{["9:16", "16:9", "1:1"].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>{tr("声音", "Audio")}<select className={field} value={audio} onChange={e => setAudio(e.target.value as EditBrief["audio"])}><option value="voiceover">{tr("新旁白", "New voiceover")}</option><option value="original">{tr("保留原声", "Original speech")}</option><option value="muted">{tr("静音展示", "Muted")}</option></select></label>
          <label>{tr("剪辑方向", "Style")}<select className={field} value={style} onChange={e => setStyle(e.target.value as EditBrief["style"])}>{([['auto', '自动推荐', 'Automatic'], ['concise', '内容精简', 'Concise'], ['highlights', '亮点快剪', 'Highlights'], ['story', '展示叙事', 'Story']] as const).map(([v, zh, english]) => <option key={v} value={v}>{tr(zh, english)}</option>)}</select></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={captions} onChange={e => setCaptions(e.target.checked)} />{tr("添加字幕", "Add captions")}</label>
        <label className="block text-sm">{tr("背景音乐（可选）", "Background music (optional)")}<input type="file" accept="audio/*" disabled={busy} className={field} onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return;
          setBusy(true); setError("");
          try { const fd = new FormData(); fd.append("file", file); const r = await fetch(`/api/project/${projectId}/bgm`, { method: "POST", body: fd }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setBgm(d.path); } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); } finally { setBusy(false); }
        }} /></label>
        {bgm ? <button className="text-xs text-primary" onClick={() => setBgm("")}>{tr("移除配乐", "Remove music")}</button> : null}
        <p className="text-xs leading-5 text-muted-foreground">{tr("采样画面、相关转写和推广要求会发送给设置中的模型服务。原视频在本地剪辑。模型及付费配音可能产生费用。", "Sampled frames, transcripts and instructions are sent to your configured model. Rendering is local. Model and paid voice services may incur charges.")}</p>
        {!configured ? <Link href="/settings?tab=llm" className="block text-sm text-primary underline">{tr("先配置文本和画面理解模型", "Configure text and visual understanding models")}</Link> : null}
        <Button className="w-full" disabled={loading || busy || active || !configured || !source || source.duration > 300000 || !instruction.trim()} onClick={() => void submit("start")}>{tr("AI 自动剪辑", "Create AI edit")}</Button>
      </Surface>
      <Surface className="space-y-4 p-5">
        <h2 className="font-semibold">{tr("任务与成片", "Runs and outputs")}</h2>
        {runs.length ? <select aria-label={tr("历史版本", "Version history")} className={field} value={current?.id ?? ""} onChange={e => { const row = runs.find(r => r.id === e.target.value); if (row) choose(row); }}>{runs.map((r, i) => <option key={r.id} value={r.id}>{runs.length - i} · {r.checkpoint.plan?.title || r.id.slice(0, 8)} · {STATUS[r.status]?.[en ? 1 : 0]} · {r.quality}</option>)}</select> : <p className="text-sm text-muted-foreground">{tr("开始任务后，可在此查看进展。", "Your progress and outputs will appear here.")}</p>}
        {current ? <>
          <p role="status" aria-live="polite" className="rounded-lg bg-primary/5 p-3 text-sm">{STAGES[current.stage]?.[en ? 1 : 0] ?? current.stage} · {STATUS[current.status]?.[en ? 1 : 0]}</p>
          {current.error ? <p className="text-sm text-destructive">{current.error}</p> : null}
          {ACTIVE.includes(current.status) ? <Button variant="outline" disabled={busy || current.status === "cancel_requested"} onClick={() => void submit("cancel")}>{tr("取消任务", "Cancel")}</Button> : null}
          {["failed", "interrupted", "cancelled"].includes(current.status) ? <Button disabled={busy || active || !configured} onClick={() => void submit("retry")}>{tr("从检查点重试", "Retry from checkpoint")}</Button> : null}
          {current.url ? <><video src={current.url} controls preload="metadata" className="max-h-96 w-full rounded-xl bg-black" /><div className="flex flex-wrap gap-2"><a href={`${current.url}?download=1`} className="text-sm text-primary underline">{tr("下载视频", "Download video")}</a><Button variant="outline" disabled={busy || active} onClick={() => void submit("export")}>{tr("按此版本导出 1080p", "Export this version at 1080p")}</Button></div></> : null}
          {current.checkpoint.checks ? <div className="text-sm"><p>{tr("实际时长", "Actual duration")}: {current.checkpoint.checks.duration.toFixed(2)}s</p>{[...current.checkpoint.checks.issues, ...current.checkpoint.checks.review].map((s, i) => <p key={i} className="mt-1 text-amber-600">{s}</p>)}</div> : null}
          {current.checkpoint.analysis ? <details><summary className="cursor-pointer text-sm font-medium">{tr("视频理解与采样范围", "Video understanding and sampling")}</summary><p className="mt-2 whitespace-pre-wrap text-sm">{current.checkpoint.analysis.summary}</p><p className="mt-2 text-xs text-muted-foreground">{tr("采样帧时间（秒）", "Sample timestamps (seconds)")}: {current.checkpoint.analysis.sampledAt.join(", ")}</p>{current.checkpoint.analysis.warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">{w}</p>)}</details> : null}
          {current.checkpoint.plan ? <details open={Boolean(editing)}><summary className="cursor-pointer text-sm font-medium">{tr("查看与编辑剪辑方案", "View and edit plan")}</summary><p className="my-2 text-sm">{current.checkpoint.plan.explanation}</p><PlanEditor plan={editing ?? current.checkpoint.plan} editable={Boolean(editing)} onChange={setEditing} en={en} sourceUrl={sources.find(s => s.id === current.sourceId)?.url} />
            {!active ? editing ? <div className="mt-3 flex gap-2"><Button disabled={busy} onClick={() => void submit("manual", editing)}>{tr("按修改方案生成新版本", "Render edited plan")}</Button><Button variant="ghost" onClick={() => setEditing(null)}>{tr("取消", "Cancel")}</Button></div> : <Button variant="outline" className="mt-3" onClick={() => { choose(current); setEditing(structuredClone(current.checkpoint.plan!)); }}>{tr("编辑时间和文案", "Edit timing and copy")}</Button> : null}
          </details> : null}
          {current.checkpoint.candidates?.map((p, i) => <div key={i} className="rounded-xl border p-3"><h3 className="font-medium">{p.title}</h3><p className="my-2 text-sm">{p.explanation}</p><details><summary className="text-sm">{tr("镜头安排", "Clips")}</summary><PlanEditor plan={p} editable={false} onChange={() => {}} en={en} /></details><Button className="mt-2" disabled={busy || active} onClick={() => void submit("manual", p)}>{tr("使用此方案", "Use this plan")}</Button></div>)}
          {!active && current.checkpoint.analysis ? <div className="space-y-2 border-t pt-4"><label className="block text-sm">{tr("告诉 AI 怎样修改", "Tell AI what to change")}<textarea className={field} rows={3} value={revision} onChange={e => setRevision(e.target.value)} placeholder={tr("例如：换一个开头，突出操作过程。也可在左侧调整时长和声音。", "Example: choose a new opening and highlight the controls. Adjust duration and audio on the left.")} /></label><div className="flex flex-wrap gap-2"><Button disabled={busy || !configured || !revision.trim()} onClick={() => void submit("revise")}>{tr("修改并生成新版本", "Revise and render")}</Button><Button variant="outline" disabled={busy || !configured} onClick={() => void submit("candidates")}>{tr("比较其他剪法", "Compare alternatives")}</Button></div></div> : null}
          <details><summary className="cursor-pointer text-xs text-muted-foreground">{tr("执行记录", "Execution history")}</summary>{current.checkpoint.history.map((item, i) => <p className="mt-2 break-words text-xs" key={i}>{item.action}: {item.detail}</p>)}</details>
        </> : null}
      </Surface>
    </div>
  </PageFrame>;
}

function PlanEditor({ plan, editable, onChange, en, sourceUrl }: { plan: EditPlan; editable: boolean; onChange: (p: EditPlan) => void; en: boolean; sourceUrl?: string }) {
  const patch = (i: number, changes: Partial<EditPlan["clips"][number]>) => onChange({ ...plan, clips: plan.clips.map((c, n) => n === i ? { ...c, ...changes } : c) });
  return <ol className="space-y-3">{plan.clips.map((c, i) => <li key={i} className="rounded-lg border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><strong>{i + 1}</strong>{editable ? <><label>{en ? "Start" : "开始"}<input className="ml-1 w-20 rounded border p-1" aria-label={`${en ? 'Start' : '开始'} ${i + 1}`} type="number" step="0.1" value={c.start} onChange={e => patch(i, { start: Number(e.target.value) })} /></label><label>{en ? "End" : "结束"}<input className="ml-1 w-20 rounded border p-1" aria-label={`${en ? 'End' : '结束'} ${i + 1}`} type="number" step="0.1" value={c.end} onChange={e => patch(i, { end: Number(e.target.value) })} /></label></> : <span>{c.start.toFixed(2)}–{c.end.toFixed(2)}s</span>}{sourceUrl ? <a className="text-primary underline" href={`${sourceUrl}#t=${c.start},${c.end}`} target="_blank" rel="noreferrer">{en ? "Source clip" : "查看原片段"}</a> : null}</div>{editable ? <textarea aria-label={`${en ? 'Copy' : '文案'} ${i + 1}`} className="mt-2 w-full rounded border bg-card p-2" value={c.text} onChange={e => patch(i, { text: e.target.value })} /> : <p className="mt-2">{c.text}</p>}{editable ? <div className="mt-2 flex flex-wrap gap-2"><label>{en ? "Fit" : "构图"}<select value={c.fit} onChange={e => patch(i, { fit: e.target.value as typeof c.fit })}><option value="contain">{en ? "Full frame" : "完整画面"}</option><option value="cover">{en ? "Fill crop" : "裁切填满"}</option></select></label><label>{en ? "Speed" : "速度"}<input className="ml-1 w-20 rounded border p-1" type="number" min="0.85" max="1.15" step="0.05" value={c.speed} onChange={e => patch(i, { speed: Number(e.target.value) })} /></label><label>{en ? "Transition (muted)" : "转场（静音）"}<select value={c.transition} onChange={e => patch(i, { transition: e.target.value as typeof c.transition })}><option value="cut">{en ? "Cut" : "直接切换"}</option><option value="fade">{en ? "Fade" : "淡化"}</option></select></label></div> : null}<p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>{editable ? <div className="mt-2 flex gap-3"><button disabled={i === 0} onClick={() => { const clips = [...plan.clips]; [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]]; onChange({ ...plan, clips }); }}>{en ? "Move up" : "上移"}</button><button disabled={plan.clips.length === 1} onClick={() => onChange({ ...plan, clips: plan.clips.filter((_, n) => n !== i) })}>{en ? "Remove" : "删除"}</button></div> : null}</li>)}</ol>;
}
