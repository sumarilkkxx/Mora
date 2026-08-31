import { detectGuidedCaptionLanguage, type GuidedCaptionLanguage, type GuidedEditPlanDocument, type GuidedEditRole } from "@/lib/guided-edit";
import { chunkCaption, resolveChineseFontFamily } from "@/lib/video-composer/composer";
import type { KaraokeLine } from "@/lib/video-composer/karaoke";

export interface GuidedSubtitleStyle {
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
  marginV: number;
  language: GuidedCaptionLanguage;
}

const ROLE_TEXT_LIMIT: Record<GuidedEditRole, number> = {
  hook: 18,
  introduction: 24,
  feature: 24,
  usage: 24,
  cta: 18,
};

const NO_CARD_START = /^[。！？；，、：…!?;,.)\]】」』”’%]+/;
const ONLY_PUNCTUATION = /^[。！？；，、：…!?;,.)\]】」』”’%]+$/;

export function guidedSubtitleStyle(document: GuidedEditPlanDocument): GuidedSubtitleStyle {
  const ratio = document.brief.aspectRatio;
  const { width, height } = ratio === "16:9" ? { width: 1920, height: 1080 }
    : ratio === "1:1" ? { width: 1080, height: 1080 }
      : { width: 1080, height: 1920 };
  const scale = document.brief.captionSize === "small" ? 0.88 : document.brief.captionSize === "large" ? 1.15 : 1;
  const base = ratio === "9:16" ? 62 : ratio === "16:9" ? 56 : 54;
  const text = document.beats.map((beat) => beat.text).join(" ");
  const detected = detectGuidedCaptionLanguage(text);
  const language = document.brief.captionLanguage === "zh" || document.brief.captionLanguage === "en"
    ? document.brief.captionLanguage
    : detected;
  return {
    width,
    height,
    fontName: resolveChineseFontFamily(),
    fontSize: Math.round(base * scale),
    marginV: Math.round(height * (ratio === "9:16" ? 0.13 : 0.09)),
    language,
  };
}

function displayWeight(text: string): number {
  return Array.from(text).reduce((sum, character) => sum + (/[^\u0000-\u00ff]/.test(character) ? 1 : character === " " ? 0.28 : 0.55), 0);
}

function splitToWidth(text: string, maxWeight: number, language: GuidedCaptionLanguage, role: GuidedEditRole): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const roleLimit = ROLE_TEXT_LIMIT[role];
  const effectiveMax = language === "en" ? maxWeight : Math.min(maxWeight, roleLimit);
  if (displayWeight(clean) <= effectiveMax) return [clean];
  const units = language === "en" ? clean.split(/\s+/)
    : language === "mixed" ? clean.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]|[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*|[^\s]/gu) ?? []
      : Array.from(clean);
  const cards: string[] = [];
  let current = "";
  let previous = "";
  for (const unit of units) {
    const separator = language === "en" || (language === "mixed" && /^[A-Za-z0-9]/.test(previous) && /^[A-Za-z0-9]/.test(unit)) ? " " : "";
    const candidate = current ? `${current}${separator}${unit}` : unit;
    if (current && displayWeight(candidate) > effectiveMax && !NO_CARD_START.test(unit)) {
      cards.push(current);
      current = unit;
    } else {
      current = candidate;
    }
    previous = unit;
  }
  if (current) cards.push(current);
  return cards;
}

function repairCaptionParts(parts: string[]): string[] {
  const repaired: string[] = [];
  for (const raw of parts) {
    let part = raw.trim();
    if (!part) continue;
    const leading = part.match(NO_CARD_START)?.[0] ?? "";
    if (leading && repaired.length) {
      repaired[repaired.length - 1] += leading;
      part = part.slice(leading.length).trimStart();
    }
    if (!part) continue;
    if (ONLY_PUNCTUATION.test(part) && repaired.length) repaired[repaired.length - 1] += part;
    else repaired.push(part);
  }
  return repaired;
}

function allocateParts(parts: string[], startTime: number, endTime: number): KaraokeLine[] {
  const weights = parts.map((part) => Math.max(1, displayWeight(part)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(0.08, endTime - startTime);
  let cursor = startTime;
  return parts.map((text, index) => {
    const next = index === parts.length - 1 ? endTime : cursor + duration * weights[index] / totalWeight;
    const line = { text, startTime: cursor, endTime: next };
    cursor = next;
    return line;
  });
}

export function buildGuidedSubtitleLines(document: GuidedEditPlanDocument): KaraokeLine[] {
  const style = guidedSubtitleStyle(document);
  const maxWeight = style.width * 0.84 / style.fontSize;
  return document.beats.flatMap((beat) => {
    const clips = document.timeline.filter((clip) => clip.beatId === beat.id);
    if (!clips.length) return [];
    const start = Math.min(...clips.map((clip) => clip.outputStart));
    const end = Math.max(...clips.map((clip) => clip.outputEnd));
    const beatLanguage = document.brief.captionLanguage === "auto" ? detectGuidedCaptionLanguage(beat.text) : document.brief.captionLanguage;
    const cards = chunkCaption(beat.text, start, end).flatMap((card) => {
      const parts = repairCaptionParts(splitToWidth(card.text, maxWeight, beatLanguage, beat.role));
      if (parts.length <= 1) return [{ ...card, text: parts[0] ?? card.text }];
      return allocateParts(parts, card.startTime, card.endTime);
    });
    return cards;
  });
}
