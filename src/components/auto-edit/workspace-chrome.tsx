"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, CircleAlert, FileVideo, LoaderCircle, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/studio/page";
import { canRetry, isActive, operationLabel, runLabel, type EditRun } from "@/lib/auto-edit/workspace";
import ui from "../auto-edit-workspace.module.css";

const STEPS = [["素材与目标", "Source & goal"], ["确认文案", "Review copy"], ["选择方案", "Choose a plan"], ["预览导出", "Preview & export"]];

export function WorkflowSteps({ selected, progress, complete, available, running, review, en, onSelect }: {
  selected: number; progress: number; complete: boolean[]; available: boolean[]; running: boolean; review: boolean;
  en: boolean; onSelect: (index: number) => void;
}) {
  const reduced = useReducedMotion();
  return <nav className={ui.stepTrack} aria-label={en ? "Editing stages" : "剪辑阶段"}>
    <motion.span className={ui.stepThumb} aria-hidden="true" initial={false} animate={{ x: `${selected * 100}%` }}
      transition={reduced ? { duration: 0 } : { type: "spring", bounce: 0, duration: .3 }} />
    <ol className={ui.stepper}>{STEPS.map((label, index) => {
      const working = running && progress === index;
      const needsReview = index === 3 && review;
      const status = working ? (en ? "In progress" : "处理中") : needsReview ? (en ? "Needs review" : "待复核")
        : complete[index] ? (en ? "Completed" : "已完成") : available[index] ? (en ? "Available" : "可查看") : (en ? "Complete the previous stage first" : "请先完成前面的阶段");
      return <li key={label[0]}><button type="button" className={ui.step} aria-current={selected === index ? "step" : undefined}
        disabled={!available[index]} title={status} onClick={() => onSelect(index)}>
        <span className={`${ui.stepIndex} ${complete[index] ? ui.completeIndex : ""} ${needsReview ? ui.warningIndex : ""}`} aria-hidden="true">
          {working ? <LoaderCircle className={ui.spin} /> : needsReview ? <CircleAlert /> : complete[index] ? <Check /> : index + 1}
        </span><span>{label[en ? 1 : 0]}</span><span className="sr-only"> · {status}</span>
      </button></li>;
    })}</ol>
  </nav>;
}

export function VersionMenu({ runs, currentId, en, disabled, onSelect }: { runs: EditRun[]; currentId?: string; en: boolean; disabled: boolean; onSelect: (run: EditRun) => void }) {
  return <details className={ui.history}><summary>{en ? "Versions & activity" : "版本与记录"}<ChevronDown size={14} aria-hidden="true" /></summary>
    <div className={ui.historyMenu}><p>{en ? "Recent activity · saved locally" : "最近记录 · 保存在本机"}</p>
      {runs.map(run => <button type="button" key={run.id} disabled={disabled} aria-current={run.id === currentId ? "true" : undefined}
        onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); onSelect(run); }}>
        <span>{run.checkpoint.plan?.title || run.checkpoint.promotionCopy?.title || operationLabel(run, en)}</span>
        <small>{operationLabel(run, en)} · {run.quality} · {runLabel(run, en)}</small>
        {run.createdAt ? <time dateTime={new Date(run.createdAt).toISOString()}>{new Intl.DateTimeFormat(en ? "en" : "zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(run.createdAt)}</time> : null}
      </button>)}
    </div>
  </details>;
}

export function MediaPreview({ src, label, result = false, en = false }: { src?: string | null; label: string; result?: boolean; en?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <div className={result ? ui.resultVideo : ui.sourceVideo}>
    {!src ? <div className={ui.mediaEmpty}><FileVideo aria-hidden="true" /><p>{label}</p></div>
      : failed ? <div className={ui.mediaEmpty} role="alert"><CircleAlert aria-hidden="true" /><p>{label} · {en ? "Could not load video" : "加载失败"}</p>
        <Button variant="outline" onClick={() => { setFailed(false); setAttempt(v => v + 1); }}><RefreshCw />{en ? "Retry" : "重试"}</Button></div>
        : <video key={`${src}-${attempt}`} src={src} aria-label={label} controls playsInline preload="metadata" onError={() => setFailed(true)} />}
  </div>;
}

export function WorkspaceLoading({ en }: { en: boolean }) {
  return <section className={ui.loading} role="status" aria-label={en ? "Loading saved workspace" : "正在读取已有工作区"}>
    <Skeleton className="h-6 w-40" /><Skeleton className="h-56 w-full" /><Skeleton className="h-10 w-64 max-w-full" />
    <span>{en ? "Reading media and saved progress…" : "正在读取素材和已有进度…"}</span>
  </section>;
}

export function TaskFeedback({ run, en, busy, onRetry, onCancel, compact = false }: {
  run: EditRun; en: boolean; busy: boolean; compact?: boolean; onRetry: () => void; onCancel: () => void;
}) {
  const active = isActive(run);
  return <section className={compact ? ui.compactTask : ui.taskPanel} aria-label={en ? "Task progress" : "任务进度"}>
    <Notice tone={canRetry(run) ? (run.status === "cancelled" ? "info" : "warning") : "info"} title={runLabel(run, en)}>
      {active ? (en ? "Progress is saved. You can revisit completed stages while Mora stays open." : "进度会持续保存。保持 Mora 运行期间，可以回看已完成的阶段。")
        : run.error || (en ? "Saved progress is retained. Resume when ready." : "已完成的进度仍然保留，可以继续本次任务。")}
    </Notice>
    {active ? <div className={ui.taskProgress} role="progressbar" aria-label={runLabel(run, en)}><span className={ui.spin}><LoaderCircle aria-hidden="true" /></span><span>{en ? "Processing saved task" : "正在处理当前任务"}</span></div> : null}
    <div className={ui.taskActions}>{active ? <Button variant="outline" disabled={busy || run.status === "cancel_requested"} onClick={onCancel}><Square />{en ? "Stop this task" : "停止本次任务"}</Button>
      : canRetry(run) ? <Button variant="outline" disabled={busy} onClick={onRetry}><RefreshCw />{en ? "Resume this stage" : "继续当前阶段"}</Button> : null}</div>
  </section>;
}

function logContent(detail: string, en: boolean) {
  try {
    const value: unknown = JSON.parse(detail);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const fields = value as Record<string, unknown>;
      const labels: Record<string, string> = en ? { title: "Title", angle: "Angle", hook: "Hook", body: "Value", cta: "Call to action" } : { title: "标题", angle: "推广角度", hook: "开场吸引", body: "价值说明", cta: "行动引导" };
      const entries = Object.entries(labels).filter(([key]) => typeof fields[key] === "string");
      if (entries.length) return <dl className={ui.logFields}>{entries.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{String(fields[key])}</dd></div>)}</dl>;
    }
    return <pre className={ui.logRaw}>{JSON.stringify(value, null, 2)}</pre>;
  } catch { return <p className={ui.logText}>{detail}</p>; }
}

export function TechnicalDetails({ run, en }: { run: EditRun; en: boolean }) {
  const labels: Record<string, string> = en ? { analysis: "Source analysis", promotion_copy: "Promotion copy", validate_edit_plan: "Plan validation", render_edit: "Video rendering", inspect_output: "Output review", create_voiceover: "Voiceover", finish: "Completed" } : { analysis: "素材理解", promotion_copy: "推广文案", validate_edit_plan: "方案校验", render_edit: "视频合成", inspect_output: "成片检查", create_voiceover: "生成旁白", finish: "完成" };
  const history = run.checkpoint.history;
  return <details className={ui.technical}><summary><span><strong>{en ? "Run log" : "运行日志"}</strong><small>{runLabel(run, en)} · {history.length} {en ? "events" : "条记录"}</small></span><ChevronDown aria-hidden="true" /></summary>
    <div className={ui.logBody}><p className={ui.logTask}>{en ? "Task ID" : "任务编号"}<code>{run.id}</code></p>
      {run.error ? <Notice tone="danger" title={en ? "Task error" : "任务异常"}>{run.error}</Notice> : null}
      {!history.length ? <p className={ui.help}>{en ? "No events recorded yet. Events appear as the task progresses." : "尚无运行记录，任务推进后会显示在这里。"}</p> : <ol className={ui.logList}>{history.map((item, i) => {
        const date = new Date(item.at);
        return <li key={`${item.at}-${i}`}><div className={ui.logHeading}><strong>{labels[item.action] ?? item.action}</strong><time dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}>{Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(en ? "en" : "zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date)}</time></div>
          <details className={ui.logEntry}><summary>{en ? "View recorded content" : "查看记录内容"}<ChevronDown aria-hidden="true" /></summary>{logContent(item.detail, en)}</details>
        </li>;
      })}</ol>}
    </div></details>;
}
