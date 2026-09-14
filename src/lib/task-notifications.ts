import type { TaskRow } from "@/lib/task-feed";

export const TASKS_SEEN_STORAGE_KEY = "mora:task-center-seen:v1";

export function taskTimestamp(value?: string | null): number {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function unreadCompletedCount(tasks: TaskRow[], lastSeenAt: number | null): number {
  if (lastSeenAt == null) return 0;
  return tasks.reduce((count, task) => count + (taskTimestamp(task.completedAt ?? task.createdAt) > lastSeenAt ? 1 : 0), 0);
}
