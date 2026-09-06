import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { compositions, guidedEditPlans, mediaSources, projects } from "@/lib/db/schema";
import { createGuidedEditPlan, MAX_GUIDED_OUTPUT_SECONDS } from "@/lib/guided-edit";
import { fileNameOf } from "@/lib/paths";
import { isGuidedRenderActive } from "@/lib/guided-edit-render-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  try {
    const db = getDb();
    const [projectRows, plans, projectCompositions] = await Promise.all([
      db.select().from(projects).where(eq(projects.id, id)).limit(1),
      db.select().from(guidedEditPlans).where(eq(guidedEditPlans.projectId, id)).orderBy(desc(guidedEditPlans.revision)),
      db.select().from(compositions).where(eq(compositions.projectId, id)),
    ]);
    if (!projectRows[0]) return apiError(req, "项目不存在", "Project not found", 404);
    const interruptedAt = Date.now() - 10_000;
    const abandonedPlans = plans.filter((plan) =>
      plan.status === "rendering"
      && !isGuidedRenderActive(plan.id)
      && !projectCompositions.some((c) => c.id === plan.compositionId && c.renderOwner && (c.status === "composing" || c.status === "pending"))
      && Boolean(plan.updatedAt && plan.updatedAt.getTime() < interruptedAt)
    );
    const abandonedPlanIds = new Set(abandonedPlans.map((plan) => plan.id));
    const abandonedCompositionIds = new Set(abandonedPlans.flatMap((plan) => plan.compositionId ? [plan.compositionId] : []));
    if (abandonedPlans.length) {
      const message = errText(req, "渲染已中断，可直接重新开始", "Rendering was interrupted; you can restart it");
      db.transaction((tx) => {
        for (const plan of abandonedPlans) {
          tx.update(guidedEditPlans).set({ status: "failed", error: message, updatedAt: new Date() })
            .where(eq(guidedEditPlans.id, plan.id)).run();
          if (plan.compositionId) {
            tx.update(compositions).set({ status: "failed" }).where(eq(compositions.id, plan.compositionId)).run();
          }
        }
        const hasAnotherActiveComposition = projectCompositions.some((composition) =>
          (composition.status === "composing" || composition.status === "pending")
          && !abandonedCompositionIds.has(composition.id)
        );
        if (!hasAnotherActiveComposition) {
          tx.update(projects).set({ status: "video", updatedAt: new Date() }).where(eq(projects.id, id)).run();
        }
      });
    }
    const compositionById = new Map(projectCompositions.map((composition) => [composition.id, composition]));
    return NextResponse.json({
      project: projectRows[0],
      plans: plans.map((plan) => {
        const abandoned = abandonedPlanIds.has(plan.id);
        const rawComposition = plan.compositionId ? compositionById.get(plan.compositionId) ?? null : null;
        const composition = rawComposition && abandoned ? { ...rawComposition, status: "failed" as const } : rawComposition;
        const outputName = composition?.outputPath ? fileNameOf(composition.outputPath) : null;
        return {
          ...plan,
          ...(abandoned && { status: "failed" as const, error: errText(req, "渲染已中断，可直接重新开始", "Rendering was interrupted; you can restart it") }),
          active: !abandoned && plan.status === "rendering" && isGuidedRenderActive(plan.id),
          composition: composition ? {
            ...composition,
            outputUrl: outputName ? `/api/output/${id}/${outputName}` : null,
            downloadUrl: outputName ? `/api/output/${id}/${outputName}?download=1` : null,
          } : null,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "读取剪辑方案失败", "Failed to load edit plans") }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  try {
    const body = await req.json() as Record<string, unknown>;
    const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
    if (!SAFE_ID.test(sourceId)) return apiError(req, "请选择视频素材", "Select a video source", 400);
    const db = getDb();
    const [project, source] = await Promise.all([
      db.select().from(projects).where(eq(projects.id, id)).limit(1),
      db.select().from(mediaSources).where(and(eq(mediaSources.id, sourceId), eq(mediaSources.projectId, id))).limit(1),
    ]);
    if (!project[0]) return apiError(req, "项目不存在", "Project not found", 404);
    if (!source[0]) return apiError(req, "素材不存在", "Media source not found", 404);
    const document = createGuidedEditPlan({
      brief: body.brief,
      scenes: Array.isArray(body.scenes) ? body.scenes : source[0].scenes,
      sourceId,
      sourceDuration: source[0].duration / 1000,
      existingBeats: Array.isArray(body.beats) ? body.beats as never[] : undefined,
    });
    if (!document.beats.length) return apiError(req, "请先填写推广文案", "Add promotion copy first", 422);
    if (document.outputDuration > MAX_GUIDED_OUTPUT_SECONDS + 0.01) {
      return apiError(req, `当前文案预计 ${Math.ceil(document.outputDuration)} 秒，自动剪辑最长支持 ${MAX_GUIDED_OUTPUT_SECONDS} 秒。请加快语速或缩短文案。`, `The copy is estimated at ${Math.ceil(document.outputDuration)}s. Automatic edits support up to ${MAX_GUIDED_OUTPUT_SECONDS}s; increase the speech rate or shorten the copy.`, 422);
    }
    if (!document.timeline.length) return apiError(req, "没有可用于剪辑的镜头", "No scenes are available for editing", 422);
    const now = new Date();
    const planId = typeof body.planId === "string" && SAFE_ID.test(body.planId) ? body.planId : null;
    let saved;
    if (planId) {
      const [existing] = await db.select().from(guidedEditPlans)
        .where(and(eq(guidedEditPlans.id, planId), eq(guidedEditPlans.projectId, id))).limit(1);
      if (!existing) return apiError(req, "剪辑方案不存在", "Edit plan not found", 404);
      if (existing.status === "rendering") return apiError(req, "当前方案正在渲染", "This plan is rendering", 409);
      [saved] = await db.update(guidedEditPlans).set({
        sourceId,
        document,
        status: "ready",
        compositionId: null,
        error: null,
        updatedAt: now,
      }).where(eq(guidedEditPlans.id, existing.id)).returning();
    } else {
      const [latest] = await db.select({ revision: guidedEditPlans.revision }).from(guidedEditPlans)
        .where(eq(guidedEditPlans.projectId, id)).orderBy(desc(guidedEditPlans.revision)).limit(1);
      [saved] = await db.insert(guidedEditPlans).values({
        projectId: id,
        sourceId,
        revision: (latest?.revision ?? 0) + 1,
        document,
        status: "ready",
      }).returning();
    }
    await Promise.all([
      db.update(mediaSources).set({ scenes: document.scenes, updatedAt: now }).where(eq(mediaSources.id, sourceId)),
      db.update(projects).set({
        workflowType: "edit",
        name: document.brief.projectName || project[0].name,
        productName: document.brief.productName || project[0].productName,
        productDescription: document.brief.promotionGoal || project[0].productDescription,
        status: "video",
        updatedAt: now,
      }).where(eq(projects.id, id)),
    ]);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("Guided edit plan save failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "保存剪辑方案失败", "Failed to save edit plan") }, { status: 500 });
  }
}
