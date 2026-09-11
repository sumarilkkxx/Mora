import { execFile } from "child_process";
import { realpathSync } from "fs";
import { promisify } from "util";
import { readFile, mkdir } from "fs/promises";
import { join, resolve, sep } from "path";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { getDataDir, getUploadsDir } from "@/lib/paths";
import type { Speech } from "./contract";

export const execMedia = promisify(execFile);
export function ownedSourcePath(projectId: string, file: string): string {
  const base = realpathSync(resolve(getUploadsDir(), projectId)) + sep;
  const target = realpathSync(resolve(file));
  const normalize = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
  if (!normalize(target).startsWith(normalize(base))) throw new Error("素材路径越界 / Source path outside project");
  return target;
}
export async function frameAt(file: string, at: number, signal: AbortSignal): Promise<string> {
  const { stdout } = await execMedia(ffmpegBin(), ["-nostdin", "-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=512:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { encoding: "buffer", maxBuffer: 3 * 1024 * 1024, timeout: 30000, signal });
  if (!stdout.length) throw new Error(`无法读取 ${at}s 画面 / Frame unavailable`);
  return `data:image/jpeg;base64,${stdout.toString("base64")}`;
}
/** Low-resolution scene-change scan supplements the uniform coverage samples. */
export async function sceneSamples(file: string, signal: AbortSignal): Promise<number[]> {
  const { stderr } = await execMedia(ffmpegBin(), ["-nostdin", "-hide_banner", "-i", file, "-an", "-vf", "fps=5,scale=256:-2,select=gt(scene\\,0.3),showinfo", "-frames:v", "12", "-fps_mode", "vfr", "-f", "null", "-"], { timeout: 120000, signal, maxBuffer: 2 * 1024 * 1024 });
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1])).filter(Number.isFinite).slice(0, 12);
}
/** A separate Node process is killable and survives browser navigation. */
export async function transcribe(file: string, directory: string, signal: AbortSignal, language: "zh" | "en" = "zh"): Promise<Speech[]> {
  await mkdir(directory, { recursive: true });
  const pcm = join(directory, "speech.f32");
  const result = join(directory, "speech.json");
  await execMedia(ffmpegBin(), ["-nostdin", "-v", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", pcm], { timeout: 120000, signal });
  await execMedia(process.execPath, [join(process.cwd(), "scripts", "auto-edit-asr.mjs"), pcm, result, join(getDataDir(), "cache", "asr"), language], { timeout: 15 * 60_000, signal, maxBuffer: 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  const raw = JSON.parse(await readFile(result, "utf8")) as Speech[];
  return raw.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start && typeof s.text === "string");
}
