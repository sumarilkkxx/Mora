// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join, resolve, sep } from "path";
import { tmpdir } from "os";
import { NextRequest } from "next/server";
import { autoEditRuns, compositions, mediaSources, projects } from "../db/schema";
import type { Action } from "../auto-edit/model";
import type { Analysis, Checkpoint, EditBrief, EditPlan } from "../auto-edit/contract";

const fake = vi.hoisted(() => ({ db: undefined as unknown as BetterSQLite3Database, action: vi.fn(), json: vi.fn(), render: vi.fn(), check: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => fake.db }));
vi.mock("../media-probe", () => ({ probeMedia: async () => ({ duration: 10, width: 320, height: 180, hasAudio: false }) }));
vi.mock("../auto-edit/media", async importOriginal => ({ ...await importOriginal<typeof import("../auto-edit/media")>(), frameAt: async () => "data:image/jpeg;base64,test", sceneSamples: async () => [], transcribe: async () => [] }));
vi.mock("../auto-edit/model", async importOriginal => ({ ...await importOriginal<typeof import("../auto-edit/model")>(), EditModel: class {
  calls = 0;
  constructor(readonly config: unknown, readonly signal: AbortSignal) {}
  recordToolResult() {}
  async action(context: string, allowedTools: string[]) { this.calls++; return fake.action(JSON.parse(context), this.signal, allowedTools); }
  async json(prompt: string) { this.calls++; return fake.json(prompt); }
} }));
vi.mock("../auto-edit/render", () => ({ renderAutoEdit: (...args: unknown[]) => fake.render(...args), checkOutput: (...args: unknown[]) => fake.check(...args) }));
vi.mock("../video-composer/frame-extract", () => ({ extractFirstFrame: async () => null }));
import { cancelAutoEdit, recoverAutoEdits, startAutoEdit } from "../auto-edit/runner";
import { GET, POST } from "../../app/api/project/[id]/auto-edit/route";

const brief: EditBrief = { promotion: { subject: "测试服务", audience: "目标顾客", sellingPoints: "画面可见特点", action: "了解详情" }, instruction: "展示原视频", target: 15, aspect: "9:16", audio: "muted", style: "auto", captions: true, locale: "zh" };
const analysis: Analysis = { version: 1, summary: "测试画面", style: "展示", scenes: [{ start: 0, end: 10, text: "画面", uncertainty: "采样", evidence: [0] }], speech: [], sampledAt: [0], warnings: [] };
const plan: EditPlan = { version: 1, title: "展示", explanation: "test", clips: [{ sourceId: "s", start: 0, end: 5, speed: 1, fit: "contain", transition: "cut", text: "画面", reason: "test", evidence: "0s" }] };
const credentials = { llm: { baseUrl: "http://localhost:9999/v1", apiKey: "private-test-key", model: "text", visionModel: "vision" } };
let native: Database.Database, directory: string;
const readRun = (id: string) => fake.db.select().from(autoEditRuns).where(eq(autoEditRuns.id, id)).get()!;
async function waitRun(id: string) {
  await vi.waitFor(() => expect(["done", "needs_review", "failed", "cancelled", "waiting_input"].includes(readRun(id).status)).toBe(true), { timeout: 8000, interval: 10 });
  return readRun(id);
}
function addRun(id: string, cp: Partial<Checkpoint> = {}) {
  return fake.db.insert(autoEditRuns).values({ id, projectId: "p", sourceId: "s", requestKey: id, brief, checkpoint: { analysis, history: [], repairs: 0, ...cp }, heartbeat: Date.now(), createdAt: Date.now(), updatedAt: Date.now() }).returning().get();
}
function post(body: unknown, project = "p") {
  return POST(new NextRequest(`http://localhost/api/project/${project}/auto-edit`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: project }) });
}
beforeAll(async () => {
  native = new Database(":memory:"); fake.db = drizzle(native);
  migrate(fake.db, { migrationsFolder: join(process.cwd(), "drizzle") });
  directory = await mkdtemp(join(tmpdir(), "mora-auto-runner-")); vi.stubEnv("APP_DATA_DIR", directory);
  await mkdir(join(directory, "uploads", "p"), { recursive: true });
  const file = join(directory, "uploads", "p", "source.mp4"); await writeFile(file, "fixture");
  fake.db.insert(projects).values([{ id: "p", name: "test" }, { id: "other", name: "other" }]).run();
  fake.db.insert(mediaSources).values({ id: "s", projectId: "p", originalName: "source.mp4", filePath: file, mimeType: "video/mp4", duration: 10000, sizeBytes: 7 }).run();
});
beforeEach(() => {
  fake.action.mockReset().mockImplementation((context): Action => {
    if (!context.currentPlan) return { tool: "validate_edit_plan", arguments: { plan } };
    if (!context.render) return { tool: "render_edit", arguments: {} };
    if (!context.render.inspected) return { tool: "inspect_output", arguments: {} };
    return { tool: "finish", arguments: { needsReview: false, reason: "Checked" } };
  });
  fake.json.mockReset().mockResolvedValue({ ...analysis, issues: [] });
  fake.render.mockReset().mockImplementation(async ({ output }) => { await writeFile(output, "render"); });
  fake.check.mockReset().mockResolvedValue({ technical: true, issues: [], review: [], duration: 5 });
});
afterAll(async () => {
  native.close(); vi.unstubAllEnvs();
  const target = resolve(directory);
  if (target.startsWith(resolve(tmpdir()) + sep) && target.includes("mora-auto-runner-")) await rm(target, { recursive: true, force: true });
});
describe("persisted AI editing lifecycle with controlled model responses", () => {
  it("revalidates an inherited plan against the current brief before any render", async () => {
    const run = addRun("inherited-overlong", { plan: { ...plan, clips: Array.from({ length: 4 }, () => ({ ...plan.clips[0] })) } });
    startAutoEdit(run, credentials); expect((await waitRun(run.id)).status).toBe("failed"); expect(fake.render).not.toHaveBeenCalled();
  });
  it("fails closed when source content differs from a saved fingerprint", async () => {
    const run = addRun("source-changed", { sourceHash: "stale-hash" }); startAutoEdit(run, credentials);
    expect((await waitRun(run.id)).error).toMatch(/Source changed/); expect(fake.action).not.toHaveBeenCalled();
  });
  it("runs validate/render/inspect/finish exactly once and publishes a composition atomically", async () => {
    const run = addRun("success"); startAutoEdit(run, credentials); startAutoEdit(run, credentials);
    const result = await waitRun(run.id);
    expect(result.status).toBe("done"); expect(fake.render).toHaveBeenCalledTimes(1);
    expect(fake.action.mock.calls.map(call => call[2])).toEqual([
      ["inspect_video_segment", "validate_edit_plan", "update_edit_settings", "request_input"],
      ["inspect_video_segment", "render_edit", "validate_edit_plan", "update_edit_settings", "request_input"],
      ["inspect_output", "request_input"],
      ["finish", "request_input"],
    ]);
    expect(fake.db.select().from(compositions).where(eq(compositions.id, result.compositionId!)).get()?.status).toBe("done");
    expect(JSON.stringify(result)).not.toContain(credentials.llm.apiKey);
  });
  it("rejects foreign project access and makes duplicate request IDs idempotent", async () => {
    const denied = await post({ action: "start", sourceId: "s", brief, credentials, requestId: "foreign" }, "other");
    expect(denied.status).toBe(400);
    const body = { action: "start", sourceId: "s", brief, credentials, requestId: "same-request" };
    const a = await (await post(body)).json();
    const b = await (await post(body)).json();
    expect(a.runId).toBe(b.runId); await waitRun(a.runId);
    const response = await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ id: "p" }) });
    const json = await response.text(); expect(json).not.toContain(credentials.llm.apiKey); expect(json).not.toContain(directory.replaceAll("\\", "\\\\"));
  });
  it("cancels an active model call and prevents output publication", async () => {
    fake.action.mockImplementation((_context, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true })));
    const run = addRun("cancel"); startAutoEdit(run, credentials);
    await vi.waitFor(() => expect(fake.action).toHaveBeenCalled());
    await cancelAutoEdit(run.id, "other"); expect(readRun(run.id).status).toBe("running");
    await cancelAutoEdit(run.id, "p"); expect((await waitRun(run.id)).status).toBe("cancelled"); expect(fake.render).not.toHaveBeenCalled();
  });
  it("recovers stale owners but leaves healthy leases untouched", async () => {
    addRun("stale"); addRun("healthy");
    fake.db.update(autoEditRuns).set({ status: "running", owner: "old", heartbeat: Date.now() - 70000 }).where(eq(autoEditRuns.id, "stale")).run();
    await recoverAutoEdits(); expect(readRun("stale").status).toBe("interrupted"); expect(readRun("healthy").status).toBe("queued");
    await cancelAutoEdit("healthy", "p"); expect(readRun("healthy").status).toBe("cancelled");
  });
  it("never steals a queued run already claimed by another executor", async () => {
    const run = addRun("leased"); fake.db.update(autoEditRuns).set({ owner: "another" }).where(eq(autoEditRuns.id, run.id)).run();
    startAutoEdit(run, credentials);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(readRun(run.id).owner).toBe("another"); expect(fake.action).not.toHaveBeenCalled();
    await cancelAutoEdit(run.id, "p");
  });
  it("exports and retries a saved manual operation without invoking the planning model", async () => {
    const manual = addRun("manual", { operation: "manual", plan }); startAutoEdit(manual, credentials);
    expect((await waitRun(manual.id)).status).toBe("done"); expect(fake.action).not.toHaveBeenCalled();
    fake.render.mockRejectedValueOnce(new Error("temporary encoder error"));
    const exported = await (await post({ action: "export", runId: manual.id, requestId: "export" })).json();
    expect((await waitRun(exported.runId)).status).toBe("failed");
    expect((await post({ action: "retry", runId: exported.runId })).status).toBe(202);
    const result = await waitRun(exported.runId); expect(result.status).toBe("done"); expect(result.quality).toBe("1080p"); expect(result.checkpoint.plan).toEqual(plan);
    expect(fake.action).not.toHaveBeenCalled(); expect(fake.json).toHaveBeenCalledTimes(1);
  });
  it("feeds invalid tool plans back for correction and caps failing renders", async () => {
    let n = 0;
    fake.action.mockImplementation((context): Action => {
      if (!context.currentPlan || ++n % 2 === 0) return { tool: "validate_edit_plan", arguments: { plan: { ...plan, clips: [{ ...plan.clips[0], start: n * 0.1, end: 5 }] } } };
      return { tool: "render_edit", arguments: {} };
    });
    fake.check.mockResolvedValue({ technical: false, issues: ["bad duration"], review: [], duration: 31 });
    const run = addRun("budget"); startAutoEdit(run, credentials); expect((await waitRun(run.id)).status).toBe("failed");
    expect(fake.render.mock.calls.length).toBeLessThanOrEqual(3); expect(readRun(run.id).compositionId).toBeNull();
  });
});
