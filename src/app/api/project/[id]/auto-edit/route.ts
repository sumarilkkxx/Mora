import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { autoEditRuns, mediaSources } from "@/lib/db/schema";
import { parseBrief, parsePlan, parsePromotionCopy, validateSource, type Checkpoint } from "@/lib/auto-edit/contract";
import { cancelAutoEdit, recoverAutoEdits, startAutoEdit, type Credentials } from "@/lib/auto-edit/runner";
import { fileNameOf } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ID = /^[a-zA-Z0-9-]{1,100}$/;
function serialize(row: typeof autoEditRuns.$inferSelect) {
  return { id: row.id, projectId: row.projectId, sourceId: row.sourceId, parentId: row.parentId, status: row.status, stage: row.stage, brief: row.brief, quality: row.quality, attempt: row.attempt,
    error: row.error, createdAt: row.createdAt, updatedAt: row.updatedAt, compositionId: row.compositionId,
    checkpoint: { ...row.checkpoint, output: undefined, voices: row.checkpoint.voices?.map(v => ({ index: v.index, duration: v.duration, text: v.text })) },
    url: row.checkpoint.output && ["done", "needs_review"].includes(row.status) ? `/api/output/${row.projectId}/${fileNameOf(row.checkpoint.output)}` : null };
}
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  try {
    await recoverAutoEdits();
    const rows = await getDb().select().from(autoEditRuns).where(eq(autoEditRuns.projectId, id)).orderBy(desc(autoEditRuns.createdAt)).limit(40);
    return NextResponse.json({ runs: rows.map(serialize) });
  } catch { return NextResponse.json({ error: "读取任务失败 / Failed to load tasks" }, { status: 500 }); }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  try {
    const raw = await req.text();
    if (raw.length > 100000) throw new Error("请求过大 / Request too large");
    const body = JSON.parse(raw);
    const db = getDb();
    if (body.action === "cancel") {
      if (!ID.test(body.runId)) throw new Error("Invalid run ID");
      await cancelAutoEdit(body.runId, id);
      return NextResponse.json({ ok: true });
    }
    if (!["start", "analyze", "rewrite-copy", "approve-copy", "retry", "revise", "candidates", "export", "manual"].includes(body.action)) throw new Error("Unsupported action");
    const isNew = body.action === "start" || body.action === "analyze";
    const parent = !isNew && body.runId && ID.test(body.runId) ? (await db.select().from(autoEditRuns).where(and(eq(autoEditRuns.id, body.runId), eq(autoEditRuns.projectId, id))))[0] : undefined;
    if (!isNew && !parent) throw new Error("任务不存在 / Run not found");
    if (parent && ["running", "queued", "cancel_requested"].includes(parent.status)) throw new Error("任务仍在运行 / Run is active");
    const sourceId = parent?.sourceId || body.sourceId;
    if (!ID.test(sourceId)) throw new Error("Invalid source ID");
    const [source] = await db.select().from(mediaSources).where(and(eq(mediaSources.id, sourceId), eq(mediaSources.projectId, id)));
    if (!source) throw new Error("素材不存在 / Source not found");
    validateSource(source.duration / 1000, source.sizeBytes);
    const brief = parseBrief(["export", "retry", "approve-copy", "rewrite-copy"].includes(body.action) ? parent!.brief : body.brief ?? parent?.brief);
    if ((body.action === "analyze" || body.action === "start") && !brief.promotion?.subject) throw new Error("请填写商品或服务 / Enter the product or service");
    const credentials = body.credentials as Credentials;
    const exportOperation = body.action === "export" || (body.action === "retry" && parent?.checkpoint.operation === "export");
    if (!exportOperation && (!credentials?.llm?.baseUrl || !credentials.llm.model || !credentials.llm.visionModel)) throw new Error("请配置文本和画面理解模型 / Configure text and visual understanding models");
    if (credentials?.llm) {
      const url = new URL(credentials.llm.baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid model endpoint");
    }
    if (body.action === "retry") {
      if (!["failed", "interrupted", "cancelled"].includes(parent!.status)) throw new Error("任务无需重试 / Run cannot be retried");
      // A retry is claimed atomically; it resumes saved analysis/plan/audio with fresh credentials.
      const [retried] = await db.update(autoEditRuns).set({ status: "queued", owner: null, heartbeat: Date.now(), error: null, updatedAt: Date.now() }).where(and(eq(autoEditRuns.id, parent!.id), inArray(autoEditRuns.status, ["failed", "interrupted", "cancelled"]))).returning();
      if (retried) startAutoEdit(retried, credentials ?? { llm: { baseUrl: "", apiKey: "", model: "" } });
      return NextResponse.json({ runId: parent!.id }, { status: 202 });
    }
    if (!ID.test(body.requestId)) throw new Error("Invalid request ID");
    const requestKey = createHash("sha256").update(`${id}:${body.requestId}`).digest("hex");
    const [existing] = await db.select().from(autoEditRuns).where(eq(autoEditRuns.requestKey, requestKey));
    if (existing) return NextResponse.json({ runId: existing.id }, { status: 202 });
    const cp: Checkpoint = { operation: body.action === "export" ? "export" : body.action === "manual" ? "manual" : body.action === "candidates" || body.action === "approve-copy" ? "candidates" : body.action === "analyze" || body.action === "rewrite-copy" ? "analysis" : "auto", history: [], repairs: 0 };
    if (parent) {
      cp.analysis = parent.checkpoint.analysis;
      cp.sourceHash = parent.checkpoint.sourceHash;
      cp.plan = parent.checkpoint.plan;
      cp.voices = parent.checkpoint.voices;
      cp.promotionCopy = parent.checkpoint.promotionCopy;
      cp.promotionCandidates = parent.checkpoint.promotionCandidates;
      cp.recommendedCopyId = parent.checkpoint.recommendedCopyId;
      if (body.action === "export") cp.inheritedReview = parent.checkpoint.checks?.review;
      cp.history.push({ at: new Date().toISOString(), action: body.action, detail: `基于版本 ${parent.id} / Based on saved version` });
    }
    if (body.action === "rewrite-copy") {
      if (!cp.analysis) throw new Error("请先完成素材分析 / Analyze the source first");
      cp.promotionCopy = undefined;
      cp.promotionCandidates = undefined;
      cp.recommendedCopyId = undefined;
      cp.copyRevision = typeof body.rewriteInstruction === "string" ? body.rewriteInstruction.trim().slice(0, 1000) : "";
    }
    if (body.action === "approve-copy") cp.promotionCopy = parsePromotionCopy(body.copy);
    if (body.action === "export" && (!cp.plan || !["done", "needs_review"].includes(parent!.status))) throw new Error("请先完成可用成片 / Finish a render first");
    const manualPlan = body.action === "manual" ? parsePlan(body.plan, sourceId, source.duration / 1000, brief) : undefined;
    if (manualPlan) cp.plan = manualPlan;
    const now = Date.now();
    const [created] = await db.insert(autoEditRuns).values({ id: randomUUID(), projectId: id, sourceId, requestKey, parentId: parent?.id, brief, checkpoint: cp, quality: body.action === "export" ? "1080p" : "720p", status: "queued", heartbeat: now, createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
    if (!created) {
      const [duplicate] = await db.select().from(autoEditRuns).where(eq(autoEditRuns.requestKey, requestKey));
      return NextResponse.json({ runId: duplicate.id }, { status: 202 });
    }
    startAutoEdit(created, credentials ?? { llm: { baseUrl: "", apiKey: "", model: "" } }, { exportOnly: body.action === "export", candidatesOnly: body.action === "candidates" || body.action === "approve-copy", manualPlan });
    return NextResponse.json({ runId: created.id }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 }); }
}
