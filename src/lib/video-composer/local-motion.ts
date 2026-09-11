import { easeExpr } from "./easing";

export type LocalMotionIntensity = "subtle" | "normal" | "strong";

export type LocalMotionKind =
  | "push_in"
  | "push_in_fast"
  | "pull_out"
  | "pan_left"
  | "pan_right"
  | "tilt_up"
  | "tilt_down"
  | "diagonal"
  | "arc"
  | "macro_push"
  | "hold";

export interface LocalMotionInput {
  shotId?: number;
  shotType?: string;
  camera?: string;
  legacyMotion?: string;
  override?: LocalMotionKind | "auto";
  intensity?: LocalMotionIntensity;
  productSafe?: boolean;
}

export interface LocalMotionPlan {
  kind: LocalMotionKind;
  intensity: LocalMotionIntensity;
  productSafe: boolean;
  zoomStart: number;
  zoomEnd: number;
  xStart: number;
  xEnd: number;
  yStart: number;
  yEnd: number;
  timing: "smooth" | "settle" | "push_hold";
}

export const LOCAL_MOTION_KINDS: LocalMotionKind[] = [
  "push_in",
  "push_in_fast",
  "pull_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "diagonal",
  "arc",
  "macro_push",
  "hold",
];

export function isLocalMotionKind(value: unknown): value is LocalMotionKind {
  return typeof value === "string" && LOCAL_MOTION_KINDS.includes(value as LocalMotionKind);
}

export function isLocalMotionIntensity(value: unknown): value is LocalMotionIntensity {
  return value === "subtle" || value === "normal" || value === "strong";
}

const LEGACY_MAP: Record<string, LocalMotionKind> = {
  zoom_in_slow: "push_in",
  zoom_out_slow: "pull_out",
  pan_left: "pan_left",
  pan_right: "pan_right",
  ken_burns: "diagonal",
  bounce: "push_in_fast",
  static: "hold",
};

function cameraMotion(camera: string, seed: number): LocalMotionKind | undefined {
  const value = camera.trim().toLowerCase();
  if (!value) return undefined;

  // Physical rotation cannot be reconstructed from one image. An arc move suggests the
  // intended energy without warping the product itself.
  if (/环拍|环绕|绕拍|弧线|旋转|转台|orbit|arc|turntable|rotate/.test(value)) return "arc";
  if (/急速推|快速推|迅速推|crash\s*zoom|rapid\s*(push|zoom)|fast\s*(push|zoom)/.test(value)) return "push_in_fast";
  if (/拉远|后退|缩小|zoom\s*out|pull\s*out|dolly\s*out/.test(value)) return "pull_out";
  if (/微距|特写|细节|聚焦|macro|close[ -]?up|detail/.test(value)) return "macro_push";
  if (/推近|推进|靠近|zoom\s*in|push\s*in|dolly\s*in/.test(value)) return "push_in";
  if (/向左|左移|从右向左|pan\s*left|truck\s*left/.test(value)) return "pan_left";
  if (/向右|右移|从左向右|pan\s*right|truck\s*right/.test(value)) return "pan_right";
  if (/横移|平移|侧移|tracking|track|pan/.test(value)) return seed % 2 === 0 ? "pan_left" : "pan_right";
  if (/上升|抬升|向上|tilt\s*up|rise|crane\s*up/.test(value)) return "tilt_up";
  if (/下降|俯拍|向下|tilt\s*down|drop|crane\s*down/.test(value)) return "tilt_down";
  if (/静止|固定|定机位|锁定|static|locked|still/.test(value)) return "hold";
  if (/斜|对角|diagonal/.test(value)) return "diagonal";
  return undefined;
}

function typeMotion(shotType: string | undefined, seed: number): LocalMotionKind {
  switch (shotType) {
    case "hook":
      return "push_in_fast";
    case "pain_point":
      return seed % 2 === 0 ? "pan_left" : "pan_right";
    case "product_reveal":
      return "pull_out";
    case "demo":
      return "macro_push";
    case "social_proof":
      return "diagonal";
    case "cta":
      return "hold";
    default:
      return seed % 2 === 0 ? "push_in" : "diagonal";
  }
}

function alternateMotion(kind: LocalMotionKind, shotType: string | undefined, seed: number): LocalMotionKind {
  if (kind === "hold") return kind;
  const alternatives: Record<LocalMotionKind, LocalMotionKind[]> = {
    push_in: ["diagonal", "pan_right", "pan_left"],
    push_in_fast: ["push_in", "diagonal", "pan_right"],
    pull_out: ["diagonal", "pan_left", "pan_right"],
    pan_left: ["pan_right", "diagonal", "push_in"],
    pan_right: ["pan_left", "diagonal", "push_in"],
    tilt_up: ["diagonal", "push_in", "pan_right"],
    tilt_down: ["diagonal", "pull_out", "pan_left"],
    diagonal: ["push_in", "pan_left", "pan_right"],
    arc: ["diagonal", "pan_right", "push_in"],
    macro_push: ["pan_left", "pan_right", "diagonal"],
    hold: ["hold"],
  };
  const list = alternatives[kind];
  const preferred = typeMotion(shotType, seed);
  return preferred !== kind ? preferred : list[seed % list.length];
}

function selectKind(input: LocalMotionInput, previousKind?: LocalMotionKind, index = 0): LocalMotionKind {
  if (input.override && input.override !== "auto") return input.override;
  const seed = Math.abs(input.shotId ?? index + 1);
  const selected =
    cameraMotion(input.camera ?? "", seed) ??
    (input.legacyMotion ? LEGACY_MAP[input.legacyMotion] : undefined) ??
    typeMotion(input.shotType, seed);
  return selected === previousKind ? alternateMotion(selected, input.shotType, seed) : selected;
}

const INTENSITY_SCALE: Record<LocalMotionIntensity, number> = {
  subtle: 0.72,
  normal: 1,
  strong: 1.38,
};

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function createLocalMotionPlan(
  input: LocalMotionInput,
  previousKind?: LocalMotionKind,
  index = 0
): LocalMotionPlan {
  const kind = selectKind(input, previousKind, index);
  const intensity = input.intensity ?? "normal";
  const productSafe = input.productSafe !== false;
  const scale = INTENSITY_SCALE[intensity];
  const zoomCap = productSafe ? 1.22 : 1.34;
  const baseZoom = productSafe ? 1.045 : 1.08;
  const zoomDelta = (productSafe ? 0.12 : 0.19) * scale;
  const panSpan = Math.min(productSafe ? 0.54 : 0.78, (productSafe ? 0.4 : 0.58) * scale);
  const centered = { xStart: 0.5, xEnd: 0.5, yStart: 0.5, yEnd: 0.5 };

  const plan: LocalMotionPlan = {
    kind,
    intensity,
    productSafe,
    zoomStart: baseZoom,
    zoomEnd: Math.min(zoomCap, baseZoom + zoomDelta),
    ...centered,
    timing: "smooth",
  };

  switch (kind) {
    case "push_in_fast":
      plan.zoomStart = 1;
      plan.zoomEnd = Math.min(zoomCap, 1 + zoomDelta * 1.25);
      plan.timing = "push_hold";
      break;
    case "push_in":
      plan.zoomStart = 1;
      plan.timing = "settle";
      break;
    case "macro_push":
      plan.zoomStart = baseZoom;
      plan.zoomEnd = Math.min(zoomCap, baseZoom + zoomDelta * 1.15);
      plan.xStart = 0.44;
      plan.xEnd = 0.56;
      plan.yStart = 0.54;
      plan.yEnd = 0.46;
      plan.timing = "settle";
      break;
    case "pull_out":
      plan.zoomStart = Math.min(zoomCap, baseZoom + zoomDelta);
      plan.zoomEnd = 1;
      plan.timing = "settle";
      break;
    case "pan_left":
      plan.zoomStart = plan.zoomEnd = Math.min(zoomCap, baseZoom + zoomDelta * 0.55);
      plan.xStart = 0.5 + panSpan / 2;
      plan.xEnd = 0.5 - panSpan / 2;
      break;
    case "pan_right":
      plan.zoomStart = plan.zoomEnd = Math.min(zoomCap, baseZoom + zoomDelta * 0.55);
      plan.xStart = 0.5 - panSpan / 2;
      plan.xEnd = 0.5 + panSpan / 2;
      break;
    case "tilt_up":
      plan.zoomStart = plan.zoomEnd = Math.min(zoomCap, baseZoom + zoomDelta * 0.45);
      plan.yStart = 0.5 + panSpan / 2;
      plan.yEnd = 0.5 - panSpan / 2;
      break;
    case "tilt_down":
      plan.zoomStart = plan.zoomEnd = Math.min(zoomCap, baseZoom + zoomDelta * 0.45);
      plan.yStart = 0.5 - panSpan / 2;
      plan.yEnd = 0.5 + panSpan / 2;
      break;
    case "diagonal":
      plan.xStart = 0.5 - panSpan * 0.42;
      plan.xEnd = 0.5 + panSpan * 0.42;
      plan.yStart = 0.5 + panSpan * 0.28;
      plan.yEnd = 0.5 - panSpan * 0.28;
      break;
    case "arc":
      plan.zoomStart = plan.zoomEnd = Math.min(zoomCap, baseZoom + zoomDelta * 0.65);
      plan.xStart = 0.5 - panSpan * 0.42;
      plan.xEnd = 0.5 + panSpan * 0.42;
      plan.yStart = plan.yEnd = 0.5;
      break;
    case "hold":
      plan.zoomStart = plan.zoomEnd = 1;
      break;
  }

  return {
    ...plan,
    zoomStart: round(plan.zoomStart),
    zoomEnd: round(plan.zoomEnd),
    xStart: round(plan.xStart),
    xEnd: round(plan.xEnd),
    yStart: round(plan.yStart),
    yEnd: round(plan.yEnd),
  };
}

export function planLocalMotionSequence(inputs: LocalMotionInput[]): LocalMotionPlan[] {
  const plans: LocalMotionPlan[] = [];
  for (let i = 0; i < inputs.length; i += 1) {
    plans.push(createLocalMotionPlan(inputs[i], plans.at(-1)?.kind, i));
  }
  return plans;
}

function progressExpression(frames: number, timing: LocalMotionPlan["timing"]): string {
  const p = `min(max(on/${Math.max(1, frames - 1)},0),1)`;
  if (timing === "push_hold") return easeExpr(`min(${p}/0.78,1)`, "easeOut");
  if (timing === "settle") return easeExpr(p, "easeOut");
  return easeExpr(p, "easeInOut");
}

function interpolateExpression(from: number, to: number, progress: string): string {
  if (from === to) return String(from);
  return `(${from}+(${round(to - from)})*${progress})`;
}

/** Compile a motion plan to one deterministic FFmpeg zoompan filter. */
export function localMotionFilter(plan: LocalMotionPlan, width: number, height: number, duration: number): string {
  const fps = 30;
  const frames = Math.max(1, Math.round(duration * fps));
  const progress = progressExpression(frames, plan.timing);
  const zoom = interpolateExpression(plan.zoomStart, plan.zoomEnd, progress);
  const xFraction = interpolateExpression(plan.xStart, plan.xEnd, progress);
  const yFraction = plan.kind === "arc"
    ? `(0.5+${plan.productSafe ? "0.1" : "0.16"}*sin(PI*${progress}))`
    : interpolateExpression(plan.yStart, plan.yEnd, progress);
  const x = `(iw-iw/zoom)*${xFraction}`;
  const y = `(ih-ih/zoom)*${yFraction}`;
  return `zoompan=z='${zoom}':x='${x}':y='${y}':d=${frames}:s=${width}x${height}:fps=${fps}`;
}
