// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

let sqlite: Database.Database;
let root: string;

vi.mock("@/lib/db", () => ({
  getSqlite: () => sqlite,
}));

import { GET as exportProjectPackage } from "@/app/api/project/[id]/package/route";
import { POST as importProjectPackage } from "@/app/api/project/package/route";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mora-package-route-"));
  vi.stubEnv("APP_DATA_DIR", root);
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: join(process.cwd(), "drizzle") });
  sqlite.prepare("insert into projects (id, name, product_images, media_insights, version_snapshots, is_evaluation) values (?, ?, ?, ?, ?, ?)")
    .run("route-project", "Route project", "[]", "[]", "[]", 0);
  await mkdir(join(root, "uploads", "route-project"), { recursive: true });
  await writeFile(join(root, "uploads", "route-project", "source.txt"), "route-media");
});

afterEach(async () => {
  sqlite.close();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("project package routes", () => {
  it("estimates, downloads, deletes and imports a project through public HTTP routes", async () => {
    const estimateResponse = await exportProjectPackage(
      new NextRequest("http://localhost/api/project/route-project/package?estimate=1"),
      { params: Promise.resolve({ id: "route-project" }) },
    );
    expect(estimateResponse.status).toBe(200);
    await expect(estimateResponse.json()).resolves.toMatchObject({ projectId: "route-project", fileCount: 1, sourceBytes: 11 });

    const downloadResponse = await exportProjectPackage(
      new NextRequest("http://localhost/api/project/route-project/package"),
      { params: Promise.resolve({ id: "route-project" }) },
    );
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toBe("application/vnd.mora.project+zip");
    expect(downloadResponse.headers.get("content-disposition")).toContain(".mora");
    const packageBytes = Buffer.from(await downloadResponse.arrayBuffer());
    expect(packageBytes.byteLength).toBe(Number(downloadResponse.headers.get("content-length")));

    sqlite.prepare("delete from projects where id = ?").run("route-project");
    await rm(join(root, "uploads", "route-project"), { recursive: true, force: true });
    const importResponse = await importProjectPackage(new NextRequest("http://localhost/api/project/package", {
      method: "POST",
      headers: { "content-type": "application/vnd.mora.project+zip", "content-length": String(packageBytes.byteLength) },
      body: packageBytes,
    }));
    expect(importResponse.status).toBe(201);
    await expect(importResponse.json()).resolves.toMatchObject({ projectId: "route-project", conflictResolved: false, importedFiles: 1 });
    expect(sqlite.prepare("select name from projects where id = ?").get("route-project")).toEqual({ name: "Route project" });
    await expect(readFile(join(root, "uploads", "route-project", "source.txt"), "utf8")).resolves.toBe("route-media");
  });
});
