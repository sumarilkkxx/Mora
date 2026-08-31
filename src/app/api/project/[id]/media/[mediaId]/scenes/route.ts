import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { mediaSources } from "@/lib/db/schema";
import { analyzeGuidedScenes } from "@/lib/guided-scene-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  if (!SAFE_ID.test(id) || !SAFE_ID.test(mediaId)) return apiError(req, "无效的素材ID", "Invalid media ID", 400);
  const db = getDb();
  const [source] = await db.select().from(mediaSources)
    .where(and(eq(mediaSources.id, mediaId), eq(mediaSources.projectId, id))).limit(1);
  if (!source) return apiError(req, "素材不存在", "Media source not found", 404);
  await db.update(mediaSources).set({ sceneStatus: "analyzing", error: null, updatedAt: new Date() })
    .where(eq(mediaSources.id, source.id));
  try {
    const scenes = await analyzeGuidedScenes({
      projectId: id,
      sourceId: source.id,
      sourcePath: source.filePath,
      duration: source.duration / 1000,
    });
    await db.update(mediaSources).set({ sceneStatus: "ready", scenes, updatedAt: new Date() })
      .where(eq(mediaSources.id, source.id));
    return NextResponse.json({ scenes });
  } catch (error) {
    const message = error instanceof Error ? error.message : errText(req, "场景分析失败", "Scene analysis failed");
    await db.update(mediaSources).set({ sceneStatus: "failed", error: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(mediaSources.id, source.id));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
