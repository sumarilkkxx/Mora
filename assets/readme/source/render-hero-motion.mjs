import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";

const root = resolve(import.meta.dirname, "..", "..", "..");
const specPath = join(root, "assets", "readme", "hero-motion.json");
const spec = JSON.parse(await readFile(specPath, "utf8"));

const clamp = (value) => Math.max(0, Math.min(1, value));
const progress = (time, start, end) => clamp((time - start) / (end - start));
const easeOut = (value) => 1 - (1 - value) ** 3;
const smoothstep = (value) => value * value * (3 - 2 * value);

function layerState(time, layer) {
  const entered = easeOut(progress(time, layer.enter.start, layer.enter.end));
  const exited = smoothstep(progress(time, layer.exit.start, layer.exit.end));
  const opacity = entered * (1 - exited);
  const dx = layer.enter.from[0] * (1 - entered) + layer.exit.to[0] * exited;
  const dy = layer.enter.from[1] * (1 - entered) + layer.exit.to[1] * exited;
  return { opacity, dx, dy };
}

function frameSvg(svg, time) {
  let result = svg;
  for (const layer of spec.layers) {
    const state = layerState(time, layer);
    const open = `<g id="${layer.id}">`;
    const replacement = `<g id="${layer.id}" opacity="${state.opacity.toFixed(4)}" transform="translate(${state.dx.toFixed(2)} ${state.dy.toFixed(2)})">`;
    if (!result.includes(open)) throw new Error(`Missing SVG layer: ${layer.id}`);
    result = result.replace(open, replacement);
  }
  return result;
}

async function renderHero(stem) {
  const input = join(root, "assets", "readme", `${stem}.svg`);
  const output = join(root, "assets", "readme", `${stem}.gif`);
  const preview = join(root, "assets", "readme", `${stem}-static.png`);
  const svg = await readFile(input, "utf8");
  const workspace = await mkdtemp(join(tmpdir(), `mora-readme-${stem}-`));
  const frameCount = Math.round(spec.duration * spec.fps);

  try {
    await sharp(Buffer.from(svg)).png().toFile(preview);
    for (let index = 0; index < frameCount; index += 1) {
      const time = (index / Math.max(1, frameCount - 1)) * spec.duration;
      const target = join(workspace, `frame-${String(index).padStart(4, "0")}.png`);
      await sharp(Buffer.from(frameSvg(svg, time))).png({ compressionLevel: 9 }).toFile(target);
    }

    const palette = join(workspace, "palette.png");
    const pattern = join(workspace, "frame-%04d.png");
    const paletteResult = spawnSync(ffmpegPath, [
      "-y", "-framerate", String(spec.fps), "-i", pattern,
      "-vf", `palettegen=stats_mode=diff:max_colors=${spec.colors}`,
      palette,
    ], { stdio: "inherit" });
    if (paletteResult.status !== 0) throw new Error("Could not generate GIF palette");

    const encodeResult = spawnSync(ffmpegPath, [
      "-y", "-framerate", String(spec.fps), "-i", pattern, "-i", palette,
      "-lavfi", `paletteuse=dither=${spec.dither}:diff_mode=rectangle`,
      "-gifflags", "+offsetting-transdiff", "-loop", "0", output,
    ], { stdio: "inherit" });
    if (encodeResult.status !== 0) throw new Error("Could not encode hero GIF");

    const { size } = await stat(output);
    console.log(`Generated ${output} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

await renderHero("hero");
await renderHero("hero-en");
