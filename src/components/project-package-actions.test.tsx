// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPackageExportButton, ProjectPackageImportButton } from "@/components/project-package-actions";
import { useSettingsStore } from "@/lib/stores/settings-store";

let host: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
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

describe("ProjectPackageExportButton", () => {
  it("shows the estimate and offers cancellation before a large package finishes", async () => {
    let downloadSignal: AbortSignal | undefined;
    const pending = new Promise<Response>(() => {});
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("estimate=1")) return Response.json({ estimatedPackageBytes: 4096, sourceBytes: 3072, fileCount: 3 });
      downloadSignal = init?.signal as AbortSignal;
      return pending;
    }));
    await act(async () => root.render(<ProjectPackageExportButton project={{ id: "p1", name: "Portable" }} />));
    const start = host.querySelector("button")!;
    await act(async () => start.click());
    await settle();
    expect(host.textContent).toContain("预计 4 KB");
    expect(host.textContent).toContain("正在准备项目包");
    const cancel = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("取消"));
    expect(cancel).toBeDefined();
    await act(async () => cancel!.click());
    expect(downloadSignal?.aborted).toBe(true);
    expect(host.textContent).toContain("已取消");
  });

  it("shows a reviewable disk-space error returned by import", async () => {
    class FailedImportRequest {
      upload: { onprogress: ((event: ProgressEvent) => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null };
      status = 507;
      responseText = JSON.stringify({ code: "INSUFFICIENT_DISK", error: "Not enough disk space to import the project package" });
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() { this.upload.onload?.(); this.onload?.(); }
      abort() { this.onabort?.(); }
    }
    vi.stubGlobal("XMLHttpRequest", FailedImportRequest);
    await act(async () => root.render(<ProjectPackageImportButton />));
    const input = host.querySelector("input[type=file]")!;
    const file = new File(["fixture"], "fixture.mora", { type: "application/vnd.mora.project+zip" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(host.textContent).toContain("Not enough disk space");
    expect(host.textContent).toContain("项目包操作失败");
  });
});
