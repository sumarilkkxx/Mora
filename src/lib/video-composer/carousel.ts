/**
 * Image-card carousel — turn a script into a set of styled image cards (a title card + one card per
 * shot's key line) for image-first platforms like Xiaohongshu (小红书 图文笔记), where carousels often
 * outperform video. Renders gradient-background cards with wrapped, centered text via FFmpeg drawtext,
 * reusing the composer's caption-wrap + escaping. No extra dependencies.
 */

import { join, dirname } from "path";
import { mkdir } from "fs/promises";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { buildDrawtext, wrapCaption, resolveChineseFontFile, unshellFilter } from "./composer";

export interface CardVfOpts {
  text: string;
  width: number;
  fontFile?: string;
  fontSize?: number;
  fontColor?: string;
}

export interface CardPalette {
  gradient: [string, string];
  fontColor: string;
}

/**
 * Build the -vf drawtext filter for one card: wrap the text to the card width and render each line as
 * its own horizontally-centered drawtext, stacking the lines as a vertically-centered block.
 * (A single multi-line drawtext is left-aligned; per-line drawtexts give true centering for a polished card.)
 * Pure; reuses wrapCaption + buildDrawtext escaping.
 *
 * generateCard runs ffmpeg shell-free (execFile, with this filter as a raw -vf argv element), so no shell
 * halves buildDrawtext's pre-shell double-backslash escaping. unshellFilter applies that halving here to
 * yield the ffmpeg-direct form, otherwise an ASCII colon/bracket/backslash in the card text breaks the
 * filtergraph parse or renders a stray backslash (Chinese card text lacks these chars, hiding the bug).
 */
export function buildCardVf(o: CardVfOpts): string {
  const fontSize = o.fontSize ?? Math.round(o.width * 0.055);
  const lines = wrapCaption(o.text, fontSize, o.width).split("\n");
  const lineH = Math.round(fontSize * 1.5);
  const blockH = lines.length * lineH;
  return unshellFilter(
    lines
      .map((line, i) =>
        buildDrawtext({
          fontFile: o.fontFile,
          text: line || " ",
          fontSize,
          fontColor: o.fontColor ?? "white",
          borderW: (o.fontColor ?? "white") === "white" ? Math.max(2, Math.round(o.width * 0.004)) : 0,
          x: "(w-text_w)/2",
          y: `(h-${blockH})/2+${i * lineH}`,
        }),
      )
      .join(","),
  );
}

/** Card color themes (gradient background + text color) so a feed of cards isn't monotone. */
export const CARD_THEMES: Record<string, CardPalette[]> = {
  // Warm editorial palette for image-first lifestyle feeds. No generic AI-purple.
  xiaohongshu: [
    { gradient: ["0xfff8f1", "0xffeee5"], fontColor: "0x2b211b" },
    { gradient: ["0xff6655", "0xff806d"], fontColor: "white" },
    { gradient: ["0xfff2bd", "0xffffe1"], fontColor: "0x30271d" },
    { gradient: ["0xe7f2e3", "0xd3ead5"], fontColor: "0x183126" },
  ],
  // High-contrast short-video palette, borrowing platform energy without cloning trade dress.
  shortvideo: [
    { gradient: ["0x151719", "0x252a2d"], fontColor: "white" },
    { gradient: ["0x00b8c8", "0x36d3d2"], fontColor: "0x102326" },
    { gradient: ["0xff4f5e", "0xff756d"], fontColor: "white" },
    { gradient: ["0xf4f5f2", "0xe7ebea"], fontColor: "0x181b1c" },
  ],
  // Calm solid/light cards for brands that should not inherit a platform look.
  clean: [
    { gradient: ["0xf7f3eb", "0xf7f3eb"], fontColor: "0x22201d" },
    { gradient: ["0xdcecff", "0xdcecff"], fontColor: "0x17283b" },
    { gradient: ["0xe6f1e8", "0xe6f1e8"], fontColor: "0x183124" },
    { gradient: ["0xffe7df", "0xffe7df"], fontColor: "0x3b211b" },
  ],
};

/** Resolve a theme name to its rotating palettes (falls back to Xiaohongshu editorial). Pure. */
export function resolveCardTheme(name?: string): CardPalette[] {
  return CARD_THEMES[(name || "").toLowerCase()] ?? CARD_THEMES.xiaohongshu;
}

/** Render a single card: gradient background (lavfi) + drawtext overlay → PNG at outPath. */
export async function generateCard(o: {
  text: string;
  outPath: string;
  width: number;
  height: number;
  fontFile?: string;
  fontSize?: number;
  fontColor?: string;
  gradient?: [string, string];
  backgroundImagePath?: string;
  imageOverlay?: string;
}): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const [c0, c1] = o.gradient ?? CARD_THEMES.xiaohongshu[0].gradient;
  const vf = buildCardVf({ text: o.text, width: o.width, fontFile: o.fontFile, fontSize: o.fontSize, fontColor: o.fontColor });
  await mkdir(dirname(o.outPath), { recursive: true });
  if (o.backgroundImagePath) {
    const imageVf = [
      `scale=${o.width}:${o.height}:force_original_aspect_ratio=increase`,
      `crop=${o.width}:${o.height}`,
      `drawbox=x=0:y=0:w=iw:h=ih:color=${o.imageOverlay ?? "black@0.38"}:t=fill`,
      vf,
    ].join(",");
    await run(ffmpegBin(), ["-y", "-i", o.backgroundImagePath, "-vf", imageVf, "-frames:v", "1", o.outPath]);
    return;
  }
  await run(ffmpegBin(), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `gradients=s=${o.width}x${o.height}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${o.width}:y1=${o.height}`,
    "-vf",
    vf,
    "-frames:v",
    "1",
    o.outPath,
  ]);
}

/** Maximum cards per carousel (Xiaohongshu allows up to ~18 images; cap conservatively). */
const MAX_CARDS = 12;

/**
 * Generate a carousel: a title card (large) + one content card per shot's voiceover (numbered).
 * Returns the written file paths in order.
 */
export async function generateCarousel(o: {
  title: string;
  shots: Array<{ voiceover?: string }>;
  outDir: string;
  prefix: string;
  width: number;
  height: number;
  fontFile?: string;
  theme?: string;
  heroImagePath?: string;
}): Promise<string[]> {
  const fontFile = o.fontFile ?? resolveChineseFontFile();
  const palettes = resolveCardTheme(o.theme);
  const paths: string[] = [];

  // title card — larger font, centered
  const titlePath = join(o.outDir, `${o.prefix}-0.png`);
  await generateCard({
    text: o.title,
    outPath: titlePath,
    width: o.width,
    height: o.height,
    fontFile,
    fontSize: Math.round(o.width * 0.085),
    gradient: palettes[0].gradient,
    fontColor: o.heroImagePath ? "white" : palettes[0].fontColor,
    backgroundImagePath: o.heroImagePath,
  });
  paths.push(titlePath);

  // content cards — one per non-empty voiceover, numbered
  let idx = 1;
  for (const shot of o.shots) {
    if (idx > MAX_CARDS) break;
    const text = (shot.voiceover ?? "").trim();
    if (!text) continue;
    const p = join(o.outDir, `${o.prefix}-${idx}.png`);
    const palette = palettes[idx % palettes.length];
    await generateCard({ text: `${String(idx).padStart(2, "0")}  ${text}`, outPath: p, width: o.width, height: o.height, fontFile, gradient: palette.gradient, fontColor: palette.fontColor });
    paths.push(p);
    idx++;
  }
  return paths;
}
