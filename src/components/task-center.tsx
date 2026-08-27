"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT, useLocale } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TaskRow {
  kind: string;
  id: string;
  projectId?: string | null;
  projectName?: string;
  stage?: string;
  label?: string | null;
  provider?: string;
  model?: string;
  total?: number;
  done?: number;
  failed?: number;
  createdAt?: string | null;
}

interface TaskFeed {
  active: TaskRow[];
  attention: TaskRow[];
  recent: TaskRow[];
}

const POLL_MS = 15_000;

/** Where clicking a task row lands: the page that shows (or fixes) that task. */
function hrefFor(row: TaskRow): string {
  switch (row.kind) {
    case "batch":
      return "/batch";
    case "paid":
    case "paid_unknown":
      return row.projectId ? `/project/${row.projectId}/assets` : "/projects";
    case "pipeline":
    case "pipeline_interrupted":
      return row.projectId ? `/project/${row.projectId}/script` : "/projects";
    case "done":
      return row.projectId ? `/project/${row.projectId}/export` : "/projects";
    default:
      return row.projectId ? `/project/${row.projectId}/video` : "/projects";
  }
}

/**
 * Global task center: a bell with a live badge and a panel answering "what is
 * running right now, and is any paid task stuck?" across ALL projects. Money at
 * risk (billed tasks that lost contact) surfaces here instead of hiding inside
 * one project's assets page.
 */
export function TaskCenter({ collapsed = false }: { collapsed?: boolean }) {
  const t = useT("common");
  const locale = useLocale();
  const router = useRouter();
  const [feed, setFeed] = useState<TaskFeed>({ active: [], attention: [], recent: [] });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const data = (await res.json()) as TaskFeed;
      setFeed({ active: data.active ?? [], attention: data.attention ?? [], recent: data.recent ?? [] });
    } catch {
      /* the bell is an observer — network hiccups just skip a beat */
    }
  }, []);

  // initial load + keep polling while anything is in flight or needs attention;
  // the leading setTimeout(…, 0) keeps the first fetch off the synchronous effect body
  const busy = feed.active.length > 0 || feed.attention.length > 0;
  useEffect(() => {
    const tick = () => void refresh();
    const kickoff = setTimeout(tick, 0);
    const interval = busy ? setInterval(tick, POLL_MS) : null;
    return () => {
      clearTimeout(kickoff);
      if (interval) clearInterval(interval);
    };
  }, [busy, refresh]);

  const badgeCount = feed.active.length + feed.attention.length;

  const rowTitle = (row: TaskRow): string => {
    switch (row.kind) {
      case "pipeline":
        return t("taskKindPipeline", {
          stage: t(row.stage === "judge" ? "taskStageJudge" : row.stage === "stock_fill" ? "taskStageAssets" : "taskStageCompose"),
        });
      case "pipeline_interrupted":
        return t("taskKindInterrupted");
      case "compose":
        return t("taskKindCompose");
      case "paid":
        return t("taskKindPaid", { model: row.model ?? "" });
      case "paid_unknown":
        return t("taskKindPaidUnknown");
      case "batch":
        return t("taskKindBatch", { done: row.done ?? 0, total: row.total ?? 0 });
      case "done":
        return t("taskKindDone");
      default:
        return row.kind;
    }
  };

  const renderRow = (row: TaskRow, tone: "active" | "attention" | "recent") => (
    <button
      key={`${row.kind}-${row.id}`}
      type="button"
      onClick={() => router.push(hrefFor(row))}
      className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/50 ${
        tone === "attention" ? "border border-amber-500/40 bg-amber-500/10" : ""
      }`}
    >
      <span className={`flex items-center gap-1.5 text-xs font-medium ${tone === "attention" ? "text-amber-500" : ""}`}>
        {tone === "active" && (
          <svg className="h-3 w-3 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
        )}
        <span className="min-w-0 truncate">{rowTitle(row)}</span>
      </span>
      <span className="truncate text-[11px] text-muted-foreground">
        {[row.projectName || row.label, formatRelativeTime(row.createdAt ?? null, locale)].filter(Boolean).join(" · ")}
      </span>
    </button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("taskCenter")}
        title={t("taskCenter")}
        className={`relative flex items-center gap-2.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground ${
          collapsed ? "h-11 w-11 justify-center" : "w-full px-3 py-2"
        }`}
      >
        <span className="relative shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {badgeCount > 0 && (
            <span
              className={`absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white ${
                feed.attention.length > 0 ? "bg-amber-500" : "bg-primary"
              }`}
            >
              {badgeCount}
            </span>
          )}
        </span>
        {!collapsed && t("taskCenter")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        <div onClick={() => void refresh()} className="max-h-96 space-y-2 overflow-y-auto">
          {feed.attention.length > 0 && (
            <div className="space-y-1">
              <p className="px-1 text-[11px] font-medium uppercase tracking-wider text-amber-500/80">{t("taskAttention")}</p>
              {feed.attention.map((r) => renderRow(r, "attention"))}
            </div>
          )}
          {feed.active.length > 0 && (
            <div className="space-y-1">
              <p className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">{t("taskActive")}</p>
              {feed.active.map((r) => renderRow(r, "active"))}
            </div>
          )}
          {feed.recent.length > 0 && (
            <div className="space-y-1">
              <p className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">{t("taskRecent")}</p>
              {feed.recent.map((r) => renderRow(r, "recent"))}
            </div>
          )}
          {badgeCount === 0 && feed.recent.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("taskCenterEmpty")}</p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
