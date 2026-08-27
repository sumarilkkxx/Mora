import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { compositions, mediaEdits, mediaSources } from "@/lib/db/schema";
import { startTranscriptRender } from "@/lib/transcript-render-runner";
import {
  keepRangesForPlan,
  outputDuration,
  sanitizeTranscriptDocument,
  sanitizeTranscriptEditPlan,
} from "@/lib/transcript-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

function aspectRatio(width: number, height: number): "9:16" | "16:9" | "1:1" {
  const ratio = width / Math.max(1, height);
  return ratio > 1.2 ? "16:9" : ratio < 0.8 ? "9:16" : "1:1";
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  if (!SAFE_ID.test(id) || !SAFE_ID.test(mediaId)) return apiError(req, "无效的素材ID", "Invalid media ID", 400);
  try {
    const body = await req.json() as Record<string, unknown>;
    const db = getDb();
    const [source] = await db.select().from(mediaSources).where(and(eq(mediaSources.id, mediaId), eq(mediaSources.projectId, id))).limit(1);
    if (!source) return apiError(req, "素材不存在", "Media source not found", 404);
    const transcript = sanitizeTranscriptDocument(source.transcript, source.duration / 1000);
    if (source.status !== "ready" || !transcript) return apiError(req, "请先完成本地转写", "Complete local transcription first", 409);
    const plan = sanitizeTranscriptEditPlan(body.plan, new Set(transcript.words.map((word) => word.id)));
    const keepRanges = keepRangesForPlan(transcript, plan);
    const editedDuration = outputDuration(keepRanges);
    if (editedDuration < 0.5) return apiError(req, "保留内容不足 0.5 秒", "Less than 0.5 seconds of content remains", 422);

    const [latest] = await db.select({ revision: mediaEdits.revision }).from(mediaEdits)
      .where(eq(mediaEdits.sourceId, source.id)).orderBy(desc(mediaEdits.revision)).limit(1);
    const revision = (latest?.revision ?? 0) + 1;
    const [composition] = await db.insert(compositions).values({
      projectId: id,
      resolution: Math.min(source.width, source.height) >= 1000 ? "1080p" : "720p",
      aspectRatio: aspectRatio(source.width, source.height),
      duration: Math.round(editedDuration * 1000),
      ttsEnabled: false,
      aigcBadge: false,
      label: `Text edit · R${revision}`,
      status: "composing",
    }).returning();
    const [edit] = await db.insert(mediaEdits).values({
      projectId: id,
      sourceId: source.id,
      revision,
      plan,
      keepRanges,
      compositionId: composition.id,
      status: "rendering",
    }).returning();

    startTranscriptRender({ editId: edit.id, compositionId: composition.id, revision, source, transcript, plan, keepRanges });
    return NextResponse.json({ edit, compositionId: composition.id, status: "rendering" }, { status: 202 });
  } catch (error) {
    console.error("Transcript edit start failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "启动文字剪辑失败", "Failed to start text edit") }, { status: 500 });
  }
}
