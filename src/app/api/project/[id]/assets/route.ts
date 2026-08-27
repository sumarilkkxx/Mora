import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { validateOrDelete } from "@/lib/media-validate";
import { MAX_DOWNLOAD_BYTES } from "@/lib/providers/stock-types";
import { extractLastFrame, LAST_FRAME_SUFFIX } from "@/lib/video-composer/frame-extract";

/** Decode-level check after writing to disk: AI providers' expiring links often answer with an
 * error page or a truncated body — those must be stopped before the DB row exists, or the
 * single-pass compose later fails the whole render with no hint of which asset broke. */
async function assertValidMedia(absPath: string, ext: string): Promise<void> {
  const kind = ext === "mp4" ? "video" : "image";
  if (!(await validateOrDelete(absPath, kind))) {
    throw new Error("素材文件校验失败（下载内容损坏或非媒体文件），请重新生成");
  }
}

// 获取某项目已生成的素材（素材页恢复状态用）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const rows = await db.select().from(assets).where(eq(assets.projectId, id));
    return NextResponse.json(rows);
  } catch (error) {
    console.error("获取素材失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取素材失败" },
      { status: 500 }
    );
  }
}

/** 把远程图片下载到本地 uploads，返回可访问的 /api/files 路径；本地路径则原样返回 */
async function persistSource(projectId: string, sourceUrl: string, shotId: number): Promise<string> {
  // 已是本项目本地文件，直接复用
  if (sourceUrl.startsWith("/api/files/")) return sourceUrl;

  // base64 data URI（如 OpenAI gpt-image-1 只返回 base64）：直接解码落盘
  if (sourceUrl.startsWith("data:")) {
    const comma = sourceUrl.indexOf(",");
    if (comma === -1) throw new Error("无法解析 data URI 素材");
    const meta = sourceUrl.slice(5, comma); // 如 "image/png;base64"
    const payload = sourceUrl.slice(comma + 1);
    const mime = meta.split(";")[0] || "image/png";
    const buf = /;base64/i.test(meta)
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("mp4") ? "mp4" : "jpg";
    if (buf.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`素材体积 ${buf.byteLength} 超过上限 ${MAX_DOWNLOAD_BYTES}`);
    const dir = join(getDataDir(), "uploads", projectId);
    await mkdir(dir, { recursive: true });
    const fileName = `asset-${shotId}-${Date.now()}.${ext}`;
    const abs = join(dir, fileName);
    await writeFile(abs, buf);
    await assertValidMedia(abs, ext);
    return `/api/files/${projectId}/${fileName}`;
  }

  // 远程 URL：下载到本地，避免合成时依赖外链（且 AI 素材外链常有有效期）
  if (/^https?:\/\//.test(sourceUrl)) {
    const resp = await fetch(sourceUrl);
    if (!resp.ok) throw new Error(`下载素材失败: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`素材体积 ${buf.byteLength} 超过上限 ${MAX_DOWNLOAD_BYTES}`);
    const ct = resp.headers.get("content-type") || "";
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("mp4") ? "mp4" : "jpg";
    const dir = join(getDataDir(), "uploads", projectId);
    await mkdir(dir, { recursive: true });
    const fileName = `asset-${shotId}-${Date.now()}.${ext}`;
    const abs = join(dir, fileName);
    await writeFile(abs, buf);
    await assertValidMedia(abs, ext);
    return `/api/files/${projectId}/${fileName}`;
  }

  throw new Error("不支持的素材来源");
}

// 保存/更新某分镜的素材（素材生成成功后落库，供合成读取真实素材）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { shotId, sourceUrl } = body as { shotId?: number; sourceUrl?: string };

    if (typeof shotId !== "number" || !sourceUrl) {
      return NextResponse.json({ error: "缺少 shotId 或 sourceUrl" }, { status: 400 });
    }
    // 校验 projectId 防路径穿越
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });
    }

    const filePath = await persistSource(id, sourceUrl, shotId);
    // tail frame for video assets (seam primitive): the clip's REAL last frame, extracted next
    // to the file — the next shot's i2v can start from it for a pixel-continuous cut. Best-effort:
    // failure just omits lastFrameUrl and the caller falls back to pre-generated keyframes.
    let lastFrameUrl: string | undefined;
    if (/\.(mp4|webm|mov|m4v)$/i.test(filePath) && filePath.startsWith(`/api/files/${id}/`)) {
      const fileName = filePath.slice(`/api/files/${id}/`.length);
      const abs = join(getDataDir(), "uploads", id, fileName);
      const frame = await extractLastFrame(abs);
      if (frame) lastFrameUrl = `${filePath}${LAST_FRAME_SUFFIX}`;
    }
    const db = getDb();

    const typeMap: Record<string, "ai_generated" | "product_image" | "user_upload"> = {
      ai_generate: "ai_generated",
      ai_generated: "ai_generated",
      product_image: "product_image",
      user_upload: "user_upload",
    };
    const assetType = typeMap[body.type] ?? "ai_generated";

    // Static keyframe (first frame) accompanying an i2v video asset: serves as the assets-page
    // thumbnail AND as the source frame for per-shot motion re-runs / keyframe chaining — the
    // upsert below replaces the old keyframe row entirely, so without this column the frame is
    // unrecoverable. Local persisted paths only (the keyframe was saved as an image asset earlier).
    const thumbnailPath =
      typeof body.thumbnailPath === "string" && body.thumbnailPath.startsWith("/api/files/")
        ? body.thumbnailPath
        : undefined;

    // 按 (projectId, shotId) upsert：先删旧再插
    await db.delete(assets).where(and(eq(assets.projectId, id), eq(assets.shotId, shotId)));
    const rows = await db
      .insert(assets)
      .values({
        projectId: id,
        shotId,
        type: assetType,
        filePath,
        thumbnailPath,
        provider: body.provider,
        model: body.model,
        prompt: body.prompt,
        status: "done",
      })
      .returning();

    return NextResponse.json({ ...rows[0], ...(lastFrameUrl && { lastFrameUrl }) });
  } catch (error) {
    console.error("保存素材失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存素材失败" },
      { status: 500 }
    );
  }
}
