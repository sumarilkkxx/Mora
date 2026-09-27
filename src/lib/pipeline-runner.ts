/**
 * Server-side executor for the free hands-off chain (judge → stock-fill → compose).
 *
 * Until now this chain was a string of browser fetches inside the script page —
 * closing the tab killed the run halfway with only the final compose surviving
 * server-side. The runner moves orchestration into the server process and keeps a
 * persistent pipeline_runs record, so the page degrades to an observer: it can
 * re-attach after a refresh, and a failed/interrupted run resumes from its
 * recorded stage.
 *
 * Stage semantics mirror the page chain exactly (quality bar unchanged):
 * - judge: best-effort quality pass, tier-gated auto-apply (invariant/default only);
 *   missing LLM config or a failed pass skips silently.
 * - stock_fill: best-effort free footage matching; failure is non-fatal.
 * - compose: the only fatal stage — free Edge TTS render, polled to completion.
 *
 * Stages are re-invoked through the existing HTTP routes (self-fetch against this
 * server's own origin) instead of duplicating their internals — identical behavior,
 * one implementation.
 */

import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { internalApiHeaders } from "@/lib/internal-api";
import { getDb } from "@/lib/db";
import { compositions, pipelineRuns } from "@/lib/db/schema";
import {
  autoApplicableRewrites,
  autoApplicableDescriptionRewrites,
  type JudgeReport,
} from "@/lib/script-judge";
import { stagesFrom, type PipelineStage } from "@/lib/pipeline-stages";
import { OperationRunRepository, operationOwner } from "@/lib/operation-run";

export interface PipelineLlmConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface StartPipelineInput {
  projectId: string;
  /** script variant to lock in as selected before the chain runs */
  scriptId?: string;
  /** this server's own origin (from the incoming request) — target of stage self-fetches */
  origin: string;
  /** optional LLM config: enables the judge pass + semantic footage rerank */
  llmConfig?: PipelineLlmConfig;
  /** resume breakpoint; defaults to the full chain */
  fromStage?: PipelineStage;
  requestKey?: string;
}

const operations = () => new OperationRunRepository(getDb(), { owner: operationOwner });

export function isPipelineRunActive(runId: string): boolean {
  const run = operations().read(runId);
  return run?.status === "running" && run.owner === operationOwner && (run.leaseUntil ?? 0) > Date.now();
}

/** Compose polling budget: 2.5s × 288 ≈ 12 min, above the server render timeout. */
const COMPOSE_POLL_INTERVAL_MS = 2500;
const COMPOSE_POLL_MAX = 288;

async function setRun(runId: string, patch: Partial<typeof pipelineRuns.$inferInsert>): Promise<void> {
  const db = getDb();
  const operation = operations();
  const current = operation.read(runId);
  if (!operation.checkpoint(runId, { ...(current?.checkpoint ?? {}), ...(patch.compositionId ? { compositionId: patch.compositionId } : {}) }, patch.stage ?? current?.stage ?? "running")) {
    throw new Error("Operation lease lost");
  }
  await db.update(pipelineRuns).set({ ...patch, updatedAt: new Date() }).where(eq(pipelineRuns.id, runId));
}

/** Judge stage: run the panel and auto-apply tier-gated rewrites. Best-effort by contract. */
async function runJudgeStage(input: StartPipelineInput): Promise<void> {
  if (!input.llmConfig?.baseUrl || !input.llmConfig.model || !input.scriptId) return;
  try {
    const res = await fetch(`${input.origin}/api/project/${input.projectId}/script-judge`, {
      method: "POST",
      headers: internalApiHeaders(input.origin),
      body: JSON.stringify({ scriptId: input.scriptId, llmConfig: input.llmConfig }),
    });
    if (!res.ok) return;
    const report = (await res.json()) as JudgeReport;
    const patchByShot = new Map<number, { shotId: number; voiceover?: string; description?: string }>();
    for (const r of autoApplicableRewrites(report)) patchByShot.set(r.shotId, { shotId: r.shotId, voiceover: r.voiceover });
    for (const r of autoApplicableDescriptionRewrites(report)) {
      patchByShot.set(r.shotId, { ...(patchByShot.get(r.shotId) ?? { shotId: r.shotId }), description: r.description });
    }
    if (patchByShot.size === 0) return;
    await fetch(`${input.origin}/api/project/${input.projectId}/scripts`, {
      method: "PATCH",
      headers: internalApiHeaders(input.origin),
      body: JSON.stringify({ scriptId: input.scriptId, shotTexts: Array.from(patchByShot.values()) }),
    });
  } catch {
    /* quality is best-effort — never a new failure mode for the chain */
  }
}

/** Stock-fill stage: free footage matching, optional semantic rerank. Non-fatal. */
async function runStockFillStage(input: StartPipelineInput): Promise<void> {
  try {
    await fetch(`${input.origin}/api/project/${input.projectId}/stock-fill`, {
      method: "POST",
      headers: internalApiHeaders(input.origin),
      body: JSON.stringify({
        source: "all",
        mediaType: "auto",
        ...(input.llmConfig?.baseUrl && input.llmConfig.model ? { llmConfig: input.llmConfig } : {}),
      }),
    });
  } catch {
    /* non-fatal: product images/assets may already cover the shots */
  }
}

/** Compose stage: free Edge TTS render, polled to a terminal status. The only fatal stage. */
async function runComposeStage(input: StartPipelineInput, runId: string): Promise<void> {
  const res = await fetch(`${input.origin}/api/project/${input.projectId}/compose`, {
    method: "POST",
    headers: internalApiHeaders(input.origin),
    body: JSON.stringify({ freeTts: { enabled: true }, requestId: `pipeline:${runId}` }),
  });
  const data = (await res.json().catch(() => ({}))) as { compositionId?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "合成启动失败 / compose failed to start");
  const compositionId = data.compositionId;
  if (compositionId) await setRun(runId, { compositionId });

  const db = getDb();
  for (let i = 0; i < COMPOSE_POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, COMPOSE_POLL_INTERVAL_MS));
    if (operations().cancellationRequested(runId)) throw new Error("Operation cancelled");
    if (!operations().heartbeat(runId)) throw new Error("Operation lease lost");
    const rows = compositionId
      ? await db.select().from(compositions).where(eq(compositions.id, compositionId)).limit(1)
      : [];
    const st = rows[0]?.status;
    if (st === "done") return;
    if (st === "failed") throw new Error("视频合成失败 / video composition failed");
  }
  throw new Error("合成超时 / composition timed out");
}

/**
 * Insert a run row and execute the chain in the background. Returns the run id
 * immediately (the route responds 202; pages poll GET for progress).
 */
export async function startPipelineRun(input: StartPipelineInput): Promise<string> {
  const db = getDb();
  const stages = stagesFrom(input.fromStage);
  const runId = randomUUID();
  const operation = operations();
  const created = operation.create({
    id: runId, kind: "pipeline", subjectId: input.projectId,
    requestKey: input.requestKey ?? `pipeline:${input.projectId}:${runId}`,
    stage: stages[0], checkpoint: { completed: [] },
  });
  if (!created.created) return created.run.id;
  let run: typeof pipelineRuns.$inferSelect;
  try {
    run = db
      .insert(pipelineRuns)
      .values({ id: runId, projectId: input.projectId, scriptId: input.scriptId ?? null, stage: stages[0], status: "running" })
      .returning().get();
  } catch (error) {
    operation.requestCancel(runId);
    throw error;
  }
  if (!operation.claim(run.id)) {
    operation.requestCancel(run.id);
    await db.update(pipelineRuns).set({ status: "failed", error: "Operation claim failed", updatedAt: new Date() }).where(eq(pipelineRuns.id, run.id));
    throw new Error("Pipeline operation could not be claimed");
  }

  void (async () => {
    const heartbeat = setInterval(() => operation.heartbeat(run.id), 10_000);
    heartbeat.unref();
    try {
      // lock in the chosen variant so every stage (and compose) uses it
      if (input.scriptId) {
        await fetch(`${input.origin}/api/project/${input.projectId}/scripts`, {
          method: "PATCH",
          headers: internalApiHeaders(input.origin),
          body: JSON.stringify({ selectedScriptId: input.scriptId }),
        }).catch(() => {});
      }
      for (const stage of stages) {
        if (operation.cancellationRequested(run.id)) throw new Error("Operation cancelled");
        await setRun(run.id, { stage });
        if (stage === "judge") await runJudgeStage(input);
        else if (stage === "stock_fill") await runStockFillStage(input);
        else await runComposeStage(input, run.id);
        const next = stages[stages.indexOf(stage) + 1];
        if (next) await setRun(run.id, { stage: next });
      }
      if (!operation.finish(run.id, "done", { compositionId: operation.read(run.id)?.checkpoint?.compositionId })) throw new Error("Operation lease lost before publish");
      await db.update(pipelineRuns).set({ status: "done", updatedAt: new Date() }).where(eq(pipelineRuns.id, run.id));
    } catch (e) {
      console.error(`[pipeline] 运行失败 run=${run.id}:`, e);
      const cancelled = operation.cancellationRequested(run.id);
      const error = e instanceof Error ? e.message : String(e);
      if (operation.finish(run.id, cancelled ? "cancelled" : "failed", undefined, error)) {
        await db.update(pipelineRuns).set({ status: cancelled ? "cancelled" : "failed", error, updatedAt: new Date() }).where(eq(pipelineRuns.id, run.id)).catch(() => {});
      }
    } finally {
      clearInterval(heartbeat);
    }
  })();

  return run.id;
}
