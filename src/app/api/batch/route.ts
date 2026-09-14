import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { batchJobItems, batchJobs } from "@/lib/db/schema";
import { apiError } from "@/lib/api-error";
import { batchBusy, batchOperationActive, claimBatch, releaseBatch, renewBatch } from "@/lib/batch-execution";

/**
 * Batch job persistence (batch_jobs / batch_job_items).
 *
 * The /batch executor still runs in the page, but every stage transition is
 * written through here, so progress and per-item project/composition back-links
 * survive a refresh or crash — and an unfinished job can offer "continue where
 * it left off, skipping the N items already done".
 *
 * POST  { config, items: [{ productId, productName, variation? }] } → { jobId, itemIds }
 * PATCH { jobId, owner, action: "claim" | "renew" | "release" }
 * PATCH { jobId, owner, status } | { itemId, owner, patch: { status?, projectId?, compositionId?, error? } }
 * GET   ?active=1 → latest running job + items; ?jobId=xxx → that job + items
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      config?: Record<string, unknown>;
      items?: Array<{ productId?: unknown; productName?: unknown; variation?: unknown }>;
    };
    const items = Array.isArray(body.items)
      ? body.items.filter((i) => typeof i?.productId === "string" && typeof i?.productName === "string")
      : [];
    if (items.length === 0) return apiError(req, "缺少批量条目", "Missing batch items");

    const db = getDb();
    const result = db.transaction(tx => {
      const running = tx.select().from(batchJobs).where(eq(batchJobs.status, "running")).all();
      if (running.some(job => (job.executionUntil ?? 0) > Date.now() || batchOperationActive(job.id))) return null;
      // one live job at a time: starting a new batch settles any stale running job
      tx.update(batchJobs).set({ status: "cancelled", updatedAt: new Date() }).where(eq(batchJobs.status, "running")).run();
      const job = tx
        .insert(batchJobs)
        .values({ status: "running", total: items.length, config: body.config ?? {} })
        .returning().get()!;
      const rows = tx
        .insert(batchJobItems)
        .values(
          items.map((i) => ({
            jobId: job.id,
            productId: i.productId as string,
            productName: i.productName as string,
            variation: typeof i.variation === "string" ? i.variation : null,
          }))
        )
        .returning({ id: batchJobItems.id, productId: batchJobItems.productId }).all();
      return { jobId: job.id, items: rows };
    });
    if (!result) return batchBusy();
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("创建批量任务失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建批量任务失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      jobId?: unknown;
      status?: unknown;
      itemId?: unknown;
      patch?: { status?: unknown; projectId?: unknown; compositionId?: unknown; error?: unknown };
      action?: unknown;
      owner?: unknown;
    };
    const db = getDb();
    const owner = typeof body.owner === "string" && body.owner.length <= 100 ? body.owner : "";
    if (!owner) return batchBusy();
    if (typeof body.jobId === "string" && body.action) {
      const ok = body.action === "claim" ? claimBatch(body.jobId, owner)
        : body.action === "renew" ? renewBatch(body.jobId, owner)
        : body.action === "release" ? releaseBatch(body.jobId, owner) : false;
      return ok ? NextResponse.json({ ok: true }) : batchBusy();
    }

    if (typeof body.itemId === "string") {
      const item = db.select().from(batchJobItems).where(eq(batchJobItems.id, body.itemId)).get();
      if (!item || !renewBatch(item.jobId, owner)) return batchBusy();
      const p = body.patch ?? {};
      const ITEM_STATUSES = ["pending", "generating", "composing", "done", "failed"];
      db
        .update(batchJobItems)
        .set({
          ...(typeof p.status === "string" && ITEM_STATUSES.includes(p.status)
            ? { status: p.status as "pending" | "generating" | "composing" | "done" | "failed" }
            : {}),
          ...(typeof p.projectId === "string" ? { projectId: p.projectId } : {}),
          ...(typeof p.compositionId === "string" ? { compositionId: p.compositionId } : {}),
          ...(typeof p.error === "string" ? { error: p.error.slice(0, 500) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(batchJobItems.id, body.itemId)).run();
      return NextResponse.json({ ok: true });
    }

    if (typeof body.jobId === "string" && typeof body.status === "string" && ["running", "done", "cancelled"].includes(body.status)) {
      if (batchOperationActive(body.jobId) || !renewBatch(body.jobId, owner)) return batchBusy();
      const items = db.select().from(batchJobItems).where(eq(batchJobItems.jobId, body.jobId)).all();
      if (body.status === "done" && items.some(item => item.status !== "done")) return apiError(req, "批次仍有未完成条目", "Batch has unfinished items", 409);
      db
        .update(batchJobs)
        .set({ status: body.status as "running" | "done" | "cancelled", updatedAt: new Date() })
        .where(eq(batchJobs.id, body.jobId)).run();
      return NextResponse.json({ ok: true });
    }

    return apiError(req, "无效的更新请求", "Invalid update request");
  } catch (error) {
    console.error("更新批量任务失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新批量任务失败" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const jobId = req.nextUrl.searchParams.get("jobId");
    const activeOnly = req.nextUrl.searchParams.get("active") === "1";

    const [job] = jobId
      ? await db.select().from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1)
      : activeOnly
        ? await db.select().from(batchJobs).where(eq(batchJobs.status, "running")).orderBy(desc(batchJobs.createdAt)).limit(1)
        : await db.select().from(batchJobs).orderBy(desc(batchJobs.createdAt)).limit(1);
    if (!job) return NextResponse.json({ job: null, items: [] });
    const items = await db.select().from(batchJobItems).where(eq(batchJobItems.jobId, job.id));
    return NextResponse.json({ job, items });
  } catch (error) {
    console.error("查询批量任务失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "查询批量任务失败" },
      { status: 500 }
    );
  }
}
