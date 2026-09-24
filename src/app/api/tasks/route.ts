import { NextResponse } from "next/server";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { aiTasks, autoEditRuns, batchJobItems, batchJobs, compositions, pipelineRuns, projects } from "@/lib/db/schema";
import { recoverAutoEdits } from "@/lib/auto-edit/runner";
import { isPipelineRunActive } from "@/lib/pipeline-runner";
import { ACTIVE_AI_TASK_STATUSES } from "@/lib/ai-tasks";
import { userVisibleProjects } from "@/lib/project-visibility";

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
      (["queued", "running", "cancel_requested"].includes(edit.status) ? active : attention).push({ kind: "auto_edit", id: edit.id, projectId: edit.projectId, projectName: projectName.get(edit.projectId), stage: edit.stage, status: edit.status, label: edit.checkpoint.plan?.title, createdAt: new Date(edit.createdAt).toISOString() });
    }

    // server-side pipelines: verify against the in-process registry; a "running" row whose
    // executor is gone (restart) is settled to failed and surfaced as resumable instead
    const runningPipelines = await db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt), desc(sql`${pipelineRuns}.rowid`));
    const seenProjects = new Set<string>();
    const pipelineComposeIds = new Set<string>();
    for (const run of runningPipelines) {
      if (!activeProjectIds.has(run.projectId)) continue;
      if (seenProjects.has(run.projectId)) continue;
      seenProjects.add(run.projectId);
      if (run.status !== "running" && !(run.status === "failed" && run.error === "interrupted")) continue;
      if (run.status === "running" && isPipelineRunActive(run.id)) {
        if (run.compositionId) pipelineComposeIds.add(run.compositionId);
        active.push({
          kind: "pipeline",
          id: run.id,
          projectId: run.projectId,
          projectName: projectName.get(run.projectId) ?? "",
          stage: run.stage,
          createdAt: run.createdAt,
        });
      } else {
        await db
          .update(pipelineRuns)
          .set({ status: "failed", error: "interrupted", updatedAt: new Date() })
          .where(and(eq(pipelineRuns.id, run.id), eq(pipelineRuns.status, "running")));
        attention.push({
          kind: "pipeline_interrupted",
          id: run.id,
          projectId: run.projectId,
          projectName: projectName.get(run.projectId) ?? "",
          stage: run.stage,
          createdAt: run.createdAt,
        });
      }
    }

    // renders in flight (skip ones already represented by their pipeline row)
    const composing = await db.select().from(compositions).where(eq(compositions.status, "composing"));
    for (const c of composing) {
      if (!activeProjectIds.has(c.projectId)) continue;
      if (pipelineComposeIds.has(c.id)) continue;
      active.push({
        kind: "compose",
        id: c.id,
        projectId: c.projectId,
        projectName: projectName.get(c.projectId) ?? "",
        label: c.label,
        createdAt: c.createdAt,
      });
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

    // a running batch job, with per-item progress counts
    const [job] = await db
      .select()
      .from(batchJobs)
      .where(eq(batchJobs.status, "running"))
      .orderBy(desc(batchJobs.createdAt))
      .limit(1);
    if (job) {
      const items = await db.select().from(batchJobItems).where(eq(batchJobItems.jobId, job.id));
      active.push({
        kind: "batch",
        id: job.id,
        total: job.total,
        done: items.filter((i) => i.status === "done").length,
        failed: items.filter((i) => i.status === "failed").length,
        createdAt: job.createdAt,
      });
    }

    // recent wins: successful renders from the last 24h
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const recentRows = await db
      .select()
      .from(compositions)
      .where(and(eq(compositions.status, "done"), gt(compositions.completedAt, dayAgo)))
      .orderBy(desc(compositions.completedAt))
      .limit(8);
    const recent = recentRows.filter((c) => activeProjectIds.has(c.projectId)).map((c) => ({
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
