import { execFile } from "child_process";
import { mkdir } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { getUploadsDir } from "@/lib/paths";
import type { GuidedScene } from "@/lib/guided-edit";

const execFileAsync = promisify(execFile);
const SCENE_THRESHOLD = 0.32;
const MIN_SCENE_SECONDS = 0.7;
const MAX_SCENE_SECONDS = 8;
const MAX_SCENES = 120;

function splitLongRange(start: number, end: number): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = start;
  while (end - cursor > MAX_SCENE_SECONDS) {
    ranges.push({ start: cursor, end: cursor + MAX_SCENE_SECONDS });
    cursor += MAX_SCENE_SECONDS;
  }
  if (end - cursor >= MIN_SCENE_SECONDS) ranges.push({ start: cursor, end });
  return ranges;
}

export function sceneRangesFromTimestamps(timestamps: number[], duration: number): Array<{ start: number; end: number }> {
  const boundaries = [0, ...timestamps, duration]
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= duration)
    .sort((a, b) => a - b)
    .filter((time, index, list) => index === 0 || time - list[index - 1] >= MIN_SCENE_SECONDS);
  if (boundaries.at(-1) !== duration) boundaries.push(duration);
  const ranges = boundaries.slice(0, -1).flatMap((start, index) => splitLongRange(start, boundaries[index + 1]));
  if (ranges.length <= MAX_SCENES) return ranges;
  const step = ranges.length / MAX_SCENES;
  return Array.from({ length: MAX_SCENES }, (_, index) => ranges[Math.floor(index * step)]);
}

async function extractThumbnail(inputPath: string, outputPath: string, at: number): Promise<void> {
  await execFileAsync(ffmpegBin(), [
    "-nostdin", "-v", "error", "-y", "-ss", at.toFixed(3), "-i", inputPath,
    "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", outputPath,
  ], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
}

export async function analyzeGuidedScenes(input: {
  projectId: string;
  sourceId: string;
  sourcePath: string;
  duration: number;
}): Promise<GuidedScene[]> {
  let stderr = "";
  try {
    const result = await execFileAsync(ffmpegBin(), [
      "-nostdin", "-hide_banner", "-i", input.sourcePath,
      "-vf", `select=gt(scene\\,${SCENE_THRESHOLD}),showinfo`, "-an", "-f", "null", "-",
    ], { timeout: 5 * 60_000, maxBuffer: 24 * 1024 * 1024 });
    stderr = result.stderr;
  } catch (error) {
    const details = error as { stderr?: string };
    stderr = details.stderr ?? "";
  }
  const timestamps = Array.from(stderr.matchAll(/pts_time:([0-9.]+)/g), (match) => Number(match[1]));
  const ranges = sceneRangesFromTimestamps(timestamps, Math.max(0.5, input.duration));
  const directory = join(getUploadsDir(), input.projectId, "scenes", input.sourceId);
  await mkdir(directory, { recursive: true });

  const scenes: GuidedScene[] = ranges.map((range, index) => ({
    id: `scene-${index + 1}`,
    start: Number(range.start.toFixed(3)),
    end: Number(range.end.toFixed(3)),
    label: index === 0 ? "highlight" : "other",
    selected: true,
    thumbnailUrl: `/api/files/${input.projectId}/scenes/${input.sourceId}/scene-${index + 1}.jpg`,
  }));

  for (let offset = 0; offset < scenes.length; offset += 4) {
    await Promise.all(scenes.slice(offset, offset + 4).map((scene) =>
      extractThumbnail(input.sourcePath, join(directory, `${scene.id}.jpg`), (scene.start + scene.end) / 2),
    ));
  }
  return scenes;
}

