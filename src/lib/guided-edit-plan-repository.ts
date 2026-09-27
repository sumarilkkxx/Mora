import { and, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import type { GuidedEditPlanDocument } from "@/lib/guided-edit";

type Database = BetterSQLite3Database<typeof schema>;
export type GuidedEditSaveIntent = "draft" | "ready";

export function saveGuidedEditPlan(database: Database, input: {
  projectId: string;
  sourceId: string;
  planId?: string | null;
  document: GuidedEditPlanDocument;
  intent: GuidedEditSaveIntent;
}) {
  const now = new Date();
  const existing = input.planId
    ? database.select().from(schema.guidedEditPlans).where(and(
      eq(schema.guidedEditPlans.id, input.planId),
      eq(schema.guidedEditPlans.projectId, input.projectId),
    )).get()
    : undefined;
  if (input.planId && !existing) throw new Error("剪辑方案不存在");

  if (existing && ["draft", "ready", "failed"].includes(existing.status)) {
    return database.update(schema.guidedEditPlans).set({
      sourceId: input.sourceId,
      document: input.document,
      status: input.intent,
      compositionId: null,
      error: null,
      updatedAt: now,
    }).where(eq(schema.guidedEditPlans.id, existing.id)).returning().get();
  }

  const latest = database.select({ revision: schema.guidedEditPlans.revision })
    .from(schema.guidedEditPlans)
    .where(eq(schema.guidedEditPlans.projectId, input.projectId))
    .orderBy(desc(schema.guidedEditPlans.revision))
    .limit(1)
    .get();
  return database.insert(schema.guidedEditPlans).values({
    projectId: input.projectId,
    sourceId: input.sourceId,
    revision: (latest?.revision ?? 0) + 1,
    document: input.document,
    status: input.intent,
  }).returning().get();
}
