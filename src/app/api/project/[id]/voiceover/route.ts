import { createWriteStream } from "fs";
import { mkdir, rm } from "fs/promises";
import { basename, extname, join } from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { validateOrDelete } from "@/lib/media-validate";
import { probeMedia } from "@/lib/media-probe";
import { getUploadsDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;
const MAX_BYTES = 100 * 1024 * 1024;
const EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

function originalName(header: string | null): string {
  if (!header) return "voiceover.mp3";
  try { return basename(decodeURIComponent(header).replace(/\\/g, "/")).slice(0, 240); }
  catch { return basename(header.replace(/\\/g, "/")).slice(0, 240); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  if (!req.body) return apiError(req, "没有收到旁白音频", "No voiceover received", 400);
  const name = originalName(req.headers.get("x-file-name"));
  const extension = extname(name).toLowerCase();
  if (!EXTENSIONS.has(extension)) return apiError(req, "仅支持 MP3、WAV、M4A、AAC、OGG、FLAC", "Unsupported voiceover format", 415);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return apiError(req, "旁白不能超过 100MB", "Voiceover cannot exceed 100 MB", 413);
  const db = getDb();
  const project = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!project[0]) return apiError(req, "项目不存在", "Project not found", 404);
  const directory = join(getUploadsDir(), id, "voiceovers");
  await mkdir(directory, { recursive: true });
  const fileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const filePath = join(directory, fileName);
  let bytes = 0;
  const guard = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > MAX_BYTES ? new Error("TOO_LARGE") : null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]), guard, createWriteStream(filePath, { flags: "wx" }));
    if (!(await validateOrDelete(filePath, "audio"))) return apiError(req, "旁白音频无法解码或文件已损坏", "The voiceover is damaged or cannot be decoded", 422);
    const metadata = await probeMedia(filePath);
    return NextResponse.json({ fileName, originalName: name, duration: metadata.duration }, { status: 201 });
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => {});
    if (error instanceof Error && error.message === "TOO_LARGE") return apiError(req, "旁白不能超过 100MB", "Voiceover cannot exceed 100 MB", 413);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "旁白上传失败", "Voiceover upload failed") }, { status: 500 });
  }
}
