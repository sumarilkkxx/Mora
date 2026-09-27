import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStateRepository } from "@/lib/local-state-repository";
import * as schema from "@/lib/db/schema";
import { getMigrationsDir } from "@/lib/paths";

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder: getMigrationsDir() });
});

afterEach(() => sqlite.close());

function repository() {
  return new LocalStateRepository(drizzle(sqlite, { schema }));
}

const snapshot = {
  products: [{ id: "p1", name: "Serum", category: "beauty" as const, images: ["/serum.png"], videoCount: 2, createdAt: new Date("2026-01-01") }],
  templates: [{ id: "t1", name: "Hook", shots: [], useCount: 1, createdAt: new Date("2026-01-02") }],
  characters: [{ id: "c1", name: "Mia", appearance: "short hair", referenceImages: [], isDefault: true }],
  brand: { id: "b1", name: "Studio", primaryColor: "#111111", secondaryColor: "#eeeeee", fontFamily: "Inter", watermark: { enabled: false, position: "bottom-right" as const, opacity: 0.3, scale: 0.15 }, introEnabled: false, outroEnabled: true, outroText: "Follow us" },
  settings: { locale: "zh-CN", defaultResolution: "720p" },
};

describe("LocalStateRepository", () => {
  it("migrates a browser snapshot atomically and idempotently", () => {
    const repo = repository();
    expect(repo.migrateBrowserState(snapshot).migrated).toBe(true);
    expect(repo.migrateBrowserState({ ...snapshot, products: [...snapshot.products, { ...snapshot.products[0], id: "p2" }] }).migrated).toBe(false);

    const loaded = repo.read();
    expect(loaded.products.map((item) => item.id)).toEqual(["p1"]);
    expect(loaded.templates.map((item) => item.id)).toEqual(["t1"]);
    expect(loaded.characters.map((item) => item.id)).toEqual(["c1"]);
    expect(loaded.brand?.outroText).toBe("Follow us");
    expect(loaded.settings).toEqual({ ...snapshot.settings, locale: "zh" });
  });

  it("never writes credential-shaped settings", () => {
    const repo = repository();
    expect(() => repo.migrateBrowserState({ ...snapshot, settings: { apiKey: "must-not-land" } })).toThrow(/credential/i);
    expect(repo.read().products).toEqual([]);
    expect(sqlite.prepare("select value from settings").all().join("")).not.toContain("must-not-land");
  });

  it("rolls the whole migration back when a later table write fails", () => {
    const repo = repository();
    const invalid = { ...snapshot, brand: { ...snapshot.brand, name: null } } as unknown as typeof snapshot;
    expect(() => repo.migrateBrowserState(invalid)).toThrow();
    expect(repo.read().products).toEqual([]);
    expect(repo.read().templates).toEqual([]);
  });

  it("preserves existing SQLite rows when upgrading from browser storage", () => {
    sqlite.prepare("insert into products (id, name, category, images, video_count) values (?, ?, ?, ?, ?)")
      .run("p1", "Database authority", "beauty", "[]", 7);
    const repo = repository();
    repo.migrateBrowserState(snapshot);
    const loaded = repo.read();
    expect(loaded.products).toHaveLength(1);
    expect(loaded.products[0]).toMatchObject({ id: "p1", name: "Database authority", videoCount: 7 });
  });
});
