import { describe, expect, it } from "vitest";
import { taskTimestamp, unreadCompletedCount } from "@/lib/task-notifications";

describe("task notifications", () => {
  it("notifies when a previously viewed running task finishes", () => {
    const task = { kind: "done", id: "long-task", createdAt: "2026-08-29T07:00:00Z", completedAt: "2026-08-29T09:00:00Z" };
    expect(unreadCompletedCount([task], taskTimestamp("2026-08-29T08:00:00Z"))).toBe(1);
    expect(unreadCompletedCount([task], taskTimestamp("2026-08-29T09:00:00Z"))).toBe(0);
  });
  it("counts only completed items newer than the last visit", () => {
    const lastSeenAt = taskTimestamp("2026-08-29T08:00:00Z");
    expect(unreadCompletedCount([
      { kind: "done", id: "old", createdAt: "2026-08-29T07:59:59Z" },
      { kind: "done", id: "same", createdAt: "2026-08-29T08:00:00Z" },
      { kind: "done", id: "new", createdAt: "2026-08-29T08:00:01Z" },
    ], lastSeenAt)).toBe(1);
  });

  it("does not show historical work before a baseline exists", () => {
    expect(unreadCompletedCount([
      { kind: "done", id: "existing", createdAt: "2026-08-29T08:00:01Z" },
    ], null)).toBe(0);
  });

  it("treats malformed or missing timestamps as non-new", () => {
    expect(taskTimestamp("not-a-date")).toBe(0);
    expect(unreadCompletedCount([
      { kind: "done", id: "missing" },
      { kind: "done", id: "invalid", createdAt: "not-a-date" },
    ], 1)).toBe(0);
  });
});
