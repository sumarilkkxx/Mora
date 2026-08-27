/**
 * "Native feel" post-process — makes a finished video read as hand-shot phone footage instead of
 * polished AI output: handheld micro-jitter (layered deterministic sines driving a crop window),
 * light temporal grain, and a slight de-polish color tweak. Runs over the composed mp4 like the
 * end-card/export-platform post-processes — the compose pipeline is untouched.
 *
 * Rationale (2026 survey): platforms now downrank "overly polished / heavy-filter / staged" content
 * and favour an authentic hand-held look; polish can even suppress paid-traffic performance. The
 * jitter is sine-driven (not random) so runs are reproducible; `seed` shifts the phases so A/B
 * variants don't share identical motion.
 */
import { dirname } from "path";
import { mkdir } from "fs/promises";
import { ffmpegBin, ffprobeBin } from "@/lib/ffmpeg-path";

export type FeelStrength = "subtle" | "medium" | "strong";

export interface NativeFeelVfOpts {
  /** video pixel width/height (from ffprobe) */
  width: number;
  height: number;
  /** subtle (default): barely-there drift; medium: visibly hand-held; strong: walking-while-filming (adds micro-rotation) */
  strength?: FeelStrength;
  /** phase seed for deterministic variation between variants (default 0) */
  seed?: number;
  /** temporal grain (default on) */
  grain?: boolean;
  /** slight vignette (default off — noticeable, so opt-in) */
  vignette?: boolean;
  /**
   * Halation glow (default off): real lenses bleed highlights with a warm edge — AI frames have
   * mathematically clean highlight borders, which reads as a tell. Lifts bright areas, blurs
   * them, warms the glow, screens it back.
   */
  halation?: boolean;
  /**
   * Platform-transcode look (default off): a real upload has already survived one platform
   * re-encode (Douyin lands most videos at 720p). Simulates the generational loss — downscale
   * to 2/3 and back, phone-HDR "sharp + saturated" tweak — and the caller should pair it with
   * a higher CRF (applyNativeFeel switches to 27).
   */
  phoneCompress?: boolean;
}

// Per-strength tuning. Margin ratios decide how much we over-scale before cropping back; the sine
// amplitudes must sum to ≤ margin so the crop window never leaves the frame.
const STRENGTHS: Record<FeelStrength, {
  marginRatio: number;
  ampRatio: [number, number]; // primary/secondary sine amplitude as a share of the margin
  noise: number;
  saturation: number;
  contrast: number;
  /** micro-rotation amplitude in radians (walking-with-phone wobble); 0 = off */
  rotate: number;
}> = {
  subtle: { marginRatio: 0.011, ampRatio: [0.62, 0.3], noise: 5, saturation: 0.95, contrast: 0.985, rotate: 0 },
  medium: { marginRatio: 0.02, ampRatio: [0.62, 0.3], noise: 9, saturation: 0.92, contrast: 0.97, rotate: 0 },
  // strong = walking while filming: wider drift + a ~0.1° breathing roll. The rotation displaces
  // canvas corners by well under the over-scan margin, so the crop window never samples the edge.
  strong: { marginRatio: 0.03, ampRatio: [0.62, 0.3], noise: 12, saturation: 0.9, contrast: 0.96, rotate: 0.0018 },
};

// Layered low frequencies read as organic hand drift (a single sine reads as mechanical sway)
const FREQ = { x1: 1.3, x2: 3.7, y1: 1.1, y2: 2.9 };

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Build the -filter_complex that over-scales, drifts the crop window with layered sines, then adds
 * grain + de-polish color. Always outputs a labeled [vout]. Pure function.
 */
export function buildNativeFeelFilter(o: NativeFeelVfOpts): string {
  const p = STRENGTHS[o.strength ?? "subtle"];
  const mx = Math.max(4, Math.round(o.width * p.marginRatio));
  const my = Math.max(4, Math.round(o.height * p.marginRatio));
  // seed → phase offsets (bounded to one period); deterministic, no Math.random
  const seed = o.seed ?? 0;
  const ph = (k: number) => fmt(((seed * 0.61803 + k) % 1) * 6.2832);
  const ax1 = Math.round(mx * p.ampRatio[0]);
  const ax2 = Math.round(mx * p.ampRatio[1]);
  const ay1 = Math.round(my * p.ampRatio[0]);
  const ay2 = Math.round(my * p.ampRatio[1]);
  const x = `${mx}+${ax1}*sin(t*${FREQ.x1}+${ph(0.13)})+${ax2}*sin(t*${FREQ.x2}+${ph(0.41)})`;
  const y = `${my}+${ay1}*cos(t*${FREQ.y1}+${ph(0.71)})+${ay2}*sin(t*${FREQ.y2}+${ph(0.29)})`;
  const parts = [`scale=${o.width + 2 * mx}:${o.height + 2 * my}`];
  // walking wobble: a slow breathing roll applied on the over-scanned canvas — the tiny angle's
  // corner displacement stays far inside the margin the crop window leaves untouched
  if (p.rotate > 0) parts.push(`rotate='${p.rotate}*sin(t*0.9+${ph(0.53)})':bilinear=1`);
  parts.push(`crop=w=${o.width}:h=${o.height}:x='${x}':y='${y}'`);
  if (o.phoneCompress) {
    // one platform-transcode generation: down to 2/3 (Douyin's common 720p landing) and back,
    // then the phone-HDR "slightly over-sharp + saturated" signature
    const pw = Math.max(2, Math.round((o.width * 2) / 3 / 2) * 2);
    const phh = Math.max(2, Math.round((o.height * 2) / 3 / 2) * 2);
    parts.push(`scale=${pw}:${phh}:flags=bilinear`, `scale=${o.width}:${o.height}`, `unsharp=5:5:0.6:5:5:0.0`);
  }
  if (o.grain !== false) parts.push(`noise=alls=${p.noise}:allf=t`);
  // phoneCompress swaps the de-polish grade for the phone-HDR boost (they'd fight each other)
  parts.push(o.phoneCompress ? `eq=saturation=1.12:contrast=1.05` : `eq=saturation=${p.saturation}:contrast=${p.contrast}`);
  if (o.vignette) parts.push("vignette=angle=PI/8");
  if (!o.halation) return `[0:v]${parts.join(",")}[vout]`;
  // halation: lift highlights, blur, warm the glow (pull blue/green down), screen it back —
  // the cheap "optical imperfection" real lenses always have around bright edges
  return (
    `[0:v]${parts.join(",")}[base];` +
    `[base]split[hbase][hglow];` +
    `[hglow]lutyuv=y='if(gt(val,200),val,0)',gblur=sigma=14:steps=4,curves=blue='0/0 1/0.85':green='0/0 1/0.92'[hg];` +
    `[hbase][hg]blend=all_mode=screen[vout]`
  );
}

/** ffprobe width/height (falls back to 1080×1920 on failure, matching the vertical default). */
async function probeSize(videoPath: string): Promise<{ width: number; height: number }> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(ffprobeBin(), [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      videoPath,
    ]);
    const [w, h] = String(stdout).trim().split(",").map((x) => parseInt(x, 10));
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) return { width: w, height: h };
  } catch {
    /* fall through to default */
  }
  return { width: 1080, height: 1920 };
}

/** Apply the native-feel chain to videoPath → write a new mp4 at outPath (audio copied through). */
export async function applyNativeFeel(opts: {
  videoPath: string;
  outPath: string;
  strength?: FeelStrength;
  seed?: number;
  grain?: boolean;
  vignette?: boolean;
  halation?: boolean;
  phoneCompress?: boolean;
}): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const { width, height } = await probeSize(opts.videoPath);
  const vf = buildNativeFeelFilter({
    width,
    height,
    strength: opts.strength,
    seed: opts.seed,
    grain: opts.grain,
    vignette: opts.vignette,
    halation: opts.halation,
    phoneCompress: opts.phoneCompress,
  });
  await mkdir(dirname(opts.outPath), { recursive: true });
  await run(ffmpegBin(), [
    "-y",
    "-i", opts.videoPath,
    "-filter_complex", vf,
    "-map", "[vout]",
    "-map", "0:a?",
    "-map_metadata", "0",
    // phoneCompress relies on the higher CRF for the visible re-encode scars (blocking/banding)
    "-c:v", "libx264", "-preset", "medium", "-crf", opts.phoneCompress ? "27" : "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "copy",
    opts.outPath,
  ]);
}
