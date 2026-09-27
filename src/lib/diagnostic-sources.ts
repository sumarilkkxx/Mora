import { release } from "node:os";
import { readdirSync } from "node:fs";
import type Database from "better-sqlite3";
import packageMetadata from "../../package.json";
import { getSqlite } from "@/lib/db";
import { ffmpegBin, ffprobeBin } from "@/lib/ffmpeg-path";
import { runMediaProcess, type MediaProcessResult } from "@/lib/media-runtime";
import { getMigrationsDir } from "@/lib/paths";
import type { DiagnosticSources } from "@/lib/diagnostic-bundle";

interface LocalDiagnosticSourceOptions {
  getDatabase?: () => Database.Database;
  runProcess?: (command: string, args: readonly string[], options: { signal?: AbortSignal; timeoutMs: number; maxBuffer: number }) => Promise<MediaProcessResult>;
  migrationsDir?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
}

function installedMigrations(directory: string): string[] {
  return readdirSync(directory)
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map(name => name.replace(/\.sql$/, ""));
}

function toolVersion(output: string): string {
  return output.match(/\bversion\s+([^\s]+)/i)?.[1] ?? "unknown";
}

function mediaErrorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["tool_unavailable", "timeout", "cancelled"].includes(code)) return code;
  return "probe_failed";
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "number" && typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

/** Production adapters for the local-only diagnostic service. No adapter uses fetch or reads user media/log files. */
export function createLocalDiagnosticSources(options: LocalDiagnosticSourceOptions = {}): DiagnosticSources {
  const database = options.getDatabase ?? getSqlite;
  const runProcess = options.runProcess ?? runMediaProcess;
  const migrationsDir = options.migrationsDir ?? getMigrationsDir();
  const ffmpegPath = options.ffmpegPath ?? ffmpegBin();
  const ffprobePath = options.ffprobePath ?? ffprobeBin();
  return {
    application: async () => ({
      version: packageMetadata.version,
      buildVersion: packageMetadata.build?.buildVersion ?? packageMetadata.version,
    }),
    system: async () => ({
      platform: process.platform,
      arch: process.arch,
      release: release(),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? null,
    }),
    database: async () => {
      const sqlite = database();
      let expected: string[] = [];
      try { expected = installedMigrations(migrationsDir); } catch { /* reported as degraded below */ }
      const migration = sqlite.prepare("select count(*) as count from __drizzle_migrations").get() as { count?: number } | undefined;
      const migrationCount = Number(migration?.count ?? 0);
      const operations = sqlite.prepare(`
        select kind, status, stage, attempt, error, created_at as createdAt, updated_at as updatedAt
        from operation_runs
        order by created_at desc, rowid desc
        limit 50
      `).all().map(row => {
        const item = row as Record<string, unknown>;
        return { ...item, createdAt: dateValue(item.createdAt), updatedAt: dateValue(item.updatedAt) };
      });
      return {
        status: expected.length > 0 && migrationCount >= expected.length ? "ok" : "degraded",
        migrationVersion: expected[Math.min(migrationCount, expected.length) - 1] ?? "none",
        migrationCount,
        operations,
      };
    },
    media: async signal => {
      const probe = async (command: string) => {
        try {
          const result = await runProcess(command, ["-version"], { signal, timeoutMs: 5_000, maxBuffer: 64 * 1024 });
          return { status: "available", version: toolVersion(result.stdout || result.stderr) };
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          return { status: "unavailable", errorCode: mediaErrorCode(error) };
        }
      };
      const [ffmpeg, ffprobe] = await Promise.all([probe(ffmpegPath), probe(ffprobePath)]);
      return { ffmpeg, ffprobe };
    },
  };
}
