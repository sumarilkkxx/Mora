// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/lib/db", () => ({ getDb: () => db }));
import { GET } from "@/app/api/project/route";

beforeEach(() => {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
});
afterEach(() => sqlite.close());

it("keeps completed posters in trash without adding deleted projects to the active list", async () => {
  db.insert(schema.projects).values([
    { id: "trash", name: "Deleted edit", deletedAt: new Date() },
    { id: "active", name: "Draft", productImages: ["/product.jpg"] },
  ]).run();
  db.insert(schema.compositions).values([
    { id: "old", projectId: "trash", status: "done", thumbnailPath: "/output/trash/old.jpg", createdAt: new Date(1000) },
    { id: "latest", projectId: "trash", status: "done", thumbnailPath: "D:\\output\\trash\\final cover.jpg", createdAt: new Date(2000) },
    { id: "pending", projectId: "trash", status: "pending", createdAt: new Date(3000) },
    { id: "failed", projectId: "trash", status: "failed", thumbnailPath: "/output/trash/failed.jpg", createdAt: new Date(4000) },
  ]).run();

  const trash = await (await GET(new NextRequest("http://localhost/api/project?trash=1"))).json();
  expect(trash).toHaveLength(1);
  expect(trash[0]).toMatchObject({ id: "trash", thumbnailUrl: "/api/output/trash/final%20cover.jpg" });

  const active = await (await GET(new NextRequest("http://localhost/api/project"))).json();
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ id: "active", thumbnailUrl: null, productImages: ["/product.jpg"] });
});
