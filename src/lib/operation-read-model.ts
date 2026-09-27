import { desc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import type { OperationStatus } from "@/lib/operation-run";
import type { EditStatus } from "@/lib/auto-edit/contract";

type Database = BetterSQLite3Database<typeof schema>;

/**
 * Import pre-OperationRun lifecycle rows lazily. New writes always create the
 * envelope first; this compatibility pass makes an upgraded database visible
 * and recoverable without pretending that work from a previous process is live.
 */
export function syncLegacyOperationRuns(database: Database): number {
  let imported = 0;
  const guidedPlans = database.select({ compositionId: schema.guidedEditPlans.compositionId, status: schema.guidedEditPlans.status })
    .from(schema.guidedEditPlans).all();
  const guidedByComposition = new Map(guidedPlans.flatMap(plan => plan.compositionId ? [[plan.compositionId, plan.status] as const] : []));
  const managedCompositionIds = new Set([
    ...guidedPlans.map(plan => ({ id: plan.compositionId })),
    ...database.select({ id: schema.mediaEdits.compositionId }).from(schema.mediaEdits).all(),
  ].flatMap(row => row.id ? [row.id] : []));
  const insert = (values: typeof schema.operationRuns.$inferInsert): boolean => {
    const changes = database.insert(schema.operationRuns).values(values).onConflictDoNothing().run().changes;
    imported += changes;
    return changes > 0;
  };

  for (const run of database.select().from(schema.pipelineRuns).all()) {
    const status: OperationStatus = run.status === "running" ? "interrupted" : run.status;
    const wasImported = insert({
      id: run.id,
      kind: "pipeline",
      subjectId: run.projectId,
      requestKey: `pipeline:legacy:${run.id}`,
      status,
      stage: run.stage,
      checkpoint: run.compositionId ? { compositionId: run.compositionId } : undefined,
      result: run.status === "done" && run.compositionId ? { compositionId: run.compositionId } : undefined,
      error: run.status === "running" ? "interrupted" : run.error,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
    if (wasImported && status === "interrupted") {
      database.update(schema.pipelineRuns).set({ status: "failed", error: "interrupted", updatedAt: new Date() })
        .where(eq(schema.pipelineRuns.id, run.id)).run();
    }
  }

  for (const composition of database.select().from(schema.compositions).all()) {
    const adapterManaged = managedCompositionIds.has(composition.id);
    const guidedStatus = guidedByComposition.get(composition.id);
    const liveAdapter = adapterManaged && guidedStatus !== "cancelled" && composition.status === "composing" && Boolean(composition.renderOwner && composition.renderHeartbeat);
    const status: OperationStatus = guidedStatus === "cancelled" ? "cancelled"
      : composition.status === "pending" ? "queued"
      : composition.status === "composing" ? liveAdapter ? "running" : "interrupted"
      : composition.status;
    const requestKey = `compose:legacy:${composition.id}`;
    const existing = database.select().from(schema.operationRuns).where(eq(schema.operationRuns.id, composition.id)).get();
    if (existing?.requestKey === requestKey && adapterManaged) {
      database.update(schema.operationRuns).set({
        status,
        owner: liveAdapter ? composition.renderOwner : null,
        leaseUntil: liveAdapter ? composition.renderHeartbeat! * 1000 + 60_000 : null,
        result: composition.status === "done" ? { compositionId: composition.id, outputPath: composition.outputPath } : undefined,
        error: status === "interrupted" ? "interrupted" : null,
        updatedAt: composition.completedAt ?? new Date(),
      }).where(eq(schema.operationRuns.id, composition.id)).run();
      continue;
    }
    if (existing) continue;
    const wasImported = insert({
      id: composition.id,
      kind: "compose",
      subjectId: composition.projectId,
      requestKey,
      status,
      stage: "render",
      owner: liveAdapter ? composition.renderOwner : null,
      leaseUntil: liveAdapter ? composition.renderHeartbeat! * 1000 + 60_000 : null,
      result: composition.status === "done" ? { compositionId: composition.id, outputPath: composition.outputPath } : undefined,
      error: status === "interrupted" ? "interrupted" : undefined,
      createdAt: composition.createdAt,
      updatedAt: composition.completedAt ?? composition.createdAt,
    });
    if (wasImported && status === "interrupted") {
      database.update(schema.compositions).set({ status: "failed" }).where(eq(schema.compositions.id, composition.id)).run();
    }
  }

  for (const job of database.select().from(schema.batchJobs).all()) {
    const status: OperationStatus = job.status === "running" ? "interrupted" : job.status;
    const wasImported = insert({
      id: job.id,
      kind: "batch",
      subjectId: job.id,
      requestKey: `batch:legacy:${job.id}`,
      status,
      stage: "batch",
      error: job.status === "running" ? "interrupted" : undefined,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
    if (wasImported && status === "interrupted") {
      database.update(schema.batchJobs).set({ executionOwner: null, executionUntil: null }).where(eq(schema.batchJobs.id, job.id)).run();
    }
  }
  return imported;
}

export type OperationBucket = "active" | "attention" | "failed" | "done";

/** Auto-edit keeps its proven runner, but shares this lifecycle classification adapter. */
export function operationBucket(status: OperationStatus | EditStatus): OperationBucket {
  if (["queued", "running", "cancel_requested"].includes(status)) return "active";
  if (["waiting_input", "needs_review", "interrupted"].includes(status)) return "attention";
  if (status === "failed") return "failed";
  return "done";
}

/** Latest first, with SQLite rowid as the stable tie-breaker for old second-resolution rows. */
export function readOperationRuns(database: Database) {
  return database.select().from(schema.operationRuns)
    .orderBy(desc(schema.operationRuns.createdAt), desc(sql`${schema.operationRuns}.rowid`))
    .all();
}

export function readOperationModel(database: Database) {
  const all = readOperationRuns(database);
  return {
    all,
    active: all.filter(run => operationBucket(run.status) === "active"),
    attention: all.filter(run => operationBucket(run.status) === "attention"),
    failed: all.filter(run => operationBucket(run.status) === "failed"),
    done: all.filter(run => operationBucket(run.status) === "done"),
  };
}
