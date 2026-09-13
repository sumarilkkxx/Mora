// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import { batchJobs, batchJobItems, projects, compositions } from "../db/schema";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";

const fake = vi.hoisted(() => ({ db: undefined as unknown as BetterSQLite3Database }));
vi.mock("../db", () => ({ getDb: () => fake.db }));
import { PATCH } from "../../app/api/batch/route";
import { withBatchExecution } from "../batch-execution";
let native: Database.Database;
const patch = (body: unknown) => PATCH(new NextRequest("http://localhost/api/batch", { method: "PATCH", body: JSON.stringify(body) }));
beforeAll(() => {
  native = new Database(":memory:"); fake.db = drizzle(native);
  migrate(fake.db, { migrationsFolder: "drizzle" });
});
afterAll(() => native.close());
describe("batch execution ownership", () => {
  it("lets only one page claim a running batch and fences stale writers", async () => {
    fake.db.insert(batchJobs).values({ id: "shared", total: 1 }).run();
    fake.db.insert(batchJobItems).values({ id: "item", jobId: "shared", productId: "p", productName: "p" }).run();
    expect((await patch({ jobId: "shared", action: "claim", owner: "page-a" })).status).toBe(200);
    expect((await patch({ jobId: "shared", action: "claim", owner: "page-b" })).status).toBe(409);
    expect((await patch({ itemId: "item", owner: "page-b", patch: { status: "done" } })).status).toBe(409);
    expect((await patch({ jobId: "shared", action: "release", owner: "page-a" })).status).toBe(200);
    expect((await patch({ jobId: "shared", action: "claim", owner: "page-b" })).status).toBe(200);
    expect((await patch({ itemId: "item", owner: "page-a", patch: { status: "done" } })).status).toBe(409);
  });
  it("keeps an in-flight request exclusive and reuses a checkpoint after its response is lost", async () => {
    fake.db.insert(batchJobs).values({ id: "inflight", total: 1 }).run();
    fake.db.insert(batchJobItems).values({ id: "inflight-item", jobId: "inflight", productId: "p", productName: "p" }).run();
    await patch({ jobId: "inflight", action: "claim", owner: "old" });
    const request = (owner: string) => new NextRequest("http://localhost/api/project", { method: "POST", headers: { "x-mora-batch-item": "inflight-item", "x-mora-batch-owner": owner } });
    let finish!: (response: Response) => void;
    const execute = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const pending = withBatchExecution(request("old"), "project", execute);
    expect((await withBatchExecution(request("old"), "project", execute)).status).toBe(409);
    expect((await patch({ jobId: "inflight", action: "release", owner: "old" })).status).toBe(409);
    expect((await patch({ jobId: "inflight", action: "claim", owner: "new" })).status).toBe(409);
    finish(Response.json({ id: "saved-project" }));
    await pending;
    await patch({ jobId: "inflight", action: "release", owner: "old" });
    await patch({ jobId: "inflight", action: "claim", owner: "new" });
    expect(await (await withBatchExecution(request("new"), "project", execute)).json()).toEqual({ id: "saved-project" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("allows expired execution to be claimed but rejects the old owner", async () => {
    fake.db.insert(batchJobs).values({ id: "expired", executionOwner: "old", executionUntil: Date.now() - 1 }).run();
    expect((await patch({ jobId: "expired", action: "claim", owner: "new" })).status).toBe(200);
    expect((await patch({ jobId: "expired", action: "renew", owner: "old" })).status).toBe(409);
  });
  it("cannot settle a failed or missing-product item as a completed batch", async () => {
    fake.db.insert(batchJobs).values({ id: "missing", total: 1 }).run();
    fake.db.insert(batchJobItems).values({ id: "missing-item", jobId: "missing", productId: "deleted", productName: "deleted", status: "failed" }).run();
    await patch({ jobId: "missing", action: "claim", owner: "page" });
    expect((await patch({ jobId: "missing", owner: "page", status: "done" })).status).toBe(409);
    expect((await patch({ jobId: "missing", owner: "page", status: "running" })).status).toBe(200);
  });
  it("records completion for both render updates and already-completed inserts", () => {
    fake.db.insert(projects).values({ id: "completion-project", name: "test" }).run();
    const createdAt = new Date("2020-01-01T00:00:00Z");
    fake.db.insert(compositions).values({ id: "render", projectId: "completion-project", createdAt, status: "composing" }).run();
    expect(fake.db.select().from(compositions).where(eq(compositions.id, "render")).get()!.completedAt).toBeNull();
    const before = Date.now();
    fake.db.update(compositions).set({ status: "done" }).where(eq(compositions.id, "render")).run();
    fake.db.insert(compositions).values({ id: "cloud", projectId: "completion-project", createdAt, status: "done" }).run();
    for (const id of ["render", "cloud"]) {
      const row = fake.db.select().from(compositions).where(eq(compositions.id, id)).get()!;
      expect(row.createdAt).toEqual(createdAt);
      expect(row.completedAt!.getTime()).toBeGreaterThanOrEqual(before);
    }
  });
  it("migrates existing completed work without making it appear newly completed", () => {
    const legacy = new Database(":memory:");
    try {
      for (const file of readdirSync("drizzle").filter(file => file.endsWith(".sql") && file < "0023").sort()) legacy.exec(readFileSync(`drizzle/${file}`, "utf8"));
      legacy.exec("INSERT INTO projects (id, name) VALUES ('old-project', 'old'); INSERT INTO compositions (id, project_id, status, created_at) VALUES ('old-render', 'old-project', 'done', 1234567)");
      legacy.exec(readFileSync("drizzle/0023_review_recovery.sql", "utf8"));
      expect(legacy.prepare("SELECT created_at, completed_at FROM compositions WHERE id = 'old-render'").get()).toEqual({ created_at: 1234567, completed_at: 1234567000 });
    } finally { legacy.close(); }
  });
});
