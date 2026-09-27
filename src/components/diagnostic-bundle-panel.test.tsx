// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticBundlePanel } from "@/components/diagnostic-bundle-panel";
import { useSettingsStore } from "@/lib/stores/settings-store";

let host: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useSettingsStore.setState({ locale: "zh" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("DiagnosticBundlePanel", () => {
  it("requires a visible preview before the reviewed bundle can be exported", async () => {
    const preview = {
      id: "draft-1",
      generatedAt: "2026-09-26T00:00:00.000Z",
      riskNotice: "导出前请逐项检查；不会自动上传。",
      missing: ["media"],
      files: [
        { path: "README.txt", category: "guide", sizeBytes: 10, content: "safe guide" },
        { path: "diagnostics.json", category: "diagnostics", sizeBytes: 20, content: "{\"safe\":true}" },
      ],
    };
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "/api/diagnostics") return Response.json(preview);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/vnd.mora.diagnostics+zip" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:diagnostics"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await act(async () => root.render(<DiagnosticBundlePanel />));
    expect(host.textContent).not.toContain("导出诊断包");
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    await settle();

    expect(host.textContent).toContain("导出前请逐项检查");
    expect(host.textContent).toContain("README.txt");
    expect(host.textContent).toContain("diagnostics.json");
    expect(host.textContent).toContain("媒体工具");
    expect(host.textContent).toContain("safe guide");
    const exportButton = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("导出诊断包"));
    expect(exportButton).toBeDefined();
    await act(async () => exportButton!.click());
    await settle();
    expect(fetchSpy).toHaveBeenLastCalledWith("/api/diagnostics", expect.objectContaining({ method: "POST" }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("aborts generation when the user cancels", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(() => {});
    }));
    await act(async () => root.render(<DiagnosticBundlePanel />));
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    const cancel = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("取消"));
    expect(cancel).toBeDefined();
    await act(async () => cancel!.click());
    expect(signal?.aborted).toBe(true);
    expect(host.textContent).toContain("已取消");
  });
});
