import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "./db";
import { batchJobItems, batchJobs, compositions, scripts } from "./db/schema";

const LEASE_MS = 60_000;
const state = globalThis as typeof globalThis & { moraBatchOperations?: Map<string, string> };
const operations = state.moraBatchOperations ??= new Map<string, string>();
export const batchBusy = () => NextResponse.json({ error: "批次正在其他页面执行，或执行权已失效，请稍后恢复 / Batch is busy or execution expired" }, { status: 409 });
export const batchOperationActive = (jobId: string) => [...operations.values()].includes(jobId);

export function claimBatch(jobId: string, owner: string): boolean {
  if (batchOperationActive(jobId)) return false;
  return getDb().update(batchJobs).set({ executionOwner: owner, executionUntil: Date.now() + LEASE_MS })
    .where(and(eq(batchJobs.id, jobId), eq(batchJobs.status, "running"), or(isNull(batchJobs.executionOwner), lte(batchJobs.executionUntil, Date.now())))).run().changes > 0;
}

export function renewBatch(jobId: string, owner: string): boolean {
  return getDb().update(batchJobs).set({ executionUntil: Date.now() + LEASE_MS })
    .where(and(eq(batchJobs.id, jobId), eq(batchJobs.status, "running"), eq(batchJobs.executionOwner, owner), gt(batchJobs.executionUntil, Date.now()))).run().changes > 0;
}

export function releaseBatch(jobId: string, owner: string): boolean {
  if (batchOperationActive(jobId)) return false;
  return getDb().update(batchJobs).set({ executionOwner: null, executionUntil: null })
    .where(and(eq(batchJobs.id, jobId), eq(batchJobs.executionOwner, owner))).run().changes > 0;
}

/** Pin execution while a server request runs; save checkpoints before its response can be lost. */
export async function withBatchExecution(req: NextRequest, stage: "project" | "script" | "compose", execute: () => Promise<Response>): Promise<Response> {
  const itemId = req.headers.get("x-mora-batch-item");
  const owner = req.headers.get("x-mora-batch-owner");
  if (!itemId && !owner) return execute();
  if (!itemId || !owner) return batchBusy();
  const db = getDb();
  const item = db.select().from(batchJobItems).where(eq(batchJobItems.id, itemId)).get();
  if (!item || operations.has(itemId) || !renewBatch(item.jobId, owner)) return batchBusy();
  operations.set(itemId, item.jobId);
  const heartbeat = setInterval(() => {
    try { renewBatch(item.jobId, owner); } catch { /* Next request/checkpoint must revalidate ownership. */ }
  }, 10_000);
  heartbeat.unref();
  try {
    if (stage !== "project") {
      const projectId = stage === "script" ? (await req.clone().json()).projectId : req.nextUrl.pathname.split("/")[3];
      if (!item.projectId || projectId !== item.projectId) return batchBusy();
    }
    if (stage === "project" && item.projectId) return NextResponse.json({ id: item.projectId });
    if (stage === "script" && item.scriptId) {
      const saved = db.select().from(scripts).where(and(eq(scripts.id, item.scriptId), eq(scripts.projectId, item.projectId!))).get();
      if (saved) return NextResponse.json({ scripts: [saved] });
    }
    if (stage === "compose" && item.compositionId) {
      const saved = db.select().from(compositions).where(eq(compositions.id, item.compositionId)).get();
      if (saved && saved.status !== "failed") return NextResponse.json({ compositionId: saved.id });
    }
    const response = await execute();
    if (response.ok) {
      const result = await response.clone().json();
      // A process interruption never makes a late owner authoritative again.
      if (!renewBatch(item.jobId, owner)) return batchBusy();
      const patch = stage === "project" ? { projectId: result.id }
        : stage === "script" ? { scriptId: result.scripts?.[0]?.id }
        : { compositionId: result.compositionId };
      if (Object.values(patch).some(value => typeof value !== "string")) throw new Error("Batch checkpoint was not returned");
      db.update(batchJobItems).set({ ...patch, updatedAt: new Date() }).where(eq(batchJobItems.id, itemId)).run();
    }
    return response;
  } finally {
    clearInterval(heartbeat);
    operations.delete(itemId);
  }
}
