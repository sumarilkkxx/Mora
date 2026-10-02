import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpegBin } from "../../src/lib/ffmpeg-path";
import { runMediaProcess } from "../../src/lib/media-runtime";
import { renderAutoEdit, outputSize } from "../../src/lib/auto-edit/render";
import { parsePlan, timeline, type EditBrief, type EditPlan, type Speech } from "../../src/lib/auto-edit/contract";
import { fileSha256 } from "./real-sources";
import { verifyMediaOutput } from "./media-oracles";
import { parseEvaluationDataset } from "./core/dataset";
import type { AgentEvaluationCase } from "./core/types";
import type { MediaCheck } from "./core/contracts";

export const FIXTURE_DIRECTORY = "evals/agent/fixtures/regression-v1";
const sourceId = "controlled-bands-audible";
const clip = (start = 0, end = 15, text = "", fit: "contain" | "cover" = "contain") => ({ sourceId, start, end, speed: 1, fit, transition: "cut" as const, text, reason: "controlled bands", evidence: `${start}s` });
const plan = (clips = [clip()]): EditPlan => ({ version: 1, title: "Controlled constraints", explanation: "Deterministic fixture; not an Agent quality judgement", clips });
const brief = (patch: Partial<EditBrief> = {}): EditBrief => ({ target: 15, aspect: "16:9", audio: "muted", style: "concise", captions: false, locale: "en", instruction: "Render the specified controlled bands; no invented scenes.", ...patch });
export interface ConstraintRecipe {
  id: string; category: "format_timing" | "audio_captions"; brief: EditBrief; plan: EditPlan;
  negative: { brief?: EditBrief; plan?: EditPlan; sourceSilent?: boolean; voiceFrequency?: number; speechText?: string };
  sourceSilent?: boolean; speechText?: string;
  focus: "dimensions" | "duration" | "frame" | "caption" | "audio" | "waveform";
  samples?: Array<{ at: number; purpose: "source" | "order" | "trim" }>;
}
export const CONSTRAINT_RECIPES: ConstraintRecipe[] = [
  { id: "portrait", category: "format_timing", brief: brief({ aspect: "9:16", instruction: "Create a 9:16 portrait with the full source visible." }), plan: plan(), negative: { brief: brief() }, focus: "dimensions" },
  { id: "landscape", category: "format_timing", brief: brief({ instruction: "Create a 16:9 landscape." }), plan: plan(), negative: { brief: brief({ aspect: "1:1" }) }, focus: "dimensions" },
  { id: "square", category: "format_timing", brief: brief({ aspect: "1:1", instruction: "Create a square frame." }), plan: plan(), negative: { brief: brief() }, focus: "dimensions" },
  { id: "contain", category: "format_timing", brief: brief({ aspect: "1:1", instruction: "Keep the entire source and its white edge marker in a square; add letterbox space." }), plan: plan(), negative: { plan: plan([clip(0, 15, "", "cover")]) }, focus: "frame", samples: [{ at: 2, purpose: "source" }] },
  { id: "cover", category: "format_timing", brief: brief({ aspect: "1:1", instruction: "Fill the square by cropping the source edges; no letterbox space." }), plan: plan([clip(0, 15, "", "cover")]), negative: { plan: plan() }, focus: "frame", samples: [{ at: 2, purpose: "source" }] },
  { id: "exact15", category: "format_timing", brief: brief({ instruction: "Output exactly 15 seconds from source 0 to 15, within two frames." }), plan: plan(), negative: { plan: plan([clip(0, 14)]) }, focus: "duration" },
  { id: "order20", category: "format_timing", brief: brief({ target: 20, instruction: "Output 20 seconds: red section 0–10 followed by blue 10–20; retain chronological order." }), plan: plan([clip(0, 10), clip(10, 20)]), negative: { plan: plan([clip(10, 20), clip(0, 10)]) }, focus: "frame", samples: [{ at: 2, purpose: "order" }, { at: 12, purpose: "order" }] },
  { id: "trim", category: "format_timing", brief: brief({ instruction: "Output only source 10–25, starting in blue and ending in green; exactly 15 seconds." }), plan: plan([clip(10, 25)]), negative: { plan: plan() }, focus: "frame", samples: [{ at: 2, purpose: "trim" }, { at: 12, purpose: "trim" }] },
  { id: "original", category: "audio_captions", brief: brief({ audio: "original", instruction: "Keep the original synthetic 440Hz sound in source 0–15 unchanged." }), plan: plan(), negative: { brief: brief() }, focus: "waveform" },
  { id: "muted", category: "audio_captions", brief: brief({ instruction: "Remove all sound from this audible source." }), plan: plan(), negative: { brief: brief({ audio: "original" }) }, focus: "audio" },
  { id: "silent-source", category: "audio_captions", brief: brief({ instruction: "Keep this video-only input silent; do not invent original sound." }), plan: plan(), sourceSilent: true, negative: { brief: brief({ audio: "original" }), sourceSilent: false }, focus: "audio" },
  { id: "voiceover", category: "audio_captions", brief: brief({ audio: "voiceover", instruction: "Replace source sound with the provided synthetic 880Hz narration substitute for TEST." }), plan: plan([clip(0, 15, "TEST")]), sourceSilent: true, negative: { voiceFrequency: 440 }, focus: "waveform" },
  { id: "captions-on", category: "audio_captions", brief: brief({ captions: true, instruction: "Display SALE in the subtitle region throughout source 0–15." }), plan: plan([clip(0, 15, "SALE")]), negative: { brief: brief() }, focus: "caption" },
  { id: "captions-off", category: "audio_captions", brief: brief({ instruction: "No visible subtitle text, including the supplied SALE text." }), plan: plan([clip(0, 15, "SALE")]), negative: { brief: brief({ captions: true }) }, focus: "caption" },
  { id: "caption-copy", category: "audio_captions", brief: brief({ captions: true, instruction: "Subtitle must read SALE; do not substitute FAIL." }), plan: plan([clip(0, 15, "SALE")]), negative: { plan: plan([clip(0, 15, "FAIL")]) }, focus: "caption" },
  { id: "speech-captions", category: "audio_captions", brief: brief({ audio: "original", captions: true, instruction: "Keep original sound and use supplied fixture transcript HELLO between 0.5 and 4.5 seconds." }), plan: plan(), speechText: "HELLO", negative: { speechText: "WORLD" }, focus: "caption" },
];

export async function generateConstraintAssets(directory = FIXTURE_DIRECTORY, selected = CONSTRAINT_RECIPES) {
  await mkdir(directory, { recursive: true });
  const source = join(directory, "bands-audible.mp4"), silent = join(directory, "bands-silent.mp4");
  const sourceArgs = ["-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=320x180:r=30:d=10", "-f", "lavfi", "-i", "color=blue:s=320x180:r=30:d=10", "-f", "lavfi", "-i", "color=green:s=320x180:r=30:d=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=30", "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,drawbox=x=0:y=0:w=24:h=180:color=white:t=fill[v]", "-map", "[v]", "-map", "3:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", source];
  await runMediaProcess(ffmpegBin(), sourceArgs);
  await runMediaProcess(ffmpegBin(), ["-v", "error", "-y", "-i", source, "-c:v", "copy", "-an", silent]);
  const voice = async (frequency: number) => {
    const path = join(directory, `voice-${frequency}.wav`);
    await runMediaProcess(ffmpegBin(), ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=44100:duration=14`, path]);
    return path;
  };
  const voice880 = await voice(880), voice440 = await voice(440);
  const version = (await runMediaProcess(ffmpegBin(), ["-version"])).stdout.split("\n")[0];
  const outputs = [];
  for (const recipe of selected) {
    const sourceFile = recipe.sourceSilent ? silent : source;
    const render = async (negative: boolean) => {
      const output = join(directory, `${recipe.id}-${negative ? "negative" : "positive"}.mp4`);
      const b = negative ? recipe.negative.brief ?? recipe.brief : recipe.brief;
      const p = negative ? recipe.negative.plan ?? recipe.plan : recipe.plan;
      const s = negative ? (recipe.negative.sourceSilent ?? recipe.sourceSilent ? silent : source) : sourceFile;
      parsePlan(p, sourceId, 30, b);
      const speech: Speech[] = [{ start: .5, end: 4.5, text: negative ? recipe.negative.speechText ?? recipe.speechText ?? "HELLO" : recipe.speechText ?? "HELLO" }];
      await renderAutoEdit({ source: s, plan: p, brief: b, quality: "720p", voices: b.audio === "voiceover" ? [{ index: 0, file: negative && recipe.negative.voiceFrequency === 440 ? voice440 : voice880, duration: 14, text: "TEST" }] : [], output, directory: join(directory, `${recipe.id}-${negative ? "negative" : "positive"}`), speech, signal: new AbortController().signal });
      return output;
    };
    const positive = await render(false), negative = await render(true);
    const [width, height] = outputSize(recipe.brief.aspect, "720p");
    const checks: MediaCheck[] = [
      { id: "decode", kind: "decode", rationale: "All rendered frames and sound must decode" },
      { id: "dimensions", kind: "dimensions", width, height, rationale: "720p render protocol and brief aspect" },
      { id: "duration", kind: "duration", seconds: timeline(recipe.plan).at(-1)!.outputEnd, toleranceSeconds: .07, rationale: "Plan source intervals at 30fps; at most two frames of container rounding" },
      { id: "audio", kind: "audio", mode: recipe.brief.audio === "muted" ? "silent" : "audible", thresholdDb: -60, rationale: "Fixture has a known audible sine; muted permits only encoding noise below -60dB" },
    ];
    if (recipe.focus === "frame" || recipe.focus === "caption") {
      for (const [index, sample] of (recipe.samples ?? [{ at: 2, purpose: "source" as const }]).entries()) checks.push({ id: `pixels-${index}`, kind: "frame_match", purpose: recipe.focus === "caption" ? "caption" : sample.purpose, atSeconds: sample.at, referenceAtSeconds: sample.at, referencePath: positive, referenceSha256: await fileSha256(positive), maxMeanError: recipe.focus === "caption" ? .15 : 1, rationale: "Known renderer ground truth; 64x64 RGB mean error; controlled pixels only, not universal OCR", ...(recipe.focus === "caption" ? { region: { x: 0, y: 500, width: 1280, height: 220 } } : {}) });
    }
    if (recipe.focus === "waveform") checks.push({ id: "waveform", kind: "audio_match", atSeconds: 2, referencePath: recipe.brief.audio === "original" ? source : voice880, referenceSha256: await fileSha256(recipe.brief.audio === "original" ? source : voice880), referenceAtSeconds: 2, seconds: 1, maxMeanError: .03, rationale: "Known 0.125-amplitude synthetic waveform; mono 8kHz error ≤ .03 allows mono-to-stereo gain (-3dB, measured error .0233) and AAC loss; wrong 440/880Hz sound is rejected; one sampled second only" });
    const item: AgentEvaluationCase = {
      caseId: `regression-${recipe.category}-${recipe.id}`, category: recipe.category, caseVersion: "1", tags: [recipe.category, recipe.focus, "controlled-fixture"], evidenceMode: "real_media",
      lineage: { sourceFamily: "controlled-bands-v1", origin: "synthetic", parentCaseId: "regression-product-6724612" },
      fixture: { generator: "ffmpeg", version, seed: 0, parameters: { recipe: recipe.id, source: "red,blue,green 10s each, 320x180@30, white edge marker; 440Hz AAC or no audio", renderer: "Mora renderAutoEdit 720p", voice: "880Hz 14s WAV synthetic narration substitute; no TTS/provider", regeneration: "tsx tools/agent-eval/prepare-constraint-fixtures.ts", sourceArguments: JSON.stringify(sourceArgs.slice(0, -1)) } },
      source: { id: recipe.sourceSilent ? "controlled-bands-silent" : sourceId, path: sourceFile, sha256: await fileSha256(sourceFile), page: "local:controlled-bands-v1", author: "Mora deterministic fixture", group: "controlled-bands-v1", category: "product", preprocessing: "none" },
      brief: recipe.brief, expected: { behavior: "complete", reasonCodes: [], terminalStates: ["done", "needs_review"], requiredTools: ["validate_edit_plan", ...(recipe.brief.audio === "voiceover" ? ["create_voiceover"] : []), "render_edit", "inspect_output", "finish"], forbiddenBehaviors: ["finish_before_inspection"], maxModelCalls: 28, maxRenders: 3, mustDecode: true, mustHaveVideo: true },
      annotation: { version: "fixture-v1", status: "pending-human-review", visibleFacts: [], forbiddenClaims: ["natural speech recognition", "real model ability"] }, checks,
    };
    const passed = await verifyMediaOutput(positive, checks), rejected = await verifyMediaOutput(negative, checks);
    outputs.push({ item, positive, negative, positiveSha256: await fileSha256(positive), negativeSha256: await fileSha256(negative), passed, rejected, recipe });
    console.log(`${recipe.id}: positive=${passed.passed} negative=${rejected.passed}`);
    if (!passed.passed || rejected.passed || rejected.checks.some(c => c.status === "unknown")) throw new Error(`Constraint oracle failed for ${recipe.id}: ${JSON.stringify(outputs.at(-1))}`);
  }
  return { version, source, silent, voice880, sourceArguments: sourceArgs, outputs };
}
export async function writeConstraintManifest(generated: Awaited<ReturnType<typeof generateConstraintAssets>>) {
  const path = "tools/agent-eval/sources/regression-fixtures-v1.json";
  await writeFile(path, JSON.stringify({ version: "1", toolVersion: generated.version, seed: 0, sourceArguments: generated.sourceArguments, outputs: generated.outputs.map(({ item, positive, negative, positiveSha256, negativeSha256, recipe }) => ({ caseId: item.caseId, positive, negative, positiveSha256, negativeSha256, recipe })) }, null, 2) + "\n");
  const dataset = { schemaVersion: 2, datasetId: "mora-agent-regression-constraints", version: "1", split: "dev", independentHoldout: false, baselineEligible: false, sourceManifest: { path, sha256: await fileSha256(path) }, cases: generated.outputs.map(o => o.item) };
  parseEvaluationDataset(dataset);
  await writeFile("tools/agent-eval/datasets/regression-constraints.json", JSON.stringify(dataset, null, 2) + "\n");
}
export async function readConstraintDataset() {
  return parseEvaluationDataset(JSON.parse(await readFile("tools/agent-eval/datasets/regression-constraints.json", "utf8")));
}
