// @vitest-environment node
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { DiagnosticBundleService } from "@/lib/diagnostic-bundle";
import { createLocalDiagnosticSources } from "@/lib/diagnostic-sources";

const databases: Database.Database[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  vi.unstubAllGlobals();
});

describe("local diagnostic sources", () => {
  it("reads only migration and operation lifecycle facts from a real SQLite database", async () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") });
    sqlite.prepare(`insert into operation_runs
      (id, kind, subject_id, request_key, status, stage, attempt, checkpoint, result, error, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        "private-id", "compose", "private-project", "private-request", "failed", "rendering", 1,
        JSON.stringify({ prompt: "FULL-PRIVATE-PROMPT" }), JSON.stringify({ product: "PRIVATE-PRODUCT" }),
        "Authorization: Bearer diagnostic-secret", Date.UTC(2026, 8, 26), Date.UTC(2026, 8, 26, 0, 1),
      );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const sources = createLocalDiagnosticSources({
      getDatabase: () => sqlite,
      migrationsDir: join(process.cwd(), "drizzle"),
      ffmpegPath: "ffmpeg-fixture",
      ffprobePath: "ffprobe-fixture",
      runProcess: async command => {
        if (command.includes("ffprobe")) throw Object.assign(new Error("missing /private/tool"), { code: "tool_unavailable" });
        return { stdout: "ffmpeg version 7.1 Copyright", stderr: "" };
      },
    });
    const draft = await new DiagnosticBundleService({ sources }).generate();
    const content = draft.files.find(file => file.path === "diagnostics.json")!.content;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(content).toContain('"migrationVersion": "0027_operation_runs"');
    expect(content).toContain('"ffmpeg"');
    expect(content).toContain('"version": "7.1"');
    expect(content).toContain('"ffprobe"');
    expect(content).toContain('"errorCode": "tool_unavailable"');
    expect(content).not.toMatch(/private-id|private-project|private-request|FULL-PRIVATE-PROMPT|PRIVATE-PRODUCT|diagnostic-secret/);
  });
});
