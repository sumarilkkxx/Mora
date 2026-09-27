import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import type Database from "better-sqlite3";

export const PROJECT_PACKAGE_FORMAT = "mora-project";
export const PROJECT_PACKAGE_VERSION = 1;

export interface ProjectPackageProgress {
  stage: "collecting" | "writing" | "validating" | "publishing";
  completedBytes: number;
  totalBytes: number;
  currentPath?: string;
}

export interface ProjectPackageEstimate {
  projectId: string;
  fileCount: number;
  sourceBytes: number;
  estimatedPackageBytes: number;
}

export interface ProjectPackageExportResult extends ProjectPackageEstimate {
  destination: string;
  packageBytes: number;
  manifestSha256: string;
}

export interface ProjectPackageImportResult {
  projectId: string;
  originalProjectId: string;
  conflictResolved: boolean;
  importedFiles: number;
  importedRows: number;
  expandedBytes: number;
}

export interface ProjectPackageLimits {
  maxArchiveBytes: number;
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxEntries: number;
  maxCompressionRatio: number;
  minimumFreeBytes: number;
}

interface ProjectPackageEntry {
  path: string;
  size: number;
  sha256: string;
  kind: "database" | "upload" | "output";
}

interface ProjectPackageManifest {
  format: typeof PROJECT_PACKAGE_FORMAT;
  version: typeof PROJECT_PACKAGE_VERSION;
  createdAt: string;
  project: { id: string; name: string };
  entries: ProjectPackageEntry[];
  expandedBytes: number;
}

interface SnapshotTable {
  columns: string[];
  rows: unknown[][];
}

interface ProjectSnapshot {
  projectId: string;
  tables: Record<string, SnapshotTable>;
}

interface ProjectPackageServiceOptions {
  database: Database.Database;
  dataDir: string;
}

interface PackageOperationOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ProjectPackageProgress) => void;
}

interface ImportPackageOptions extends PackageOperationOptions {
  limits?: Partial<ProjectPackageLimits>;
}

interface CollectedFile {
  sourcePath: string;
  archivePath: string;
  kind: "upload" | "output";
  size: number;
}

const PROJECT_SCOPED_TABLES = [
  "scripts",
  "publish_metrics",
  "assets",
  "video_clips",
  "ai_tasks",
  "compositions",
  "media_sources",
  "auto_edit_runs",
  "guided_edit_plans",
  "media_edits",
  "pipeline_runs",
  "batch_job_items",
] as const;

const SNAPSHOT_TABLES = new Set([
  "projects",
  ...PROJECT_SCOPED_TABLES,
  "auto_edit_analysis",
  "batch_jobs",
  "operation_runs",
]);

const INSERT_ORDER = [
  "projects",
  "scripts",
  "publish_metrics",
  "assets",
  "video_clips",
  "ai_tasks",
  "compositions",
  "media_sources",
  "auto_edit_analysis",
  "guided_edit_plans",
  "media_edits",
  "auto_edit_runs",
  "pipeline_runs",
  "batch_jobs",
  "batch_job_items",
  "operation_runs",
] as const;

const PRIMARY_KEYS: Record<string, string> = {
  projects: "id",
  scripts: "id",
  publish_metrics: "id",
  assets: "id",
  video_clips: "id",
  ai_tasks: "id",
  compositions: "id",
  media_sources: "id",
  auto_edit_runs: "id",
  auto_edit_analysis: "cache_key",
  guided_edit_plans: "id",
  media_edits: "id",
  pipeline_runs: "id",
  batch_jobs: "id",
  batch_job_items: "id",
  operation_runs: "id",
};

const DEFAULT_LIMITS: ProjectPackageLimits = {
  maxArchiveBytes: 2 * 1024 ** 3,
  maxExpandedBytes: 8 * 1024 ** 3,
  maxEntryBytes: 2 * 1024 ** 3,
  maxEntries: 10_000,
  maxCompressionRatio: 200,
  minimumFreeBytes: 64 * 1024 ** 2,
};

const SAFE_PROJECT_ID = /^[a-zA-Z0-9-]+$/;

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Project package operation cancelled", "AbortError");
}

function replaceEvery(value: string, search: string, replacement: string): string {
  return search ? value.split(search).join(replacement) : value;
}

function portableString(value: string, dataDir: string, projectId: string): string {
  const uploadRoot = join(dataDir, "uploads", projectId);
  const outputRoot = join(dataDir, "output", projectId);
  let portable = value;
  portable = replaceEvery(portable, uploadRoot, "mora-file://uploads");
  portable = replaceEvery(portable, outputRoot, "mora-file://output");
  portable = replaceEvery(portable, uploadRoot.split(sep).join("/"), "mora-file://uploads");
  portable = replaceEvery(portable, outputRoot.split(sep).join("/"), "mora-file://output");
  portable = replaceEvery(portable, `/api/files/${projectId}/`, "mora-api://uploads/");
  portable = replaceEvery(portable, `/api/output/${projectId}/`, "mora-api://output/");
  return portable;
}

const SENSITIVE_KEY = /(?:api.?key|access.?token|refresh.?token|authorization|cookie|credential|password|secret)/i;

function redactSensitiveText(value: string): string {
  return value
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/((?:api.?key|access.?token|refresh.?token|authorization|cookie|credential|password|secret)\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
}

function sanitizeExportString(value: string, dataDir: string, projectId: string): string {
  const visit = (item: unknown, key?: string): unknown => {
    if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
    if (typeof item === "string") return portableString(redactSensitiveText(item), dataDir, projectId);
    if (Array.isArray(item)) return item.map((child) => visit(child));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([childKey, child]) => [childKey, visit(child, childKey)]));
    return item;
  };
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return JSON.stringify(visit(JSON.parse(value))); }
    catch { /* ordinary text that happens to begin with punctuation */ }
  }
  return portableString(redactSensitiveText(value), dataDir, projectId);
}

function safeArchivePath(value: string): boolean {
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function assertSafeRelative(value: string): string {
  if (!safeArchivePath(value)) throw new ProjectPackageError("UNSAFE_PATH", `Unsafe project package path: ${value}`);
  return value;
}

function transformStructuredString(value: string, transform: (item: string) => string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return transform(value);
  try {
    const visit = (item: unknown): unknown => {
      if (typeof item === "string") return transform(item);
      if (Array.isArray(item)) return item.map(visit);
      if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
      return item;
    };
    return JSON.stringify(visit(JSON.parse(value)));
  } catch {
    return transform(value);
  }
}

function restorePortableString(value: string, dataDir: string, projectId: string): string {
  const mappings = [
    ["mora-file://uploads/", join(dataDir, "uploads", projectId)],
    ["mora-file://output/", join(dataDir, "output", projectId)],
    ["mora-api://uploads/", `/api/files/${projectId}`],
    ["mora-api://output/", `/api/output/${projectId}`],
  ] as const;
  for (const [prefix, root] of mappings) {
    if (!value.startsWith(prefix)) continue;
    const suffix = assertSafeRelative(value.slice(prefix.length));
    return prefix.startsWith("mora-file") ? join(root, ...suffix.split("/")) : `${root}/${suffix}`;
  }
  return value;
}

function records(table: SnapshotTable | undefined): Record<string, unknown>[] {
  if (!table) return [];
  return table.rows.map((values) => Object.fromEntries(table.columns.map((column, index) => [column, values[index]])));
}

function archiveFailure(code: string, message: string): never {
  throw new ProjectPackageError(code, message);
}

function parseManifest(bytes: Buffer): ProjectPackageManifest {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return archiveFailure("INVALID_MANIFEST", "Project package manifest is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return archiveFailure("INVALID_MANIFEST", "Project package manifest is invalid");
  const manifest = value as Partial<ProjectPackageManifest>;
  if (manifest.format !== PROJECT_PACKAGE_FORMAT) return archiveFailure("UNKNOWN_FORMAT", "Unsupported project package format");
  if (manifest.version !== PROJECT_PACKAGE_VERSION) return archiveFailure("UNKNOWN_VERSION", `Unsupported project package version: ${String(manifest.version)}`);
  if (!manifest.project || typeof manifest.project.id !== "string" || typeof manifest.project.name !== "string" || !SAFE_PROJECT_ID.test(manifest.project.id)) {
    return archiveFailure("INVALID_MANIFEST", "Project package identity is invalid");
  }
  if (!Array.isArray(manifest.entries) || !Number.isSafeInteger(manifest.expandedBytes) || manifest.expandedBytes! < 0) {
    return archiveFailure("INVALID_MANIFEST", "Project package entries are invalid");
  }
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.path !== "string" || !safeArchivePath(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || !["database", "upload", "output"].includes(entry.kind)) {
      return archiveFailure("INVALID_MANIFEST", "Project package entry metadata is invalid");
    }
  }
  return manifest as ProjectPackageManifest;
}

function parseSnapshot(bytes: Buffer, manifest: ProjectPackageManifest): ProjectSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return archiveFailure("INVALID_DATABASE_SNAPSHOT", "Project package database snapshot is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return archiveFailure("INVALID_DATABASE_SNAPSHOT", "Project package database snapshot is invalid");
  const snapshot = value as Partial<ProjectSnapshot>;
  if (snapshot.projectId !== manifest.project.id || !snapshot.tables || typeof snapshot.tables !== "object" || Array.isArray(snapshot.tables)) {
    return archiveFailure("INVALID_DATABASE_SNAPSHOT", "Project package database identity does not match its manifest");
  }
  for (const [name, table] of Object.entries(snapshot.tables)) {
    if (!SNAPSHOT_TABLES.has(name) || !table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || table.columns.some((column) => typeof column !== "string")) {
      return archiveFailure("INVALID_DATABASE_SNAPSHOT", `Unsupported project package table: ${name}`);
    }
    if (new Set(table.columns).size !== table.columns.length || table.rows.some((row) => !Array.isArray(row) || row.length !== table.columns.length)) {
      return archiveFailure("INVALID_DATABASE_SNAPSHOT", `Invalid rows for project package table: ${name}`);
    }
  }
  if (records(snapshot.tables.projects).length !== 1) return archiveFailure("INVALID_DATABASE_SNAPSHOT", "Project package must contain exactly one project");
  return snapshot as ProjectSnapshot;
}

function portableReferences(snapshot: ProjectSnapshot): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const mappings = [
        ["mora-file://uploads/", "files/uploads/"],
        ["mora-file://output/", "files/output/"],
        ["mora-api://uploads/", "files/uploads/"],
        ["mora-api://output/", "files/output/"],
      ] as const;
      for (const [prefix, archivePrefix] of mappings) {
        if (value.startsWith(prefix)) {
          const raw = value.slice(prefix.length);
          let decoded = raw;
          try { decoded = decodeURIComponent(raw); } catch { /* keep literal path */ }
          found.add(`${archivePrefix}${assertSafeRelative(decoded)}`);
          return;
        }
      }
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try { visit(JSON.parse(value)); } catch { /* ordinary text */ }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value && typeof value === "object") for (const child of Object.values(value)) visit(child);
  };
  visit(snapshot);
  return [...found].sort();
}

function rowsFor(database: Database.Database, table: string, column: string, values: string[]): Record<string, unknown>[] {
  if (values.length === 0) return [];
  const placeholders = values.map(() => "?").join(", ");
  return database.prepare(`select * from ${table} where ${column} in (${placeholders}) order by rowid`).all(...values) as Record<string, unknown>[];
}

function snapshotTable(table: string, rows: Record<string, unknown>[], dataDir: string, projectId: string): SnapshotTable {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return {
    columns,
    rows: rows.map((row) => columns.map((column) => {
      const value = row[column];
      if ((table === "operation_runs" && ["owner", "lease_until"].includes(column))
        || (table === "auto_edit_runs" && column === "owner")
        || (table === "compositions" && ["render_owner", "render_heartbeat"].includes(column))) return null;
      return typeof value === "string" ? sanitizeExportString(value, dataDir, projectId) : value;
    })),
  };
}

async function collectTree(sourceRoot: string, archiveRoot: string, kind: "upload" | "output", result: CollectedFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const sourcePath = join(sourceRoot, entry.name);
    const archivePath = `${archiveRoot}/${entry.name}`;
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink()) throw new ProjectPackageError("UNSAFE_SOURCE_FILE", `Project package cannot include symbolic link: ${sourcePath}`);
    if (info.isDirectory()) await collectTree(sourcePath, archivePath, kind, result);
    else if (info.isFile()) result.push({ sourcePath, archivePath, kind, size: info.size });
  }
}

export class ProjectPackageError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProjectPackageError";
  }
}

export class ProjectPackageService {
  private readonly database: Database.Database;
  private readonly dataDir: string;

  constructor(options: ProjectPackageServiceOptions) {
    this.database = options.database;
    this.dataDir = resolve(options.dataDir);
  }

  async estimate(projectId: string): Promise<ProjectPackageEstimate> {
    const project = this.project(projectId);
    const files = await this.collectFiles(projectId);
    const snapshot = this.snapshot(projectId);
    this.assertReferencedFiles(snapshot, files);
    const sourceBytes = files.reduce((total, file) => total + file.size, 0);
    const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot));
    return {
      projectId: String(project.id),
      fileCount: files.length,
      sourceBytes,
      estimatedPackageBytes: sourceBytes + snapshotBytes + 4096,
    };
  }

  async export(projectId: string, destination: string, options: PackageOperationOptions = {}): Promise<ProjectPackageExportResult> {
    throwIfAborted(options.signal);
    const project = this.project(projectId);
    const files = await this.collectFiles(projectId);
    const snapshot = this.snapshot(projectId);
    this.assertReferencedFiles(snapshot, files);
    const snapshotBytes = Buffer.from(JSON.stringify(snapshot, null, 2));
    const totalBytes = files.reduce((total, file) => total + file.size, snapshotBytes.byteLength);
    const archive = new AdmZip();
    const entries: ProjectPackageEntry[] = [];
    archive.addFile("data/project.json", snapshotBytes);
    entries.push({ path: "data/project.json", size: snapshotBytes.byteLength, sha256: hash(snapshotBytes), kind: "database" });
    let completedBytes = snapshotBytes.byteLength;
    options.onProgress?.({ stage: "collecting", completedBytes, totalBytes, currentPath: "data/project.json" });

    for (const file of files) {
      throwIfAborted(options.signal);
      const bytes = await readFile(file.sourcePath, { signal: options.signal });
      archive.addFile(file.archivePath, bytes);
      entries.push({ path: file.archivePath, size: bytes.byteLength, sha256: hash(bytes), kind: file.kind });
      completedBytes += bytes.byteLength;
      options.onProgress?.({ stage: "collecting", completedBytes, totalBytes, currentPath: file.archivePath });
    }

    entries.sort((left, right) => left.path.localeCompare(right.path));
    const manifest: ProjectPackageManifest = {
      format: PROJECT_PACKAGE_FORMAT,
      version: PROJECT_PACKAGE_VERSION,
      createdAt: new Date().toISOString(),
      project: { id: String(project.id), name: String(project.name) },
      entries,
      expandedBytes: entries.reduce((total, entry) => total + entry.size, 0),
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
    archive.addFile("manifest.json", manifestBytes);

    const destinationPath = resolve(destination);
    const temporaryPath = join(dirname(destinationPath), `.${basename(destinationPath)}.${randomUUID()}.partial`);
    await mkdir(dirname(destinationPath), { recursive: true });
    options.onProgress?.({ stage: "writing", completedBytes, totalBytes });
    try {
      await archive.writeZipPromise(temporaryPath, { overwrite: false });
      throwIfAborted(options.signal);
      await rename(temporaryPath, destinationPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") throw new ProjectPackageError("INSUFFICIENT_DISK", "Not enough disk space to export the project package");
      throw error;
    }
    const packageBytes = (await stat(destinationPath)).size;
    options.onProgress?.({ stage: "publishing", completedBytes: totalBytes, totalBytes });
    return {
      ...(await this.estimate(projectId)),
      destination: destinationPath,
      packageBytes,
      manifestSha256: hash(manifestBytes),
    };
  }

  async importPackage(packagePath: string, options: ImportPackageOptions = {}): Promise<ProjectPackageImportResult> {
    throwIfAborted(options.signal);
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const archivePath = resolve(packagePath);
    const archiveInfo = await stat(archivePath);
    if (archiveInfo.size > limits.maxArchiveBytes) throw new ProjectPackageError("ARCHIVE_TOO_LARGE", "Project package exceeds the archive size limit");

    let archive: AdmZip;
    try {
      archive = new AdmZip(archivePath);
    } catch {
      throw new ProjectPackageError("INVALID_ARCHIVE", "Project package is not a readable ZIP archive");
    }
    const allZipEntries = archive.getEntries();
    if (allZipEntries.length > limits.maxEntries) throw new ProjectPackageError("TOO_MANY_ENTRIES", "Project package contains too many files");
    const zipByName = new Map<string, AdmZip.IZipEntry>();
    let headerExpandedBytes = 0;
    for (const entry of allZipEntries) {
      const checkedName = entry.isDirectory ? entry.entryName.replace(/\/+$/, "") : entry.entryName;
      if (!safeArchivePath(checkedName)) throw new ProjectPackageError("ZIP_SLIP", `Unsafe ZIP entry path: ${entry.entryName}`);
      if (entry.isDirectory) continue;
      if (zipByName.has(entry.entryName)) throw new ProjectPackageError("DUPLICATE_ENTRY", `Duplicate ZIP entry: ${entry.entryName}`);
      if (entry.header.encrypted) throw new ProjectPackageError("ENCRYPTED_ARCHIVE", "Encrypted project packages are not supported");
      if (entry.header.size > limits.maxEntryBytes) throw new ProjectPackageError("ENTRY_TOO_LARGE", `Project package entry is too large: ${entry.entryName}`);
      const ratio = entry.header.size / Math.max(1, entry.header.compressedSize);
      if (ratio > limits.maxCompressionRatio) throw new ProjectPackageError("COMPRESSION_BOMB", `Project package entry has an unsafe compression ratio: ${entry.entryName}`);
      headerExpandedBytes += entry.header.size;
      if (headerExpandedBytes > limits.maxExpandedBytes) throw new ProjectPackageError("EXPANDED_SIZE_EXCEEDED", "Project package expands beyond the configured limit");
      zipByName.set(entry.entryName, entry);
    }
    const zipEntries = [...zipByName.values()];

    const manifestEntry = zipByName.get("manifest.json");
    if (!manifestEntry) throw new ProjectPackageError("MISSING_MANIFEST", "Project package manifest is missing");
    const manifestBytes = manifestEntry.getData();
    const manifest = parseManifest(manifestBytes);
    const listedNames = new Set(manifest.entries.map((entry) => entry.path));
    if (listedNames.size !== manifest.entries.length) throw new ProjectPackageError("DUPLICATE_ENTRY", "Project package manifest contains duplicate entries");
    if (!listedNames.has("data/project.json")) throw new ProjectPackageError("MISSING_DATABASE_SNAPSHOT", "Project package database snapshot is missing");
    if (manifest.entries.reduce((total, entry) => total + entry.size, 0) !== manifest.expandedBytes) {
      throw new ProjectPackageError("INVALID_MANIFEST", "Project package expanded size does not match its entries");
    }
    const actualNames = new Set(zipEntries.map((entry) => entry.entryName).filter((name) => name !== "manifest.json"));
    if (actualNames.size !== listedNames.size || [...actualNames].some((name) => !listedNames.has(name))) {
      throw new ProjectPackageError("UNLISTED_ENTRY", "Project package contents do not match its manifest");
    }

    await mkdir(this.dataDir, { recursive: true });
    const disk = await statfs(this.dataDir);
    const availableBytes = Number(disk.bavail) * Number(disk.bsize);
    if (availableBytes < manifest.expandedBytes + limits.minimumFreeBytes) {
      throw new ProjectPackageError("INSUFFICIENT_DISK", "Not enough disk space to import the project package");
    }

    const stageRoot = join(this.dataDir, ".mora-imports", randomUUID());
    let snapshotBytes: Buffer | undefined;
    let completedBytes = 0;
    try {
      for (const declared of manifest.entries) {
        throwIfAborted(options.signal);
        const entry = zipByName.get(declared.path);
        if (!entry) throw new ProjectPackageError("MISSING_ENTRY", `Project package entry is missing: ${declared.path}`);
        let bytes: Buffer;
        try {
          bytes = entry.getData();
        } catch {
          throw new ProjectPackageError("CORRUPT_ENTRY", `Project package entry cannot be decoded: ${declared.path}`);
        }
        if (bytes.byteLength !== declared.size || hash(bytes) !== declared.sha256) {
          throw new ProjectPackageError("HASH_MISMATCH", `Project package integrity check failed: ${declared.path}`);
        }
        if (declared.path === "data/project.json") {
          if (declared.kind !== "database") throw new ProjectPackageError("INVALID_MANIFEST", "Database snapshot has the wrong entry kind");
          snapshotBytes = bytes;
        } else {
          const prefix = declared.kind === "upload" ? "files/uploads/" : declared.kind === "output" ? "files/output/" : "";
          if (!prefix || !declared.path.startsWith(prefix)) throw new ProjectPackageError("INVALID_MANIFEST", `Project package entry kind does not match its path: ${declared.path}`);
          const relativePath = assertSafeRelative(declared.path.slice(prefix.length));
          const stagedPath = join(stageRoot, declared.kind === "upload" ? "uploads" : "output", ...relativePath.split("/"));
          await mkdir(dirname(stagedPath), { recursive: true });
          await writeFile(stagedPath, bytes, { signal: options.signal });
        }
        completedBytes += bytes.byteLength;
        options.onProgress?.({ stage: "validating", completedBytes, totalBytes: manifest.expandedBytes, currentPath: declared.path });
      }
      if (!snapshotBytes) throw new ProjectPackageError("MISSING_DATABASE_SNAPSHOT", "Project package database snapshot is missing");
      const snapshot = parseSnapshot(snapshotBytes, manifest);
      const originalProjectId = manifest.project.id;
      const databaseConflict = Boolean(this.database.prepare("select 1 from projects where id = ?").get(originalProjectId));
      const fileConflict = existsSync(join(this.dataDir, "uploads", originalProjectId)) || existsSync(join(this.dataDir, "output", originalProjectId));
      const conflictResolved = databaseConflict || fileConflict;
      const projectId = conflictResolved ? randomUUID() : originalProjectId;
      const prepared = this.prepareImportedRows(snapshot, projectId, conflictResolved);
      throwIfAborted(options.signal);
      options.onProgress?.({ stage: "publishing", completedBytes, totalBytes: manifest.expandedBytes });
      this.publishImport(stageRoot, projectId, prepared);
      await rm(stageRoot, { recursive: true, force: true });
      return {
        projectId,
        originalProjectId,
        conflictResolved,
        importedFiles: manifest.entries.filter((entry) => entry.kind !== "database").length,
        importedRows: Object.values(prepared).reduce((total, rows) => total + rows.length, 0),
        expandedBytes: manifest.expandedBytes,
      };
    } catch (error) {
      await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") throw new ProjectPackageError("INSUFFICIENT_DISK", "Not enough disk space to import the project package");
      throw error;
    }
  }

  private prepareImportedRows(snapshot: ProjectSnapshot, projectId: string, remapAll: boolean): Record<string, Record<string, unknown>[]> {
    const byTable = Object.fromEntries(Object.entries(snapshot.tables).map(([table, value]) => [table, records(value)]));
    const project = byTable.projects?.[0];
    if (!project || project.id !== snapshot.projectId) throw new ProjectPackageError("INVALID_DATABASE_SNAPSHOT", "Project row does not match the package identity");

    const idMap = new Map<string, string>([[snapshot.projectId, projectId]]);
    for (const [table, rows] of Object.entries(byTable)) {
      const primaryKey = PRIMARY_KEYS[table];
      if (!primaryKey) continue;
      for (const row of rows) {
        const original = row[primaryKey];
        if (typeof original !== "string" || original.length === 0) throw new ProjectPackageError("INVALID_DATABASE_SNAPSHOT", `Missing primary key for ${table}`);
        if (table === "projects") continue;
        const exists = Boolean(this.database.prepare(`select 1 from ${table} where ${primaryKey} = ?`).get(original));
        if (remapAll || exists) idMap.set(original, randomUUID());
      }
    }

    const suffix = randomUUID().slice(0, 8);
    for (const [table, rows] of Object.entries(byTable)) {
      const allowedColumns = new Set((this.database.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
      for (const row of rows) {
        for (const column of Object.keys(row)) {
          if (!allowedColumns.has(column)) throw new ProjectPackageError("UNKNOWN_COLUMN", `Unsupported column ${table}.${column}`);
        }
        for (const [column, value] of Object.entries(row)) {
          if (typeof value !== "string") continue;
          row[column] = transformStructuredString(value, (item) => {
            const restored = restorePortableString(item, this.dataDir, projectId);
            return idMap.get(restored) ?? restored;
          });
        }
        if ("project_id" in row) row.project_id = projectId;
        const primaryKey = PRIMARY_KEYS[table];
        if (primaryKey && typeof row[primaryKey] === "string") row[primaryKey] = idMap.get(String(row[primaryKey])) ?? row[primaryKey];
        if (table === "projects") {
          row.id = projectId;
          row.deleted_at = null;
        }
        if ((table === "auto_edit_runs" || table === "operation_runs") && typeof row.request_key === "string") {
          const duplicate = Boolean(this.database.prepare(`select 1 from ${table} where request_key = ?`).get(row.request_key));
          if (remapAll || duplicate) row.request_key = `${row.request_key}:import:${suffix}`;
        }
        if (table === "operation_runs" && ["queued", "running", "cancel_requested"].includes(String(row.status))) {
          row.status = "interrupted";
          row.owner = null;
          row.lease_until = null;
          row.error = row.error || "interrupted during project package import";
        }
        if (table === "auto_edit_runs" && ["queued", "running", "cancel_requested"].includes(String(row.status))) {
          row.status = "interrupted";
          row.owner = null;
          row.error = row.error || "interrupted during project package import";
        }
      }
    }
    return byTable;
  }

  private publishImport(stageRoot: string, projectId: string, byTable: Record<string, Record<string, unknown>[]>): void {
    const stagedUploads = join(stageRoot, "uploads");
    const stagedOutput = join(stageRoot, "output");
    const finalUploads = join(this.dataDir, "uploads", projectId);
    const finalOutput = join(this.dataDir, "output", projectId);
    if (existsSync(finalUploads) || existsSync(finalOutput)) throw new ProjectPackageError("PROJECT_PATH_CONFLICT", "Imported project file destination already exists");
    mkdirSync(dirname(finalUploads), { recursive: true });
    mkdirSync(dirname(finalOutput), { recursive: true });
    let uploadsPublished = false;
    let outputPublished = false;
    const publish = this.database.transaction(() => {
      if (existsSync(stagedUploads)) {
        renameSync(stagedUploads, finalUploads);
        uploadsPublished = true;
      }
      if (existsSync(stagedOutput)) {
        renameSync(stagedOutput, finalOutput);
        outputPublished = true;
      }
      for (const table of INSERT_ORDER) {
        for (const row of byTable[table] ?? []) {
          const columns = Object.keys(row);
          const names = columns.map((column) => `"${column}"`).join(", ");
          const placeholders = columns.map(() => "?").join(", ");
          this.database.prepare(`insert into ${table} (${names}) values (${placeholders})`).run(...columns.map((column) => row[column]));
        }
      }
    });
    try {
      publish();
    } catch (error) {
      if (uploadsPublished) rmSync(finalUploads, { recursive: true, force: true });
      if (outputPublished) rmSync(finalOutput, { recursive: true, force: true });
      throw error;
    }
  }

  private project(projectId: string): Record<string, unknown> {
    const project = this.database.prepare("select * from projects where id = ?").get(projectId) as Record<string, unknown> | undefined;
    if (!project) throw new ProjectPackageError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
    return project;
  }

  private snapshot(projectId: string): ProjectSnapshot {
    const projectRows = rowsFor(this.database, "projects", "id", [projectId]);
    const tables: Record<string, SnapshotTable> = { projects: snapshotTable("projects", projectRows, this.dataDir, projectId) };
    for (const table of PROJECT_SCOPED_TABLES) {
      const rows = rowsFor(this.database, table, "project_id", [projectId]);
      if (rows.length > 0) tables[table] = snapshotTable(table, rows, this.dataDir, projectId);
    }
    const sourceIds = records(tables.media_sources).map((row) => String(row.id));
    const analysisRows = rowsFor(this.database, "auto_edit_analysis", "source_id", sourceIds);
    if (analysisRows.length > 0) tables.auto_edit_analysis = snapshotTable("auto_edit_analysis", analysisRows, this.dataDir, projectId);

    const batchJobIds = [...new Set(records(tables.batch_job_items).map((row) => String(row.job_id)))];
    const batchRows = rowsFor(this.database, "batch_jobs", "id", batchJobIds).map((row) => ({ ...row, total: 1 }));
    if (batchRows.length > 0) tables.batch_jobs = snapshotTable("batch_jobs", batchRows, this.dataDir, projectId);

    const subjectIds = [
      projectId,
      ...records(tables.auto_edit_runs).map((row) => String(row.id)),
      ...records(tables.pipeline_runs).map((row) => String(row.id)),
      ...records(tables.compositions).map((row) => String(row.id)),
      ...batchJobIds,
    ];
    const operationRows = rowsFor(this.database, "operation_runs", "subject_id", [...new Set(subjectIds)]);
    if (operationRows.length > 0) tables.operation_runs = snapshotTable("operation_runs", operationRows, this.dataDir, projectId);
    return { projectId, tables };
  }

  private async collectFiles(projectId: string): Promise<CollectedFile[]> {
    const result: CollectedFile[] = [];
    await collectTree(join(this.dataDir, "uploads", projectId), "files/uploads", "upload", result);
    await collectTree(join(this.dataDir, "output", projectId), "files/output", "output", result);
    return result.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
  }

  private assertReferencedFiles(snapshot: ProjectSnapshot, files: CollectedFile[]): void {
    const available = new Set(files.map((file) => file.archivePath));
    const missing = portableReferences(snapshot).find((path) => !available.has(path));
    if (missing) throw new ProjectPackageError("SOURCE_FILE_MISSING", `Project file referenced by the database is missing: ${missing}`);
  }
}
