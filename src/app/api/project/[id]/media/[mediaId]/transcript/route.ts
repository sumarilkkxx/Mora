import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { mediaSources } from "@/lib/db/schema";
import { isLocalAsrModel } from "@/lib/local-asr";
import { sanitizeTranscriptDocument } from "@/lib/transcript-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

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
    if (!source.hasAudio) return apiError(req, "这个视频没有可转写的音轨", "This video has no audio track to transcribe", 422);
    const now = new Date();

    if (body.action === "start") {
      if (!isLocalAsrModel(body.model)) return apiError(req, "不支持的本地转写模型", "Unsupported local transcription model", 400);
      const language = typeof body.language === "string" ? body.language.slice(0, 24) : "auto";
      const [updated] = await db.update(mediaSources).set({
        status: "transcribing",
        progress: 0,
        model: body.model,
        language,
        transcript: null,
        device: null,
        error: null,
        updatedAt: now,
      }).where(eq(mediaSources.id, source.id)).returning();
      return NextResponse.json(updated);
    }

    if (body.action === "heartbeat") {
      if (source.status !== "transcribing") return apiError(req, "转写任务已不在运行", "The transcription task is no longer running", 409);
      const progress = Math.min(99, Math.max(0, Math.round(Number(body.progress) || 0)));
      await db.update(mediaSources).set({ progress, updatedAt: now }).where(eq(mediaSources.id, source.id));
      return NextResponse.json({ ok: true, progress });
    }

    if (body.action === "complete") {
      if (source.status !== "transcribing" || !isLocalAsrModel(source.model)) {
        return apiError(req, "请先启动转写任务", "Start the transcription task first", 409);
      }
      const document = sanitizeTranscriptDocument(body.transcript, source.duration / 1000);
      if (!document || document.words.length > 100_000) return apiError(req, "转写结果格式无效", "Invalid transcription result", 422);
      document.model = source.model;
      document.language = source.language || document.language;
      const [updated] = await db.update(mediaSources).set({
        status: "ready",
        progress: 100,
        transcript: document,
        device: document.device,
        error: null,
        updatedAt: now,
      }).where(eq(mediaSources.id, source.id)).returning();
      return NextResponse.json(updated);
    }

    if (body.action === "fail") {
      const error = typeof body.error === "string" && body.error.trim() ? body.error.trim().slice(0, 500) : errText(req, "本地转写失败", "Local transcription failed");
      const [updated] = await db.update(mediaSources).set({ status: "failed", error, updatedAt: now }).where(eq(mediaSources.id, source.id)).returning();
      return NextResponse.json(updated);
    }

    return apiError(req, "不支持的转写操作", "Unsupported transcription action", 400);
  } catch (error) {
    console.error("Transcript state update failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "更新转写任务失败", "Failed to update transcription task") }, { status: 500 });
  }
}
