import { NextResponse } from "next/server";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { aiTasks, autoEditRuns, batchJobItems, batchJobs, compositions, projects } from "@/lib/db/schema";
import { recoverAutoEdits } from "@/lib/auto-edit/runner";
import { ACTIVE_AI_TASK_STATUSES } from "@/lib/ai-tasks";
import { userVisibleProjects } from "@/lib/project-visibility";
import { OperationRunRepository, operationOwner } from "@/lib/operation-run";
import { operationBucket, readOperationModel, syncLegacyOperationRuns } from "@/lib/operation-read-model";

/**
 * GET /api/tasks — the global task center feed: everything currently running (or
 * needing attention) across ALL projects, in one place. Until now "is my video
 * still rendering? did a paid task get stuck?" had no answer without opening each
 * project one by one — the unknown-status paid tasks were the worst case: money
 * already spent, recovery UI buried inside a single project's assets page.
 *
 * Buckets:
 * - active:    server pipelines, renders in flight, live paid tasks, a running batch
 * - attention: paid tasks that lost contact (already billed!), interrupted pipelines
 * - recent:    successful renders from the last 24h
 */
export async function GET() {
  try {
    const db = getDb();
    const projectName = new Map<string, string>();
    for (const p of await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(isNull(projects.deletedAt), userVisibleProjects()))) {
      projectName.set(p.id, p.name);
    }
    const activeProjectIds = new Set(projectName.keys());

    const active: Array<Record<string, unknown>> = [];
    const attention: Array<Record<string, unknown>> = [];
    await recoverAutoEdits();
    const edits = await db.select().from(autoEditRuns).where(inArray(autoEditRuns.status, ["queued", "running", "cancel_requested", "failed", "interrupted", "waiting_input", "needs_review"])).orderBy(desc(autoEditRuns.createdAt)).limit(100);
    for (const edit of edits) {
      if (!activeProjectIds.has(edit.projectId)) continue;
      (operationBucket(edit.status) === "active" ? active : attention).push({ kind: "auto_edit", id: edit.id, projectId: edit.projectId, projectName: projectName.get(edit.projectId), stage: edit.stage, status: edit.status, label: edit.checkpoint.plan?.title, createdAt: new Date(edit.createdAt).toISOString() });
    }

    // Batch, pipeline and compose share one lifecycle read model. Older databases are
    // imported once, then expired leases become durable, actionable interruptions.
    syncLegacyOperationRuns(db);
    new OperationRunRepository(db, { owner: operationOwner }).recoverExpired();
    const operationModel = readOperationModel(db);
    const operationRows = operationModel.all;
    const seenProjects = new Set<string>();
    const pipelineComposeIds = new Set<string>();
    for (const run of operationRows) {
      if (run.kind === "pipeline") {
        if (!activeProjectIds.has(run.subjectId) || seenProjects.has(run.subjectId)) continue;
        seenProjects.add(run.subjectId);
        const compositionId = typeof run.checkpoint?.compositionId === "string" ? run.checkpoint.compositionId : undefined;
        if (compositionId) pipelineComposeIds.add(compositionId);
        const bucket = operationBucket(run.status);
        if (bucket === "done") continue;
        const entry = {
          kind: bucket === "active" ? "pipeline" : "pipeline_interrupted",
          id: run.id,
          projectId: run.subjectId,
          projectName: projectName.get(run.subjectId) ?? "",
          stage: run.stage,
          status: run.status,
          error: run.error,
          createdAt: run.createdAt,
        };
        (bucket === "active" ? active : attention).push(entry);
      }
    }

    for (const run of operationRows) {
      if (run.kind !== "compose" || !activeProjectIds.has(run.subjectId) || pipelineComposeIds.has(run.id)) continue;
      const bucket = operationBucket(run.status);
      if (bucket === "done") continue;
      const composition = await db.select().from(compositions).where(eq(compositions.id, run.id)).get();
      const entry = {
        kind: bucket === "active" ? "compose" : "compose_interrupted",
        id: run.id,
        projectId: run.subjectId,
        projectName: projectName.get(run.subjectId) ?? "",
        label: composition?.label,
        stage: run.stage,
        status: run.status,
        error: run.error,
        createdAt: run.createdAt,
      };
      (bucket === "active" ? active : attention).push(entry);
    }

    // paid cloud tasks: live ones are informational; unknown = already billed, contact lost —
    // the row links straight to the project's recovery UI
    const paid = await db.select().from(aiTasks).where(inArray(aiTasks.status, ACTIVE_AI_TASK_STATUSES));
    for (const tsk of paid) {
      if (tsk.projectId && !activeProjectIds.has(tsk.projectId)) continue;
      (tsk.status === "unknown" ? attention : active).push({
        kind: tsk.status === "unknown" ? "paid_unknown" : "paid",
        id: tsk.id,
        projectId: tsk.projectId,
        projectName: tsk.projectId ? projectName.get(tsk.projectId) ?? "" : "",
        provider: tsk.provider,
        taskId: tsk.taskId,
        model: tsk.model,
        mediaType: tsk.mediaType,
        status: tsk.status,
        createdAt: tsk.createdAt,
      });
    }

    // latest batch, enriched with the domain table's per-item progress counts
    const batchRun = operationRows.find((run) => run.kind === "batch" && !["done", "cancelled"].includes(run.status));
    const job = batchRun ? await db.select().from(batchJobs).where(eq(batchJobs.id, batchRun.subjectId)).get() : undefined;
    if (job && batchRun) {
      const items = await db.select().from(batchJobItems).where(eq(batchJobItems.jobId, job.id));
      const bucket = operationBucket(batchRun.status);
      const entry = {
        kind: bucket === "active" ? "batch" : "batch_interrupted",
        id: job.id,
        status: batchRun.status,
        error: batchRun.error,
        total: job.total,
        done: items.filter((i) => i.status === "done").length,
        failed: items.filter((i) => i.status === "failed").length,
        createdAt: batchRun.createdAt,
      };
      (bucket === "active" ? active : attention).push(entry);
    }

    // recent wins: successful renders from the last 24h
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const recentRows = await db
      .select()
      .from(compositions)
      .where(and(eq(compositions.status, "done"), gt(compositions.completedAt, dayAgo)))
      .orderBy(desc(compositions.completedAt))
      .limit(8);
    const completedOperationIds = new Set(operationModel.done.filter(run => run.kind === "compose" && run.status === "done").map(run => run.id));
    const recent = recentRows.filter((c) => activeProjectIds.has(c.projectId) && completedOperationIds.has(c.id)).map((c) => ({
      kind: "done",
      id: c.id,
      projectId: c.projectId,
      projectName: projectName.get(c.projectId) ?? "",
      label: c.label,
      createdAt: c.createdAt,
      completedAt: c.completedAt,
    }));

    return NextResponse.json({ active, attention, recent });
  } catch (error) {
    console.error("获取任务中心数据失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取任务中心数据失败" },
      { status: 500 }
    );
  }
}
