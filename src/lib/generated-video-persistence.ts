import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, compositions, projects } from "@/lib/db/schema";
import { getDataDir } from "@/lib/paths";
import { probeMedia } from "@/lib/media-probe";
import { validateOrDelete } from "@/lib/media-validate";
import { extractLastFrame } from "@/lib/video-composer/frame-extract";
import { readResponseBuffer, safeFetch } from "@/lib/ssrf-guard";

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

function downloadHeaders(provider: string, url: string, apiKey: string): HeadersInit | undefined {
  // OpenRouter's `unsigned_urls` name is misleading: its own /api/ content URLs
  // still require the same bearer key used for polling.
  return provider === "openrouter" && /^https:\/\/openrouter\.ai\/api\//i.test(url)
    ? { Authorization: `Bearer ${apiKey}` }
    : undefined;
}

async function downloadVideo(url: string, outputPath: string, provider: string, apiKey: string) {
  const response = await safeFetch(url, { headers: downloadHeaders(provider, url, apiKey) });
  if (!response.ok) throw new Error(`下载云端视频失败: ${response.status} ${response.statusText}`);
  const buffer = await readResponseBuffer(response, MAX_VIDEO_BYTES, "云端视频");
  if (buffer.length === 0 || buffer.length > MAX_VIDEO_BYTES) throw new Error("云端视频为空或超过 200MB 下载上限");
  await writeFile(outputPath, buffer);
  if (!(await validateOrDelete(outputPath, "video"))) throw new Error("云端返回的内容不是有效视频");
}

export async function persistRecoveredShotVideo(input: {
  projectId: string;
  shotId: number;
  videoUrl: string;
  provider: string;
  model: string;
  prompt?: string | null;
  keyframePath?: string | null;
  apiKey: string;
}) {
  const dir = join(getDataDir(), "uploads", input.projectId);
  await mkdir(dir, { recursive: true });
  const fileName = `asset-${input.shotId}-${Date.now()}.mp4`;
  const outputPath = join(dir, fileName);
  await downloadVideo(input.videoUrl, outputPath, input.provider, input.apiKey);
  const filePath = `/api/files/${input.projectId}/${fileName}`;
  await extractLastFrame(outputPath).catch(() => undefined);

  const db = getDb();
  const row = db.transaction((tx) => {
    const previous = tx.select().from(assets).where(and(eq(assets.projectId, input.projectId), eq(assets.shotId, input.shotId))).get();
    const thumbnailPath = input.keyframePath ?? previous?.thumbnailPath ??
      (previous?.filePath && /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(previous.filePath) ? previous.filePath : null);
    tx.delete(assets).where(and(eq(assets.projectId, input.projectId), eq(assets.shotId, input.shotId))).run();
    return tx.insert(assets).values({
      projectId: input.projectId,
      shotId: input.shotId,
      type: "ai_generated",
      filePath,
      thumbnailPath,
      provider: input.provider,
      model: input.model,
      prompt: input.prompt ?? undefined,
      status: "done",
    }).returning().get();
  });
  return { kind: "asset" as const, url: filePath, assetId: row.id };
}

export async function persistRecoveredComposition(input: {
  projectId: string;
  videoUrl: string;
  provider: string;
  model: string;
  apiKey: string;
}) {
  const dir = join(getDataDir(), "output", input.projectId);
  await mkdir(dir, { recursive: true });
  const fileName = `cloud_${Date.now()}.mp4`;
  const outputPath = join(dir, fileName);
  await downloadVideo(input.videoUrl, outputPath, input.provider, input.apiKey);
  const probe = await probeMedia(outputPath).catch(() => undefined);
  const portrait = !probe || probe.height >= probe.width;
  const resolution = probe && Math.max(probe.width, probe.height) >= 1900 ? "1080p" : "720p";

  const db = getDb();
  const [row] = await db.insert(compositions).values({
    projectId: input.projectId,
    outputPath,
    status: "done",
    videoOrigin: "cloud_ai",
    resolution,
    aspectRatio: portrait ? "9:16" : "16:9",
    ...(probe?.duration ? { duration: Math.round(probe.duration * 1000) } : {}),
    aigcBadge: false,
    label: `云端生成 · ${input.model.split("/").pop() ?? input.model}`.slice(0, 60),
  }).returning();
  await db.update(projects).set({ status: "done", productionMode: "ai", updatedAt: new Date() }).where(eq(projects.id, input.projectId));
  return { kind: "composition" as const, url: `/api/output/${input.projectId}/${fileName}`, compositionId: row.id };
}
