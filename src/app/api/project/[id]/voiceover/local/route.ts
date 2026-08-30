import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { sanitizeGuidedScriptBeats, sanitizeGuidedSpeechRate } from "@/lib/guided-edit";
import { DEFAULT_FREE_VOICE, generateSpeechFree } from "@/lib/edge-tts";
import { getUploadsDir } from "@/lib/paths";
import { probeMedia } from "@/lib/media-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  try {
    const body = await req.json() as Record<string, unknown>;
    const beats = sanitizeGuidedScriptBeats(body.beats);
    if (!beats.length) return apiError(req, "请先整理脚本节拍", "Structure the script beats first", 422);
    const db = getDb();
    const project = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!project[0]) return apiError(req, "项目不存在", "Project not found", 404);
    const directory = join(getUploadsDir(), id, "voiceovers");
    await mkdir(directory, { recursive: true });
    const fileName = `${Date.now()}-${crypto.randomUUID()}.mp3`;
    const outputPath = join(directory, fileName);
    const voice = typeof body.voice === "string" && /^[A-Za-z0-9-]{1,80}$/.test(body.voice) ? body.voice : DEFAULT_FREE_VOICE;
    const multiplier = sanitizeGuidedSpeechRate(body.speechRate);
    const ratePercent = Math.round((multiplier - 1) * 100);
    const rate = `${ratePercent >= 0 ? "+" : ""}${ratePercent}%`;
    try {
      const audio = await generateSpeechFree(beats.map((beat) => beat.text).join("\n"), { voice, rate, timeoutMs: 45_000 });
      await writeFile(outputPath, audio);
    } catch (error) {
      await rm(outputPath, { force: true }).catch(() => {});
      throw error;
    }
    const metadata = await probeMedia(outputPath);
    return NextResponse.json({ fileName, originalName: "AI voiceover", voice, duration: metadata.duration }, { status: 201 });
  } catch (error) {
    console.error("Local voice synthesis failed:", error);
    const message = error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
      ? errText(req, "Microsoft TTS 运行环境不可用", "The Microsoft TTS runtime is unavailable")
      : error instanceof Error ? error.message : errText(req, "本地配音失败", "Local voice synthesis failed");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
