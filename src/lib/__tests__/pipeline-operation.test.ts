// @vitest-environment node
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

const fake = vi.hoisted(() => ({ db: undefined as unknown as BetterSQLite3Database<typeof schema> }));
vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));
import { startPipelineRun } from "@/lib/pipeline-runner";
import { OperationRunRepository, operationOwner } from "@/lib/operation-run";

let sqlite: Database.Database;

beforeEach(() => {
  vi.useFakeTimers();
  sqlite = new Database(":memory:");
  fake.db = drizzle(sqlite, { schema });
  migrate(fake.db, { migrationsFolder: "drizzle" });
  fake.db.insert(schema.projects).values({ id: "p", name: "fixture" }).run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sqlite.close();
});

describe("pipeline OperationRun adapter", () => {
  it("deduplicates a request and completes through the shared checkpoint", async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/compose")) {
        fake.db.insert(schema.compositions).values({ id: "render", projectId: "p", status: "done" }).run();
        return Response.json({ compositionId: "render" }, { status: 202 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", request);
    const input = { projectId: "p", origin: "http://localhost", fromStage: "compose" as const, requestKey: "pipeline:p:same" };
    const first = await startPipelineRun(input);
    const second = await startPipelineRun(input);
    expect(second).toBe(first);
    expect(fake.db.select().from(schema.pipelineRuns).all()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.waitFor(() => expect(fake.db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, first)).get()?.status).toBe("done"));
    expect(new OperationRunRepository(fake.db, { owner: operationOwner }).read(first)).toMatchObject({
      status: "done",
      checkpoint: { compositionId: "render" },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("turns cancellation during compose polling into a durable terminal state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      fake.db.insert(schema.compositions).values({ id: "pending-render", projectId: "p", status: "composing" }).run();
      return Response.json({ compositionId: "pending-render" }, { status: 202 });
    }));
    const id = await startPipelineRun({ projectId: "p", origin: "http://localhost", fromStage: "compose", requestKey: "pipeline:p:cancel" });
    await vi.advanceTimersByTimeAsync(0);
    const operations = new OperationRunRepository(fake.db, { owner: operationOwner });
    expect(operations.requestCancel(id)).toBe("cancel_requested");
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.waitFor(() => expect(operations.read(id)?.status).toBe("cancelled"));
    expect(fake.db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, id)).get()?.status).toBe("cancelled");
  });

  it("does not let an expired executor overwrite a replacement owner's run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      fake.db.insert(schema.compositions).values({ id: "takeover-render", projectId: "p", status: "composing" }).run();
      return Response.json({ compositionId: "takeover-render" }, { status: 202 });
    }));
    const id = await startPipelineRun({ projectId: "p", origin: "http://localhost", fromStage: "compose", requestKey: "pipeline:p:takeover" });
    await vi.advanceTimersByTimeAsync(0);
    sqlite.prepare("UPDATE operation_runs SET lease_until = 0 WHERE id = ?").run(id);
    const replacement = new OperationRunRepository(fake.db, { owner: "replacement", leaseMs: 60_000 });
    expect(replacement.claim(id)?.owner).toBe("replacement");
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.waitFor(() => expect(replacement.read(id)?.owner).toBe("replacement"));
    expect(replacement.read(id)?.status).toBe("running");
    expect(fake.db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, id)).get()?.status).toBe("running");
  });
});
