import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import NewGuidedEditPage from "./page";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => "zh", useT: () => (key: string) => key }));

it("retries a failed upload in the existing project and prevents duplicate submission", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "saved-project" }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Upload interrupted" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "source" }) });
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NewGuidedEditPage />));
    const input = host.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["video"], "source.mp4", { type: "video/mp4" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const submit = () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("createAiProject"))!;
    await act(async () => { submit().click(); submit().click(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Upload interrupted");
    expect(host.querySelector<HTMLInputElement>('input[name="project-name"]')?.disabled).toBe(true);
    await act(async () => submit().click());
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/project")).toHaveLength(1);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/project/saved-project/media");
    expect(push).toHaveBeenCalledWith("/project/saved-project/auto-edit");
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
