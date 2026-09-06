// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";
import { recoverRenders, renderOwner } from "@/lib/render-recovery";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let directory: string;
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/pipeline-runner", () => ({ isPipelineRunActive: () => false }));
vi.mock("@/lib/ssrf-guard", () => ({ safeFetch: async () => new Response("video"), readResponseBuffer: async () => Buffer.from("video") }));
vi.mock("@/lib/media-validate", () => ({ validateOrDelete: async () => true }));
vi.mock("@/lib/video-composer/frame-extract", () => ({ extractLastFrame: async () => undefined, extractFirstFrame: async () => undefined }));
const { compose, submit } = vi.hoisted(() => ({ compose: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/providers", () => ({ createProvider: () => ({ submitVideoTask: submit, waitForTask: vi.fn() }) }));
vi.mock("@/lib/video-composer/composer", async (original) => ({ ...await original<typeof import("@/lib/video-composer/composer")>(), composeVideo: compose, resolveChineseFontFamily: () => "sans-serif" }));
vi.mock("@/lib/edge-tts", () => ({ DEFAULT_FREE_VOICE: "fixture", generateSpeechFreeDetailed: async (text: string) => ({ audio: Buffer.from(text), words: [] }) }));
import { POST as composePost } from "@/app/api/project/[id]/compose/route";
import { POST as videoPost } from "@/app/api/ai/video/route";
import { GET } from "@/app/api/tasks/route";
import { persistRecoveredShotVideo } from "@/lib/generated-video-persistence";
import { recordAiTask, getAiTaskByProviderTaskId } from "@/lib/ai-tasks";

beforeEach(async () => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  db.insert(schema.projects).values({ id: "p", name: "fixture", status: "composing" }).run();
  directory = await mkdtemp(join(tmpdir(), "mora-recovery-"));
  vi.stubEnv("APP_DATA_DIR", directory);
});
afterEach(async () => { sqlite.close(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("recovery with migrated SQLite", () => {
  it("snapshots the first frame before submission and persists it with the paid task", async () => {
    const imageUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    submit.mockImplementation(async (options) => {
      expect(options.firstFrameUrl).toBe(imageUrl);
      return { taskId: "submitted", modelId: "fixture" };
    });
    const response = await videoPost(new NextRequest("http://localhost/api/ai/video", { method: "POST", body: JSON.stringify({ provider: "fixture", model: "fixture", apiKey: "fixture", imageUrl, projectId: "p", shotId: 1, background: true }) }));
    expect(response.status).toBe(202);
    const task = await getAiTaskByProviderTaskId("fixture", "submitted");
    expect(task.keyframePath).toMatch(/^\/api\/files\/p\/derived\/keyframe-/);
    const saved = await readFile(join(directory, "uploads", task.keyframePath!.slice("/api/files/".length)));
    expect(saved.toString("base64")).toBe(imageUrl.split(",")[1]);
  });
  it("isolates two simultaneous renders' narration and cleans both workspaces after success/failure", async () => {
    await mkdir(join(directory, "uploads", "p"), { recursive: true });
    await writeFile(join(directory, "uploads", "p", "image.png"), "fixture");
    db.insert(schema.assets).values({ projectId: "p", shotId: 1, type: "ai_generated", filePath: "/api/files/p/image.png", status: "done" }).run();
    db.insert(schema.scripts).values({ projectId: "p", styleType: "story", selected: true, shots: [{ shotId: 1, type: "hook", duration: 3, voiceover: "original", description: "fixture", camera: "static", visualSource: "product_image", transition: "direct_concat" }] }).run();
    const pending: Array<{ audio: string; resolve: (path: string) => void; reject: (error: Error) => void }> = [];
    compose.mockImplementation((config) => new Promise((resolve, reject) => pending.push({ audio: config.clips[0].audioPath, resolve, reject })));
    const submit = (text: string) => composePost(new NextRequest("http://localhost/api/project/p/compose", { method: "POST", body: JSON.stringify({ freeTts: { enabled: true }, voiceoverOverrides: [{ shotId: 1, voiceover: text }] }) }), { params: Promise.resolve({ id: "p" }) });
    const responses = await Promise.all([submit("first"), submit("second")]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    await vi.waitFor(() => expect(pending).toHaveLength(2), { timeout: 10000 });
    expect(pending[0].audio).not.toBe(pending[1].audio);
    expect((await Promise.all(pending.map((p) => readFile(p.audio, "utf8")))).sort()).toEqual(["first", "second"]);
    pending[0].resolve(join(directory, "output.mp4"));
    pending[1].reject(new Error("fixture renderer failure"));
    await vi.waitFor(() => expect(db.select().from(schema.compositions).all().map((c) => c.status).sort()).toEqual(["done", "failed"]));
    await vi.waitFor(async () => {
      for (const p of pending) await expect(access(p.audio)).rejects.toThrow();
    });
  });
  it("recovers a just-submitted dead process and legacy rows without failing live long renders", () => {
    const now = Math.floor(Date.now() / 1000);
    db.insert(schema.compositions).values([
      { id: "dead", projectId: "p", status: "composing", renderOwner: "999999:dead", renderHeartbeat: now },
      { id: "legacy", projectId: "p", status: "pending", renderOwner: null, renderHeartbeat: null },
      { id: "live", projectId: "p", status: "composing", renderOwner, renderHeartbeat: now, createdAt: new Date(0) },
    ]).run();
    expect(recoverRenders(sqlite, now, (pid) => pid === process.pid)).toBe(2);
    expect(sqlite.prepare("SELECT status FROM compositions WHERE id = 'live'").get()).toEqual({ status: "composing" });
    expect(sqlite.prepare("SELECT status FROM projects WHERE id = 'p'").get()).toEqual({ status: "composing" });
    expect(recoverRenders(sqlite, now + 61, () => true)).toBe(1);
    expect(sqlite.prepare("SELECT status FROM projects WHERE id = 'p'").get()).toEqual({ status: "video" });
  });
  it("keeps interruption attention across refreshes, clears it when a newer run exists (same-second timestamps)", async () => {
    const createdAt = new Date();
    db.insert(schema.pipelineRuns).values({ id: "old", projectId: "p", status: "running", stage: "compose", createdAt }).run();
    expect((await (await GET()).json()).attention.map((x: { id: string }) => x.id)).toEqual(["old"]);
    expect((await (await GET()).json()).attention.map((x: { id: string }) => x.id)).toEqual(["old"]);
    db.insert(schema.pipelineRuns).values({ id: "new", projectId: "p", status: "done", stage: "compose", createdAt }).run();
    expect((await (await GET()).json()).attention).toEqual([]);
  });
  it.each([true, false])("retains keyframe after recovered video persistence (snapshot=%s)", async (snapshot) => {
    db.insert(schema.assets).values({ projectId: "p", shotId: 1, type: "ai_generated", filePath: "/api/files/p/newer.png", status: "done" }).run();
    await recordAiTask({ projectId: "p", shotId: 1, provider: "test", model: "m", taskId: "t", ...(snapshot ? { keyframePath: "/api/files/p/original.png" } : {}) });
    const task = await getAiTaskByProviderTaskId("test", "t");
    await persistRecoveredShotVideo({ projectId: "p", shotId: 1, provider: "test", model: "m", apiKey: "", videoUrl: "https://fixture.invalid/video.mp4", keyframePath: task.keyframePath });
    const rows = db.select().from(schema.assets).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].filePath).toMatch(/\.mp4$/);
    expect(rows[0].thumbnailPath).toBe(snapshot ? "/api/files/p/original.png" : "/api/files/p/newer.png");
  });
});
