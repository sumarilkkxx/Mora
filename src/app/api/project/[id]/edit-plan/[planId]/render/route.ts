import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { compositions, guidedEditPlans, mediaSources, projects } from "@/lib/db/schema";
import { startGuidedEditRender } from "@/lib/guided-edit-render-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

class RenderStartError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> },
) {
  const { id, planId } = await params;
  if (!SAFE_ID.test(id) || !SAFE_ID.test(planId)) return apiError(req, "无效的剪辑方案ID", "Invalid edit plan ID", 400);
  try {
    const db = getDb();
    // better-sqlite3 transactions are synchronous and serialize the read/check/write sequence.
    // This makes task creation an atomic claim: two simultaneous POSTs can no longer both see
    // a ready plan and create competing compositions.
    const { plan, source, composition } = db.transaction((tx) => {
      const plan = tx.select().from(guidedEditPlans)
        .where(and(eq(guidedEditPlans.id, planId), eq(guidedEditPlans.projectId, id))).limit(1).get();
      if (!plan) throw new RenderStartError("剪辑方案不存在", 404);
      if (plan.status === "rendering") throw new RenderStartError("当前方案正在渲染", 409);
      const source = tx.select().from(mediaSources)
        .where(and(eq(mediaSources.id, plan.sourceId), eq(mediaSources.projectId, id))).limit(1).get();
      if (!source) throw new RenderStartError("原始素材不存在", 404);
      if (!plan.document.timeline.length || plan.document.outputDuration < 0.5) {
        throw new RenderStartError("剪辑方案没有有效时间线", 422);
      }
      const composition = tx.insert(compositions).values({
        projectId: id,
        videoOrigin: "local_render",
        resolution: "1080p",
        aspectRatio: plan.document.brief.aspectRatio,
        duration: Math.round(plan.document.outputDuration * 1000),
        ttsEnabled: plan.document.brief.audioMode === "local_voice" || plan.document.brief.audioMode === "uploaded_voice",
        aigcBadge: false,
        label: `Guided edit · R${plan.revision}`,
        status: "composing",
      }).returning().get();
      tx.update(guidedEditPlans).set({ compositionId: composition.id, status: "rendering", error: null, updatedAt: new Date() })
        .where(eq(guidedEditPlans.id, plan.id)).run();
      tx.update(projects).set({ status: "composing", productionMode: "local", updatedAt: new Date() }).where(eq(projects.id, id)).run();
      return { plan, source, composition };
    });
    startGuidedEditRender({ planId: plan.id, compositionId: composition.id, revision: plan.revision, source, document: plan.document });
    return NextResponse.json({ planId: plan.id, compositionId: composition.id, status: "rendering" }, { status: 202 });
  } catch (error) {
    if (error instanceof RenderStartError) {
      return apiError(req, error.message, error.message, error.status);
    }
    console.error("Guided edit render start failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "启动自动剪辑失败", "Failed to start guided edit") }, { status: 500 });
  }
}
