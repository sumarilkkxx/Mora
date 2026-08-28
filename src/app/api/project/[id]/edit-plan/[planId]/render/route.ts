import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { compositions, guidedEditPlans, mediaSources, projects } from "@/lib/db/schema";
import { startGuidedEditRender } from "@/lib/guided-edit-render-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> },
) {
  const { id, planId } = await params;
  if (!SAFE_ID.test(id) || !SAFE_ID.test(planId)) return apiError(req, "无效的剪辑方案ID", "Invalid edit plan ID", 400);
  try {
    const db = getDb();
    const [plan] = await db.select().from(guidedEditPlans)
      .where(and(eq(guidedEditPlans.id, planId), eq(guidedEditPlans.projectId, id))).limit(1);
    if (!plan) return apiError(req, "剪辑方案不存在", "Edit plan not found", 404);
    if (plan.status === "rendering") return apiError(req, "当前方案正在渲染", "This plan is already rendering", 409);
    const [source] = await db.select().from(mediaSources)
      .where(and(eq(mediaSources.id, plan.sourceId), eq(mediaSources.projectId, id))).limit(1);
    if (!source) return apiError(req, "原始素材不存在", "Source media not found", 404);
    if (!plan.document.timeline.length || plan.document.outputDuration < 0.5) {
      return apiError(req, "剪辑方案没有有效时间线", "The edit plan has no valid timeline", 422);
    }
    const aspectRatio = plan.document.brief.aspectRatio;
    const [composition] = await db.insert(compositions).values({
      projectId: id,
      resolution: "1080p",
      aspectRatio,
      duration: Math.round(plan.document.outputDuration * 1000),
      ttsEnabled: plan.document.brief.audioMode === "local_voice" || plan.document.brief.audioMode === "uploaded_voice",
      aigcBadge: false,
      label: `Guided edit · R${plan.revision}`,
      status: "composing",
    }).returning();
    await Promise.all([
      db.update(guidedEditPlans).set({ compositionId: composition.id, status: "rendering", error: null, updatedAt: new Date() })
        .where(eq(guidedEditPlans.id, plan.id)),
      db.update(projects).set({ status: "composing", updatedAt: new Date() }).where(eq(projects.id, id)),
    ]);
    startGuidedEditRender({ planId: plan.id, compositionId: composition.id, revision: plan.revision, source, document: plan.document });
    return NextResponse.json({ planId: plan.id, compositionId: composition.id, status: "rendering" }, { status: 202 });
  } catch (error) {
    console.error("Guided edit render start failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "启动自动剪辑失败", "Failed to start guided edit") }, { status: 500 });
  }
}
