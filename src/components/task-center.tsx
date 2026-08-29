"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { EMPTY_TASK_FEED, type TaskFeed, type TaskRow } from "@/lib/task-feed";
import { TASKS_SEEN_STORAGE_KEY, taskTimestamp, unreadCompletedCount } from "@/lib/task-notifications";

const POLL_MS = 15_000;

/**
 * Global task center: a bell with a live badge and a panel answering "what is
 * running right now, and is any paid task stuck?" across ALL projects. Money at
 * risk (billed tasks that lost contact) surfaces here instead of hiding inside
 * one project's assets page.
 */
export function TaskCenter({ collapsed = false, enableRecovery = false }: { collapsed?: boolean; enableRecovery?: boolean }) {
  const t = useT("common");
  const pathname = usePathname();
  const providers = useSettingsStore((state) => state.providers);
  const [feed, setFeed] = useState<TaskFeed>(EMPTY_TASK_FEED);
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const recovering = useRef(false);
  const rejectedCredentials = useRef(new Map<string, string>());

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

  // App-wide recovery worker. It performs one cheap status check per active paid
  // task, so users may navigate anywhere; reopening the app resumes automatically.
  const recoverPaidTasks = useCallback(async () => {
    if (!enableRecovery) return;
    if (recovering.current) return;
    recovering.current = true;
    try {
      const list = await fetch("/api/ai/tasks?active=1");
      if (!list.ok) return;
      const tasks = await list.json();
      if (!Array.isArray(tasks)) return;
      await Promise.allSettled(tasks.map(async (task: TaskRow) => {
        if (!task.provider || !task.taskId) return;
        const config = providers[task.provider];
        // A provider may have been disabled after this already-paid task was
        // submitted. Disabling future generation must not strand an existing
        // cloud result, so recovery only requires the saved credential.
        if (!config?.apiKey) return;
        // A rejected credential cannot become valid by polling harder. Retry only
        // after the user changes that provider's key in Settings.
        if (rejectedCredentials.current.get(task.provider) === config.apiKey) return;
        const response = await fetch("/api/ai/video/task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: task.provider,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            taskId: task.taskId,
            wait: false,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403 || result.credentialRequired) {
          rejectedCredentials.current.set(task.provider, config.apiKey);
          window.dispatchEvent(new CustomEvent("mora:ai-task-updated", {
            detail: { projectId: task.projectId, taskId: task.taskId, status: "unknown", credentialRequired: true },
          }));
          return;
        }
        if (result.status === "completed" || result.status === "failed" || result.status === "cancelled") {
          window.dispatchEvent(new CustomEvent("mora:ai-task-updated", {
            detail: { projectId: task.projectId, taskId: task.taskId, status: result.status, persisted: result.persisted },
          }));
        }
      }));
    } finally {
      recovering.current = false;
    }
  }, [enableRecovery, providers]);

  // initial load + keep polling while anything is in flight or needs attention;
  // the leading setTimeout(…, 0) keeps the first fetch off the synchronous effect body
  const busy = feed.active.length > 0 || feed.attention.length > 0;
  useEffect(() => {
    const tick = () => void recoverPaidTasks().finally(refresh);
    const kickoff = setTimeout(tick, 0);
    const interval = busy ? setInterval(tick, POLL_MS) : null;
    const onFocus = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearTimeout(kickoff);
      if (interval) clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [busy, refresh, recoverPaidTasks]);

  const badgeCount = feed.active.length + feed.attention.length;
  const unreadCount = unreadCompletedCount(feed.recent, lastSeenAt);
  const hasAttention = feed.attention.length > 0;
  const hasRunning = feed.active.length > 0;

  const markTasksSeen = useCallback(() => {
    const newest = feed.recent.reduce((latest, task) => Math.max(latest, taskTimestamp(task.createdAt)), Date.now());
    window.localStorage.setItem(TASKS_SEEN_STORAGE_KEY, String(newest));
    setLastSeenAt(newest);
    window.dispatchEvent(new CustomEvent("mora:tasks-seen", { detail: newest }));
  }, [feed.recent]);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(TASKS_SEEN_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      setLastSeenAt(stored);
    } else {
      const baseline = Date.now();
      window.localStorage.setItem(TASKS_SEEN_STORAGE_KEY, String(baseline));
      setLastSeenAt(baseline);
    }
    const syncSeen = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail;
      const next = Number.isFinite(detail) ? detail : Number(window.localStorage.getItem(TASKS_SEEN_STORAGE_KEY));
      if (Number.isFinite(next) && next > 0) setLastSeenAt(next);
    };
    window.addEventListener("mora:tasks-seen", syncSeen);
    window.addEventListener("storage", syncSeen);
    return () => {
      window.removeEventListener("mora:tasks-seen", syncSeen);
      window.removeEventListener("storage", syncSeen);
    };
  }, []);

  useEffect(() => {
    if (pathname === "/tasks" && unreadCount > 0) markTasksSeen();
  }, [markTasksSeen, pathname, unreadCount]);

  const stateClass = hasAttention ? "is-attention" : hasRunning ? "is-running" : unreadCount > 0 ? "has-new" : "";
  const stateLabel = hasAttention
    ? t("taskCenterNeedsAttention", { n: feed.attention.length })
    : hasRunning
      ? t("taskCenterRunning", { n: feed.active.length })
      : unreadCount > 0
        ? t("taskCenterNewResult", { n: unreadCount })
        : "";

  return (
    <Link
        href="/tasks"
        aria-current={pathname === "/tasks" ? "page" : undefined}
        aria-label={stateLabel ? `${t("taskCenter")} · ${stateLabel}` : t("taskCenter")}
        title={stateLabel || t("taskCenter")}
        onClick={markTasksSeen}
        className={`task-center-nav studio-nav-item relative flex items-center gap-2.5 ${stateClass} ${pathname === "/tasks" ? "is-active" : ""} ${
          collapsed ? "h-11 w-11 justify-center" : "w-full px-3 py-2"
        }`}
      >
        <span className="task-center-icon relative shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {(badgeCount > 0 || unreadCount > 0) && (
            <span
              className={`task-center-badge absolute -right-2 -top-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ${
                hasAttention ? "bg-amber-600" : unreadCount > 0 && !hasRunning ? "bg-emerald-600" : "bg-primary"
              }`}
            >
              {badgeCount || unreadCount}
            </span>
          )}
        </span>
        {!collapsed && <><span className="min-w-0 flex-1">{t("taskCenter")}</span>{stateLabel ? <span className="task-center-state-dot" aria-hidden="true" /> : null}</>}
    </Link>
  );
}
