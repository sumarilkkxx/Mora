import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { DEFAULT_GUIDED_EDIT_BRIEF, createGuidedEditPlan } from "@/lib/guided-edit";
import { saveGuidedEditPlan } from "@/lib/guided-edit-plan-repository";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

const document = () => createGuidedEditPlan({
  brief: { ...DEFAULT_GUIDED_EDIT_BRIEF, audioMode: "muted" },
  scenes: [{ id: "scene-1", start: 0, end: 3, label: "highlight", selected: true }],
  sourceId: "source",
  sourceDuration: 3,
  existingBeats: [{ id: "beat-1", role: "hook", text: "文案", estimatedDuration: 2, sceneIds: ["scene-1"] }],
});

beforeEach(() => {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  db.insert(schema.projects).values({ id: "project", name: "fixture" }).run();
  db.insert(schema.mediaSources).values({
    id: "source", projectId: "project", originalName: "source.mp4", filePath: "/tmp/source.mp4", mimeType: "video/mp4", duration: 3_000,
  }).run();
});

afterEach(() => sqlite.close());

describe("guided edit plan repository", () => {
  it("creates a new draft revision instead of overwriting the last playable version", () => {
    db.insert(schema.compositions).values({ id: "composition-1", projectId: "project", status: "done", outputPath: "/tmp/playable.mp4" }).run();
    db.insert(schema.guidedEditPlans).values({
      id: "plan-1", projectId: "project", sourceId: "source", revision: 1, document: document(), compositionId: "composition-1", status: "done",
    }).run();

    const draft = saveGuidedEditPlan(db, {
      projectId: "project", sourceId: "source", planId: "plan-1", document: document(), intent: "draft",
    });

    expect(draft).toMatchObject({ revision: 2, status: "draft", compositionId: null });
    expect(db.select().from(schema.guidedEditPlans).all()).toHaveLength(2);
    expect(db.select().from(schema.guidedEditPlans).all().find((plan) => plan.id === "plan-1"))
      .toMatchObject({ status: "done", compositionId: "composition-1" });
  });

  it("applies the current draft in place without creating another history entry", () => {
    const draft = saveGuidedEditPlan(db, {
      projectId: "project", sourceId: "source", document: document(), intent: "draft",
    });
    const ready = saveGuidedEditPlan(db, {
      projectId: "project", sourceId: "source", planId: draft.id, document: document(), intent: "ready",
    });

    expect(ready).toMatchObject({ id: draft.id, revision: 1, status: "ready" });
    expect(db.select().from(schema.guidedEditPlans).all()).toHaveLength(1);
  });
});
