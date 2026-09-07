// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const { db, where } = vi.hoisted(() => {
  const where = vi.fn();
  return { where, db: { select: () => ({ from: () => ({ where }) }), insert: vi.fn(), update: vi.fn() } };
});
vi.mock("@/lib/db", () => ({ getDb: () => db }));
import { POST } from "@/app/api/project/[id]/compose/route";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mora-compose-boundary-"));
  vi.stubEnv("APP_DATA_DIR", directory);
  await mkdir(join(directory, "uploads"));
  await writeFile(join(directory, "outside.png"), "private fixture");
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("compose route path boundary", () => {
  it.each(["product image", "asset"])("rejects traversal supplied as %s before creating a render", async (source) => {
    const ref = "/api/files/../outside.png";
    where.mockResolvedValueOnce([{ id: "project", productImages: source === "product image" ? [ref] : [] }]);
    where.mockResolvedValueOnce([{ selected: true, shots: [{ shotId: 1, duration: 3, type: "hook" }] }]);
    where.mockResolvedValueOnce(source === "asset" ? [{ shotId: 1, status: "done", filePath: ref }] : []);
    const request = new NextRequest("http://localhost/api/project/project/compose", { method: "POST", body: "{}" });
    const response = await POST(request, { params: Promise.resolve({ id: "project" }) });
    expect(response.status).toBe(400);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
