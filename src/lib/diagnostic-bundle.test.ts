// @vitest-environment node
import AdmZip from "adm-zip";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticBundleService, type DiagnosticSources } from "@/lib/diagnostic-bundle";

const SECRET_MARKERS = [
  "sk-test-super-secret",
  "Bearer bearer-secret",
  "session=cookie-secret",
  "github_pat_secret-value",
  "AKIA1234567890ABCDEF",
  "AIza1234567890abcdef",
  "eyJheader.payload.signature",
  "password=password-secret",
  "prompt-private-copy",
  "product-private-copy",
  "query-secret",
  "/Users/alice/private/source.mp4",
  "C:\\Users\\Alice\\private\\source.mp4",
];

function completeSources(overrides: Partial<DiagnosticSources> = {}): DiagnosticSources {
  return {
    application: async () => ({ version: "0.2.1", buildVersion: "0.2.1.0" }),
    system: async () => ({ platform: "darwin", arch: "arm64", release: "25.0.0", nodeVersion: "22.0.0", electronVersion: null }),
    database: async () => ({
      status: "ok",
      migrationVersion: "0027_operation_runs",
      migrationCount: 28,
      operations: [{
        kind: "compose",
        status: "failed",
        stage: "rendering /Users/alice/private/source.mp4 sk-test-super-secret",
        attempt: 2,
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:00:01.000Z",
        error: `Authorization: Bearer bearer-secret prompt-private-copy https://example.test/callback?token=query-secret /Users/alice/private/source.mp4`,
        checkpoint: { apiKey: "sk-test-super-secret", product: "product-private-copy" },
      }, {
        kind: "pipeline",
        status: "running",
        stage: "https://example.test/callback?token=query-secret",
      }, {
        kind: "batch",
        status: "queued",
        stage: "C:\\Users\\Alice\\private\\source.mp4 github_pat_secret-value session=cookie-secret",
      }, {
        kind: "auto_edit",
        status: "waiting_input",
        stage: "AKIA1234567890ABCDEF AIza1234567890abcdef eyJheader.payload.signature password=password-secret",
      }],
      encryptedCredential: "ciphertext-private",
    }),
    media: async () => ({
      ffmpeg: { status: "available", version: "7.1" },
      ffprobe: { status: "available", version: "7.1" },
      path: "C:\\Users\\Alice\\private\\source.mp4",
    }),
    ...overrides,
  };
}

describe("DiagnosticBundleService", () => {
  it("generates an inspectable whitelist-only draft without making network requests", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const service = new DiagnosticBundleService({
      sources: completeSources(),
      now: () => new Date("2026-09-26T00:00:00.000Z"),
      randomId: () => "diagnostic-draft",
    });

    const draft = await service.generate();
    const serialized = JSON.stringify(draft);
    const diagnostic = draft.files.find(file => file.path === "diagnostics.json")!.content;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(draft).toMatchObject({
      id: "diagnostic-draft",
      generatedAt: "2026-09-26T00:00:00.000Z",
      missing: [],
      files: [
        { path: "README.txt", category: "guide" },
        { path: "diagnostics.json", category: "diagnostics" },
        { path: "manifest.json", category: "manifest" },
      ],
    });
    expect(draft.files.every(file => file.sizeBytes === Buffer.byteLength(file.content))).toBe(true);
    expect(diagnostic).toContain('"migrationVersion": "0027_operation_runs"');
    expect(diagnostic).toContain('"errorCategory": "authorization"');
    expect(diagnostic).toContain('"errorFingerprint"');
    expect(serialized).not.toContain("ciphertext-private");
    for (const secret of SECRET_MARKERS) expect(serialized).not.toContain(secret);
    vi.unstubAllGlobals();
  });

  it("keeps a partial bundle when application, database, or media probes fail", async () => {
    const unavailable = async () => { throw new Error("/Users/alice/private/sqlite.db sk-test-super-secret"); };
    const service = new DiagnosticBundleService({
      sources: completeSources({ application: unavailable, database: unavailable, media: unavailable }),
      now: () => new Date("2026-09-26T00:00:00.000Z"),
      randomId: () => "partial-draft",
    });

    const draft = await service.generate();
    const diagnostic = JSON.parse(draft.files.find(file => file.path === "diagnostics.json")!.content);

    expect(draft.missing).toEqual(["application", "database", "media"]);
    expect(diagnostic.sections.system.status).toBe("available");
    expect(diagnostic.sections.database).toEqual({ status: "unavailable", errorCode: "database" });
    expect(JSON.stringify(draft)).not.toMatch(/alice|super-secret/);
  });

  it("exports exactly the reviewed files and honours cancellation", async () => {
    const service = new DiagnosticBundleService({
      sources: completeSources(),
      now: () => new Date("2026-09-26T00:00:00.000Z"),
      randomId: () => "export-draft",
    });
    const draft = await service.generate();
    const archiveBytes = await service.export(draft);
    const archive = new AdmZip(archiveBytes);

    expect(archive.getEntries().map(entry => entry.entryName).sort()).toEqual(draft.files.map(file => file.path).sort());
    for (const file of draft.files) expect(archive.readAsText(file.path)).toBe(file.content);

    const changed = structuredClone(draft);
    changed.files[0].content += "changed after review";
    await expect(service.export(changed)).rejects.toThrow(/changed after preview/);

    const controller = new AbortController();
    controller.abort();
    await expect(service.export(draft, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
