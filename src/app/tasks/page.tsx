"use client";

import { PageHeader } from "@/components/studio/page";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, CircleDashed, CirclePlay, Clock3, Info, LoaderCircle, RefreshCw, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/relative-time";
import { EMPTY_TASK_FEED, taskHref, type TaskFeed, type TaskRow } from "@/lib/task-feed";

function taskHrefFromCenter(task: TaskRow): string {
  const href = taskHref(task);
  return href.startsWith("/project/") ? `${href}${href.includes("?") ? "&" : "?"}from=tasks` : href;
}

function taskTitleKey(row: TaskRow): string {
  if (row.kind === "auto_edit") return "kindAutoEdit";
  if (row.kind === "paid_unknown") return "kindUnknown";
  if (row.kind === "pipeline_interrupted") return "kindInterrupted";
  if (row.kind === "paid") return "kindPaid";
  if (row.kind === "compose") return "kindCompose";
  if (row.kind === "pipeline") return "kindPipeline";
  if (row.kind === "batch") return "kindBatch";
  if (row.kind === "done") return "statusDone";
  return "kindOther";
}

export default function TasksPage() {
  const t = useT("tasksPage");
  const locale = useLocale();
  const [feed, setFeed] = useState<TaskFeed>(EMPTY_TASK_FEED);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [trashing, setTrashing] = useState<string | null>(null);
  const [trashFailed, setTrashFailed] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error("TASK_FEED_FAILED");
      const next = await response.json();
      setFeed({
        active: Array.isArray(next.active) ? next.active : [],
        attention: Array.isArray(next.attention) ? next.attention : [],
        recent: Array.isArray(next.recent) ? next.recent : [],
      });
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const moveProjectToTrash = useCallback(async (task: TaskRow) => {
    if (!task.projectId || trashing) return;
    setTrashing(task.projectId);
    setTrashFailed(false);
    try {
      const response = await fetch(`/api/project/${task.projectId}`, { method: "DELETE", headers: { "Accept-Language": locale } });
      if (!response.ok) throw new Error("TRASH_FAILED");
      setFeed((current) => ({
        active: current.active.filter((row) => row.projectId !== task.projectId),
        attention: current.attention.filter((row) => row.projectId !== task.projectId),
        recent: current.recent.filter((row) => row.projectId !== task.projectId),
      }));
      window.dispatchEvent(new CustomEvent("mora:project-updated"));
    } catch {
      setTrashFailed(true);
    } finally {
      setTrashing(null);
    }
  }, [locale, trashing]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10_000);
    const onUpdate = () => void refresh(true);
    window.addEventListener("mora:ai-task-updated", onUpdate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("mora:ai-task-updated", onUpdate);
    };
  }, [refresh]);

  const renderTask = (task: TaskRow, tone: "active" | "attention" | "done") => {
    const Icon = tone === "attention" ? TriangleAlert : tone === "done" ? CheckCircle2 : CircleDashed;
    const ActionIcon = tone === "attention" ? RotateCcw : tone === "done" ? CirclePlay : Clock3;
    const metadata = [
      task.projectName || task.label,
      task.provider,
      task.model,
      task.taskId ? `${t("taskId")} ${task.taskId}` : task.stage,
      formatRelativeTime(task.createdAt ?? null, locale),
    ].filter(Boolean).join(" · ");
    const action = tone === "attention" ? t("handleTask") : tone === "done" ? t("openResult") : t("openTask");

    const canTrash = tone !== "active" && Boolean(task.projectId) && !feed.active.some((row) => row.projectId === task.projectId);
    return (
      <div key={`${task.kind}-${task.id}`} className="group flex min-w-0 items-center gap-1 px-2 transition-colors hover:bg-primary/[.025] sm:px-3">
      <Link
        href={taskHrefFromCenter(task)}
        className="flex min-w-0 flex-1 items-center gap-3.5 px-2 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
      >
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl border ${
          tone === "attention"
            ? "border-amber-500/20 bg-amber-500/[.07] text-amber-600 dark:text-amber-400"
            : tone === "done"
              ? "border-emerald-500/20 bg-emerald-500/[.06] text-emerald-600 dark:text-emerald-400"
              : "border-primary/15 bg-primary/[.065] text-primary"
        }`}>
          <Icon className={`size-4 ${tone === "active" ? "animate-spin" : ""}`} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <strong className="truncate text-sm font-semibold text-foreground">
              {t(taskTitleKey(task), { done: task.done ?? 0, total: task.total ?? 0 })}
            </strong>
          </span>
          <span className="mt-1 block truncate text-[11px] text-muted-foreground">{metadata || t("taskFallback")}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:inline-flex">
          <ActionIcon className={`size-3.5 ${tone === "attention" ? "text-amber-600 dark:text-amber-400" : tone === "done" ? "text-emerald-600 dark:text-emerald-400" : "text-primary"}`} aria-hidden="true" />
          {action}
          <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </Link>
      {canTrash ? <span className="ml-1 flex shrink-0 border-l border-border/55 pl-2">
        <button
          type="button"
          title={t("moveToTrash")}
          aria-label={t("moveToTrash")}
          disabled={Boolean(trashing)}
          onClick={() => void moveProjectToTrash(task)}
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground/45 transition-[background-color,color,transform] hover:bg-muted/70 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/20 active:scale-[.94] disabled:opacity-45"
        >
          {trashing === task.projectId ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Trash2 className="size-3.5" />}
        </button>
      </span> : null}
      </div>
    );
  };

  const currentCount = feed.active.length + feed.attention.length;
  const recent = feed.recent.slice(0, 5);

  return (
    <main className="studio-page max-w-5xl">
      <PageHeader title={t("title")} description={t("queueSubtitle")} actions={
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-border/70 bg-card px-3.5 text-xs font-medium transition-[border-color,background-color,transform] hover:border-primary/25 hover:bg-primary/[.025] active:scale-[.98] disabled:opacity-60">
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />{t("refresh")}
        </button>
      } />

      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-primary/15 bg-primary/[.04] px-4 py-3 text-xs leading-5 text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{t("backgroundNote")}</span>
      </div>

      {failed ? <div className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/[.05] px-4 py-3 text-sm text-destructive">{t("loadFailed")}</div> : null}
      {trashFailed ? <div role="alert" className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/[.05] px-4 py-3 text-sm text-destructive">{t("trashFailed")}</div> : null}

      <section className="mt-7 overflow-hidden rounded-[22px] border border-border/65 bg-card shadow-[0_14px_38px_rgba(42,74,105,.06)]" aria-labelledby="current-tasks-title">
        <div className="flex items-center justify-between gap-4 border-b border-border/55 px-4 py-4 sm:px-5">
          <div>
            <h2 id="current-tasks-title" className="text-sm font-semibold">{t("currentTitle")}</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("currentCount", { n: currentCount })}</p>
          </div>
          {feed.attention.length > 0 ? <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/[.06] px-2.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"><span className="size-1.5 rounded-full bg-amber-500" />{t("attentionCount", { n: feed.attention.length })}</span> : null}
        </div>

        {loading ? (
          <div className="space-y-px p-2" aria-label={t("loading")}>
            {[0, 1].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-primary/[.035]" />)}
          </div>
        ) : currentCount > 0 ? (
          <div className="divide-y divide-border/50">
            {feed.attention.map((task) => renderTask(task, "attention"))}
            {feed.active.map((task) => renderTask(task, "active"))}
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-6 sm:px-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-500/15 bg-emerald-500/[.055] text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4.5" aria-hidden="true" /></span>
            <div><p className="text-sm font-semibold">{t("currentEmpty")}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("currentEmptyHint")}</p></div>
          </div>
        )}
      </section>

      <section className="mt-5 overflow-hidden rounded-[22px] border border-border/65 bg-card shadow-[0_14px_38px_rgba(42,74,105,.045)]" aria-labelledby="recent-tasks-title">
        <div className="flex items-center justify-between gap-4 border-b border-border/55 px-4 py-4 sm:px-5">
          <div><h2 id="recent-tasks-title" className="text-sm font-semibold">{t("recentTitle")}</h2><p className="mt-1 text-[11px] text-muted-foreground">{t("recentHint")}</p></div>
          <Clock3 className="size-4 text-muted-foreground/60" aria-hidden="true" />
        </div>
        {recent.length > 0 ? <div className="divide-y divide-border/50">{recent.map((task) => renderTask(task, "done"))}</div> : <p className="px-4 py-6 text-xs text-muted-foreground sm:px-5">{t("recentEmpty")}</p>}
      </section>
    </main>
  );
}
