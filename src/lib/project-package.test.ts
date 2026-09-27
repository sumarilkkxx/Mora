// @vitest-environment node
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { ProjectPackageService } from "@/lib/project-package";

const roots: string[] = [];
let sqlite: Database.Database;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mora-project-package-"));
  roots.push(root);
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") });
});

afterEach(async () => {
  sqlite.close();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function minimalPackage(name = "safe.mora") {
  const projectId = "security-project";
  const uploads = join(root, "uploads", projectId);
  await mkdir(uploads, { recursive: true });
  await writeFile(join(uploads, "source.bin"), "0123456789");
  sqlite.prepare("insert into projects (id, name, product_images, media_insights, version_snapshots, is_evaluation) values (?, ?, ?, ?, ?, ?)")
    .run(projectId, "Security fixture", "[]", "[]", "[]", 0);
  const packagePath = join(root, name);
  await new ProjectPackageService({ database: sqlite, dataDir: root }).export(projectId, packagePath);
  return { packagePath, projectId };
}

describe("ProjectPackageService", () => {
  it("exports a versioned, hashed, self-contained project without credentials or original paths", async () => {
    const uploads = join(root, "uploads", "project-1");
    const output = join(root, "output", "project-1");
    await mkdir(uploads, { recursive: true });
    await mkdir(output, { recursive: true });
    await writeFile(join(uploads, "source.mp4"), "source-media");
    await writeFile(join(output, "final.mp4"), "final-media");

    const db = drizzle(sqlite, { schema });
    db.insert(schema.projects).values({ id: "project-1", name: "Portable project", workflowType: "edit", workflowMode: "guided_edit" }).run();
    db.insert(schema.scripts).values({ id: "script-1", projectId: "project-1", styleType: "story", title: "Saved script", shots: [] }).run();
    db.insert(schema.mediaSources).values({
      id: "source-1",
      projectId: "project-1",
      originalName: "source.mp4",
      filePath: join(uploads, "source.mp4"),
      mimeType: "video/mp4",
      sizeBytes: 12,
      status: "ready",
    }).run();
    db.insert(schema.compositions).values({
      id: "composition-1",
      projectId: "project-1",
      outputPath: join(output, "final.mp4"),
      status: "done",
    }).run();
    sqlite.prepare("insert into operation_runs (id, kind, subject_id, request_key, status, stage, error) values (?, ?, ?, ?, ?, ?, ?)")
      .run("operation-secret", "compose", "composition-1", "operation-secret-request", "failed", "provider", "request failed Authorization: Bearer TEST-LOG-CREDENTIAL");
    sqlite.prepare("insert into settings (key, value) values (?, ?)").run("provider-secret", JSON.stringify({ apiKey: "TEST-CREDENTIAL-MARKER" }));

    const destination = join(root, "portable.mora");
    const service = new ProjectPackageService({ database: sqlite, dataDir: root });
    const estimate = await service.estimate("project-1");
    expect(estimate).toMatchObject({ fileCount: 2, sourceBytes: 23 });
    const result = await service.export("project-1", destination);
    expect(result.projectId).toBe("project-1");

    const archive = new AdmZip(destination);
    const names = archive.getEntries().map((entry) => entry.entryName).sort();
    expect(names).toEqual([
      "data/project.json",
      "files/output/final.mp4",
      "files/uploads/source.mp4",
      "manifest.json",
    ]);
    const manifest = JSON.parse(archive.readAsText("manifest.json"));
    expect(manifest).toMatchObject({ format: "mora-project", version: 1, project: { id: "project-1", name: "Portable project" } });
    for (const entry of manifest.entries) {
      const bytes = archive.readFile(entry.path);
      expect(bytes).not.toBeNull();
      expect(bytes!.byteLength).toBe(entry.size);
      expect(sha256(bytes!)).toBe(entry.sha256);
    }
    const snapshot = archive.readAsText("data/project.json");
    const expandedPackage = Buffer.concat(archive.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.getData()));
    expect(expandedPackage.includes(Buffer.from("TEST-CREDENTIAL-MARKER"))).toBe(false);
    expect(expandedPackage.includes(Buffer.from("TEST-LOG-CREDENTIAL"))).toBe(false);
    expect(snapshot).not.toContain("TEST-LOG-CREDENTIAL");
    expect(snapshot).not.toContain(root);
    expect(snapshot).toContain("mora-file://uploads/source.mp4");
    expect(snapshot).toContain("mora-file://output/final.mp4");
  });

  it("normalizes Windows-style persisted paths and restores legacy backslash package URIs", async () => {
    const projectId = "windows-path-project";
    const uploads = join(root, "uploads", projectId);
    await mkdir(uploads, { recursive: true });
    await writeFile(join(uploads, "source.mp4"), "windows-source");
    sqlite.prepare("insert into projects (id, name, product_images, media_insights, version_snapshots, is_evaluation) values (?, ?, ?, ?, ?, ?)")
      .run(projectId, "Windows path project", "[]", "[]", "[]", 0);
    sqlite.prepare("insert into media_sources (id, project_id, original_name, file_path, mime_type, size_bytes, duration, width, height, has_audio, status, progress, scene_status, scenes) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("windows-source", projectId, "source.mp4", `${uploads}\\source.mp4`, "video/mp4", 14, 1000, 1, 1, 0, "ready", 100, "ready", "[]");

    const packagePath = join(root, "windows-path.mora");
    const service = new ProjectPackageService({ database: sqlite, dataDir: root });
    await service.export(projectId, packagePath);
    const archive = new AdmZip(packagePath);
    const snapshot = archive.readAsText("data/project.json");
    expect(snapshot).toContain("mora-file://uploads/source.mp4");
    expect(snapshot).not.toContain("mora-file://uploads\\\\source.mp4");

    const legacySnapshot = Buffer.from(snapshot.replace("mora-file://uploads/source.mp4", "mora-file://uploads\\\\source.mp4"));
    archive.updateFile("data/project.json", legacySnapshot);
    const manifest = JSON.parse(archive.readAsText("manifest.json"));
    const snapshotEntry = manifest.entries.find((entry: { path: string }) => entry.path === "data/project.json");
    snapshotEntry.size = legacySnapshot.byteLength;
    snapshotEntry.sha256 = sha256(legacySnapshot);
    manifest.expandedBytes = manifest.entries.reduce((total: number, entry: { size: number }) => total + entry.size, 0);
    archive.updateFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
    const legacyPackagePath = join(root, "legacy-windows-path.mora");
    archive.writeZip(legacyPackagePath);

    const importedRoot = await mkdtemp(join(tmpdir(), "mora-project-windows-import-"));
    roots.push(importedRoot);
    const importedSqlite = new Database(":memory:");
    importedSqlite.pragma("foreign_keys = ON");
    migrate(drizzle(importedSqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") });
    try {
      await new ProjectPackageService({ database: importedSqlite, dataDir: importedRoot }).importPackage(legacyPackagePath);
      const imported = importedSqlite.prepare("select file_path from media_sources where project_id = ?").get(projectId) as { file_path: string };
      expect(imported.file_path).toBe(join(importedRoot, "uploads", projectId, "source.mp4"));
      await expect(readFile(imported.file_path, "utf8")).resolves.toBe("windows-source");
    } finally {
      importedSqlite.close();
    }

    await rm(join(uploads, "source.mp4"));
    await expect(service.export(projectId, join(root, "missing-windows-source.mora")))
      .rejects.toMatchObject({ code: "SOURCE_FILE_MISSING" });
  });

  it("round-trips project history and media into a new data root, then remaps a conflicting import", async () => {
    const projectId = "portable-project";
    const uploads = join(root, "uploads", projectId);
    const output = join(root, "output", projectId);
    await mkdir(join(uploads, "subtitles"), { recursive: true });
    await mkdir(join(uploads, "voiceovers"), { recursive: true });
    await mkdir(output, { recursive: true });
    await writeFile(join(uploads, "source.mp4"), "source");
    await writeFile(join(uploads, "subtitles", "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nhello\n");
    await writeFile(join(uploads, "voiceovers", "line.mp3"), "audio");
    await writeFile(join(output, "final.mp4"), "finished-video");

    sqlite.prepare("insert into projects (id, name, status, workflow_type, workflow_mode, production_mode, target_duration, product_images, media_insights, version_snapshots, is_evaluation) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(projectId, "Round trip", "done", "edit", "guided_edit", "local", 15, "[]", "[]", "[]", 0);
    sqlite.prepare("insert into scripts (id, project_id, version, style_type, title, shots, selected) values (?, ?, ?, ?, ?, ?, ?)")
      .run("script-a", projectId, 1, "story", "Original script", "[]", 1);
    sqlite.prepare("insert into media_sources (id, project_id, original_name, file_path, mime_type, size_bytes, duration, width, height, has_audio, status, progress, scene_status, scenes) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("source-a", projectId, "source.mp4", join(uploads, "source.mp4"), "video/mp4", 6, 1000, 1280, 720, 1, "ready", 100, "ready", "[]");
    sqlite.prepare("insert into compositions (id, project_id, output_path, bgm_path, status, video_origin) values (?, ?, ?, ?, ?, ?)")
      .run("composition-a", projectId, join(output, "final.mp4"), join(uploads, "voiceovers", "line.mp3"), "done", "local_render");
    sqlite.prepare("insert into guided_edit_plans (id, project_id, source_id, revision, document, composition_id, status) values (?, ?, ?, ?, ?, ?, ?)")
      .run("plan-a", projectId, "source-a", 3, JSON.stringify({ version: 1, subtitleFile: join(uploads, "subtitles", "captions.srt") }), "composition-a", "done");
    sqlite.prepare("insert into auto_edit_runs (id, project_id, source_id, request_key, status, stage, brief, checkpoint, quality, heartbeat, attempt, composition_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("run-a", projectId, "source-a", "request-a", "done", "finished", JSON.stringify({ instruction: "fixture" }), JSON.stringify({ voices: [{ file: join(uploads, "voiceovers", "line.mp3") }], output: join(output, "final.mp4"), history: [], repairs: 0 }), "720p", 1, 1, "composition-a", 1, 1);
    sqlite.prepare("insert into operation_runs (id, kind, subject_id, request_key, status, stage) values (?, ?, ?, ?, ?, ?)")
      .run("operation-a", "auto_edit", "run-a", "operation-request-a", "done", "finished");

    const packagePath = join(root, "round-trip.mora");
    await new ProjectPackageService({ database: sqlite, dataDir: root }).export(projectId, packagePath);

    const importedRoot = await mkdtemp(join(tmpdir(), "mora-project-import-"));
    roots.push(importedRoot);
    const importedSqlite = new Database(":memory:");
    importedSqlite.pragma("foreign_keys = ON");
    migrate(drizzle(importedSqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") });
    try {
      const importer = new ProjectPackageService({ database: importedSqlite, dataDir: importedRoot });
      const first = await importer.importPackage(packagePath);
      expect(first).toMatchObject({ projectId, originalProjectId: projectId, conflictResolved: false });
      expect(importedSqlite.prepare("select title from scripts where project_id = ?").get(projectId)).toEqual({ title: "Original script" });
      expect(importedSqlite.prepare("select revision, status from guided_edit_plans where project_id = ?").get(projectId)).toEqual({ revision: 3, status: "done" });
      expect(importedSqlite.prepare("select count(*) as count from operation_runs").get()).toEqual({ count: 1 });
      const source = importedSqlite.prepare("select file_path from media_sources where project_id = ?").get(projectId) as { file_path: string };
      const composition = importedSqlite.prepare("select output_path from compositions where project_id = ?").get(projectId) as { output_path: string };
      expect(source.file_path).toBe(join(importedRoot, "uploads", projectId, "source.mp4"));
      expect(composition.output_path).toBe(join(importedRoot, "output", projectId, "final.mp4"));
      await expect(readFile(source.file_path, "utf8")).resolves.toBe("source");
      await expect(readFile(composition.output_path, "utf8")).resolves.toBe("finished-video");
      await expect(readFile(join(importedRoot, "uploads", projectId, "subtitles", "captions.srt"), "utf8")).resolves.toContain("hello");

      const second = await importer.importPackage(packagePath);
      expect(second.conflictResolved).toBe(true);
      expect(second.projectId).not.toBe(projectId);
      expect(importedSqlite.prepare("select count(*) as count from projects").get()).toEqual({ count: 2 });
      const remapped = importedSqlite.prepare("select output_path from compositions where project_id = ?").get(second.projectId) as { output_path: string };
      expect(remapped.output_path).toBe(join(importedRoot, "output", second.projectId, "final.mp4"));
      await expect(readFile(remapped.output_path, "utf8")).resolves.toBe("finished-video");
    } finally {
      importedSqlite.close();
    }
  });

  it("rejects damaged, incomplete and unknown-version packages before publishing product data", async () => {
    const { packagePath, projectId } = await minimalPackage();
    const service = new ProjectPackageService({ database: sqlite, dataDir: root });
    const cases: Array<{ name: string; code: string; mutate: (archive: AdmZip) => void }> = [
      {
        name: "hash-mismatch.mora",
        code: "HASH_MISMATCH",
        mutate: (archive) => archive.updateFile("files/uploads/source.bin", Buffer.from("tampered")),
      },
      {
        name: "missing-file.mora",
        code: "UNLISTED_ENTRY",
        mutate: (archive) => archive.deleteFile("files/uploads/source.bin"),
      },
      {
        name: "unknown-version.mora",
        code: "UNKNOWN_VERSION",
        mutate: (archive) => {
          const manifest = JSON.parse(archive.readAsText("manifest.json"));
          manifest.version = 99;
          archive.updateFile("manifest.json", Buffer.from(JSON.stringify(manifest)));
        },
      },
    ];
    for (const fixture of cases) {
      const archive = new AdmZip(packagePath);
      fixture.mutate(archive);
      const damagedPath = join(root, fixture.name);
      archive.writeZip(damagedPath);
      await expect(service.importPackage(damagedPath)).rejects.toMatchObject({ code: fixture.code });
      expect(sqlite.prepare("select count(*) as count from projects").get()).toEqual({ count: 1 });
      expect(sqlite.prepare("select id from projects").all()).toEqual([{ id: projectId }]);
    }
  });

  it("rejects Zip Slip, absolute paths and oversized expansion before creating files or rows", async () => {
    const { packagePath, projectId } = await minimalPackage();
    const service = new ProjectPackageService({ database: sqlite, dataDir: root });
    for (const [name, entryName] of [["zip-slip.mora", "../escape.txt"], ["absolute.mora", "/absolute.txt"]] as const) {
      const archive = new AdmZip(packagePath);
      const malicious = archive.addFile("placeholder.txt", Buffer.from("escape"));
      malicious.entryName = entryName;
      const maliciousPath = join(root, name);
      archive.writeZip(maliciousPath);
      await expect(service.importPackage(maliciousPath)).rejects.toMatchObject({ code: "ZIP_SLIP" });
    }
    await expect(service.importPackage(packagePath, { limits: { maxExpandedBytes: 5 } })).rejects.toMatchObject({ code: "EXPANDED_SIZE_EXCEEDED" });
    expect(sqlite.prepare("select id from projects").all()).toEqual([{ id: projectId }]);
    await expect(readFile(join(root, "escape.txt"))).rejects.toThrow();
  });

  it("refuses to export when a persisted project path is missing from the package", async () => {
    sqlite.prepare("insert into projects (id, name, product_images, media_insights, version_snapshots, is_evaluation) values (?, ?, ?, ?, ?, ?)")
      .run("missing-media", "Missing media", "[]", "[]", "[]", 0);
    sqlite.prepare("insert into media_sources (id, project_id, original_name, file_path, mime_type, size_bytes, duration, width, height, has_audio, status, progress, scene_status, scenes) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("missing-source", "missing-media", "gone.mp4", join(root, "uploads", "missing-media", "gone.mp4"), "video/mp4", 10, 1000, 1, 1, 0, "ready", 100, "ready", "[]");
    const service = new ProjectPackageService({ database: sqlite, dataDir: root });
    await expect(service.export("missing-media", join(root, "missing.mora"))).rejects.toMatchObject({ code: "SOURCE_FILE_MISSING" });
    await expect(readFile(join(root, "missing.mora"))).rejects.toThrow();
  });

  it("rolls back files with the SQLite transaction and reports cancellation or disk exhaustion", async () => {
    const { packagePath } = await minimalPackage();
    const exportController = new AbortController();
    const cancelledExport = join(root, "cancelled.mora");
    await expect(new ProjectPackageService({ database: sqlite, dataDir: root }).export("security-project", cancelledExport, {
      signal: exportController.signal,
      onProgress: () => exportController.abort(),
    })).rejects.toMatchObject({ name: "AbortError" });
    await expect(access(cancelledExport)).rejects.toThrow();

    const importedRoot = await mkdtemp(join(tmpdir(), "mora-project-atomic-"));
    roots.push(importedRoot);
    const target = new Database(":memory:");
    target.pragma("foreign_keys = ON");
    migrate(drizzle(target, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") });
    try {
      const importer = new ProjectPackageService({ database: target, dataDir: importedRoot });
      await expect(importer.importPackage(packagePath, { limits: { minimumFreeBytes: Number.MAX_SAFE_INTEGER } }))
        .rejects.toMatchObject({ code: "INSUFFICIENT_DISK" });
      expect(target.prepare("select count(*) as count from projects").get()).toEqual({ count: 0 });

      const controller = new AbortController();
      controller.abort();
      await expect(importer.importPackage(packagePath, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
      expect(target.prepare("select count(*) as count from projects").get()).toEqual({ count: 0 });

      const midImportController = new AbortController();
      await expect(importer.importPackage(packagePath, {
        signal: midImportController.signal,
        onProgress: () => midImportController.abort(),
      })).rejects.toMatchObject({ name: "AbortError" });
      expect(target.prepare("select count(*) as count from projects").get()).toEqual({ count: 0 });
      await expect(access(join(importedRoot, "uploads", "security-project"))).rejects.toThrow();

      target.exec("create trigger reject_import before insert on projects begin select raise(abort, 'fixture publish failure'); end");
      await expect(importer.importPackage(packagePath)).rejects.toThrow(/fixture publish failure/);
      expect(target.prepare("select count(*) as count from projects").get()).toEqual({ count: 0 });
      await expect(access(join(importedRoot, "uploads", "security-project"))).rejects.toThrow();
      await expect(access(join(importedRoot, "output", "security-project"))).rejects.toThrow();
    } finally {
      target.close();
    }
  });
});
