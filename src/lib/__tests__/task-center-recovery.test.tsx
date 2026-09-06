import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskCenter } from "@/components/task-center";
import { notifyTaskSubmitted } from "@/lib/task-events";

const settings = vi.hoisted(() => ({ providers: { mock: { apiKey: "test-key" } } }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/start" }));
vi.mock("@/lib/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/stores/settings-store", () => ({ useSettingsStore: (select: (s: typeof settings) => unknown) => select(settings) }));

let root: Root;
let container: HTMLDivElement;
let submitted: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  submitted = false;
  const task = { id: "row", taskId: "paid-task", provider: "mock", kind: "paid" };
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/ai/tasks?active=1") return { ok: true, json: async () => submitted ? [task] : [] };
    if (url === "/api/ai/video/task") return { ok: true, status: 200, json: async () => ({ status: "processing" }) };
    return { ok: true, json: async () => ({ active: submitted ? [task] : [], attention: [], recent: [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(TaskCenter, { enableRecovery: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const recovered = () => fetchMock.mock.calls.some(([url]) => url === "/api/ai/video/task");
describe("idle task discovery", () => {
  it("starts recovering an accepted task immediately without focus/navigation", async () => {
    expect(recovered()).toBe(false);
    submitted = true;
    await act(async () => { notifyTaskSubmitted(); });
    expect(recovered()).toBe(true);
  });

  it("discovers externally submitted tasks while idle", async () => {
    submitted = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(recovered()).toBe(true);
  });

  it("continues discovery after a transient recovery request failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { notifyTaskSubmitted(); });
    submitted = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(recovered()).toBe(true);
  });
});
