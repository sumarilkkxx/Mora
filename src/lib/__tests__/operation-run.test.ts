import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { OperationRunRepository } from "@/lib/operation-run";
import { operationBucket, readOperationModel, syncLegacyOperationRuns } from "@/lib/operation-read-model";

let sqlite: Database.Database;
let runs: OperationRunRepository;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  runs = new OperationRunRepository(db, { now: () => 1_000, owner: "100:executor", leaseMs: 100 });
});
afterEach(() => sqlite.close());

describe("OperationRunRepository", () => {
  it("deduplicates the same request key before billable work starts", () => {
    const first = runs.create({ kind: "pipeline", subjectId: "p", requestKey: "request-1", stage: "judge" });
    const second = runs.create({ kind: "pipeline", subjectId: "p", requestKey: "request-1", stage: "judge" });
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, run: { id: first.run.id } });
  });

  it("claims, heartbeats and checkpoints only for the current lease owner", () => {
    const { run } = runs.create({ kind: "compose", subjectId: "p", requestKey: "compose-1", stage: "render" });
    expect(runs.claim(run.id)?.attempt).toBe(1);
    expect(runs.checkpoint(run.id, { frames: 12 }, "rendering")).toBe(true);
    const stale = new OperationRunRepository(db, { now: () => 1_020, owner: "100:stale", leaseMs: 100 });
    expect(stale.checkpoint(run.id, { frames: 99 }, "bad")).toBe(false);
    expect(runs.read(run.id)?.checkpoint).toEqual({ frames: 12 });
    expect(runs.heartbeat(run.id)).toBe(true);
  });

  it("fences an expired owner from publishing after another owner takes over", () => {
    const { run } = runs.create({ kind: "batch", subjectId: "job", requestKey: "batch-1", stage: "item" });
    expect(runs.claim(run.id)).toBeTruthy();
    const replacement = new OperationRunRepository(db, { now: () => 1_101, owner: "100:new", leaseMs: 100 });
    expect(replacement.claim(run.id)?.attempt).toBe(2);
    expect(runs.finish(run.id, "done", { output: "stale" })).toBe(false);
    expect(replacement.finish(run.id, "done", { output: "new" })).toBe(true);
    expect(replacement.read(run.id)).toMatchObject({ status: "done", result: { output: "new" } });
  });

  it("turns cancellation into a durable terminal state at queue and cooperative checkpoints", () => {
    const queued = runs.create({ kind: "batch", subjectId: "a", requestKey: "cancel-queued", stage: "queued" }).run;
    expect(runs.requestCancel(queued.id)).toBe("cancelled");
    const active = runs.create({ kind: "pipeline", subjectId: "p", requestKey: "cancel-active", stage: "compose" }).run;
    runs.claim(active.id);
    expect(runs.requestCancel(active.id)).toBe("cancel_requested");
    expect(runs.cancellationRequested(active.id)).toBe(true);
    expect(runs.finish(active.id, "cancelled")).toBe(true);
  });

  it("recovers expired leases as interrupted without losing checkpoints", () => {
    const { run } = runs.create({ kind: "pipeline", subjectId: "p", requestKey: "restart", stage: "stock_fill" });
    runs.claim(run.id);
    runs.checkpoint(run.id, { completed: ["judge"] }, "stock_fill");
    expect(runs.recoverExpired(1_101)).toBe(1);
    expect(runs.read(run.id)).toMatchObject({ status: "interrupted", stage: "stock_fill", checkpoint: { completed: ["judge"] } });
  });

  it("imports legacy lifecycle rows once without interrupting current envelopes", () => {
    db.insert(schema.projects).values({ id: "p", name: "fixture" }).run();
    db.insert(schema.pipelineRuns).values([
      { id: "legacy", projectId: "p", status: "running", stage: "stock_fill" },
      { id: "current", projectId: "p", status: "running", stage: "compose" },
    ]).run();
    runs.create({ id: "current", kind: "pipeline", subjectId: "p", requestKey: "current", stage: "compose" });
    runs.claim("current");
    expect(syncLegacyOperationRuns(db)).toBeGreaterThan(0);
    expect(runs.read("legacy")).toMatchObject({ status: "interrupted", stage: "stock_fill" });
    expect(runs.read("current")).toMatchObject({ status: "running", owner: "100:executor" });
    expect(db.select().from(schema.pipelineRuns).all().find(row => row.id === "current")?.status).toBe("running");
    expect(syncLegacyOperationRuns(db)).toBe(0);
  });

  it("adapts an active guided composition without declaring its live render interrupted", () => {
    db.insert(schema.projects).values({ id: "p", name: "fixture" }).run();
    db.insert(schema.compositions).values({ id: "guided-render", projectId: "p", status: "composing", renderOwner: "100:render", renderHeartbeat: 10 }).run();
    sqlite.exec("INSERT INTO media_sources (id, project_id, original_name, file_path, mime_type) VALUES ('source', 'p', 'source.mp4', '/tmp/source.mp4', 'video/mp4')");
    sqlite.exec("INSERT INTO guided_edit_plans (id, project_id, source_id, document, composition_id, status) VALUES ('plan', 'p', 'source', '{}', 'guided-render', 'rendering')");
    syncLegacyOperationRuns(db);
    expect(runs.read("guided-render")).toMatchObject({ status: "running", owner: "100:render", leaseUntil: 70_000 });
    expect(db.select().from(schema.compositions).where(eq(schema.compositions.id, "guided-render")).get()?.status).toBe("composing");
    sqlite.prepare("UPDATE compositions SET render_heartbeat = 20, status = 'done' WHERE id = 'guided-render'").run();
    syncLegacyOperationRuns(db);
    expect(runs.read("guided-render")).toMatchObject({ status: "done", owner: null, leaseUntil: null });
  });

  it("keeps guided render cancellation visible in the shared operation lifecycle", () => {
    db.insert(schema.projects).values({ id: "p", name: "fixture" }).run();
    db.insert(schema.compositions).values({ id: "guided-cancel", projectId: "p", status: "composing", renderOwner: "100:render", renderHeartbeat: 10 }).run();
    sqlite.exec("INSERT INTO media_sources (id, project_id, original_name, file_path, mime_type) VALUES ('source', 'p', 'source.mp4', '/tmp/source.mp4', 'video/mp4')");
    sqlite.exec("INSERT INTO guided_edit_plans (id, project_id, source_id, document, composition_id, status) VALUES ('cancel-plan', 'p', 'source', '{}', 'guided-cancel', 'rendering')");
    syncLegacyOperationRuns(db);
    sqlite.prepare("UPDATE guided_edit_plans SET status = 'cancelled' WHERE id = 'cancel-plan'").run();
    sqlite.prepare("UPDATE compositions SET status = 'failed' WHERE id = 'guided-cancel'").run();

    syncLegacyOperationRuns(db);
    expect(runs.read("guided-cancel")).toMatchObject({ status: "cancelled", owner: null, leaseUntil: null });
  });

  it("provides one shared active, attention, failed and done classification", () => {
    const statuses = ["running", "interrupted", "failed", "done"] as const;
    for (const status of statuses) {
      const run = runs.create({ kind: "batch", subjectId: status, requestKey: `bucket:${status}`, stage: "fixture" }).run;
      sqlite.prepare("UPDATE operation_runs SET status = ? WHERE id = ?").run(status, run.id);
    }
    const model = readOperationModel(db);
    expect(model.active).toHaveLength(1);
    expect(model.attention).toHaveLength(1);
    expect(model.failed).toHaveLength(1);
    expect(model.done).toHaveLength(1);
    expect(operationBucket("needs_review")).toBe("attention");
  });
});
