// @vitest-environment node
import AdmZip from "adm-zip";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/diagnostic-sources", () => ({
  createLocalDiagnosticSources: () => ({
    application: async () => ({ version: "0.2.1", buildVersion: "0.2.1.0" }),
    system: async () => ({ platform: "darwin", arch: "arm64", release: "25", nodeVersion: "22", electronVersion: null }),
    database: async () => ({ status: "ok", migrationVersion: "0027_operation_runs", migrationCount: 28, operations: [] }),
    media: async () => ({ ffmpeg: { status: "available", version: "7.1" }, ffprobe: { status: "available", version: "7.1" } }),
  }),
}));

import { DELETE, GET, POST } from "@/app/api/diagnostics/route";

describe("diagnostic bundle route", () => {
  it("previews and downloads the exact reviewed local draft", async () => {
    const previewResponse = await GET(new NextRequest("http://localhost/api/diagnostics"));
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("cache-control")).toContain("no-store");
    const preview = await previewResponse.json();
    expect(preview.files).toHaveLength(3);
    expect(preview.riskNotice).toMatch(/不会.*上传|不会自动上传/);

    const downloadResponse = await POST(new NextRequest("http://localhost/api/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: preview.id }),
    }));
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toBe("application/vnd.mora.diagnostics+zip");
    expect(downloadResponse.headers.get("content-disposition")).toContain(".zip");
    const archive = new AdmZip(Buffer.from(await downloadResponse.arrayBuffer()));
    for (const file of preview.files) expect(archive.readAsText(file.path)).toBe(file.content);

    const replayResponse = await POST(new NextRequest("http://localhost/api/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: preview.id }),
    }));
    expect(replayResponse.status).toBe(404);
  });

  it("discards a preview when the user cancels", async () => {
    const preview = await (await GET(new NextRequest("http://localhost/api/diagnostics"))).json();
    const cancelResponse = await DELETE(new NextRequest(`http://localhost/api/diagnostics?draftId=${preview.id}`, { method: "DELETE" }));
    expect(cancelResponse.status).toBe(204);

    const downloadResponse = await POST(new NextRequest("http://localhost/api/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: preview.id }),
    }));
    expect(downloadResponse.status).toBe(404);
  });
});
