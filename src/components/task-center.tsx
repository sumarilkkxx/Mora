"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { EMPTY_TASK_FEED, type TaskFeed, type TaskRow } from "@/lib/task-feed";

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

  return (
    <Link
        href="/tasks"
        aria-current={pathname === "/tasks" ? "page" : undefined}
        aria-label={t("taskCenter")}
        title={t("taskCenter")}
        className={`studio-nav-item relative flex items-center gap-2.5 ${pathname === "/tasks" ? "is-active" : ""} ${
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
    </Link>
  );
}
