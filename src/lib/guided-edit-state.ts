import type { GuidedEditPlanDocument, GuidedTimelineClip } from "@/lib/guided-edit";

export interface GuidedEditInvalidation {
  analysis: boolean;
  voiceover: boolean;
  render: boolean;
}

export interface GuidedEditFingerprints {
  analysis: string;
  voiceover: string;
  render: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  const input = canonical(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function guidedEditFingerprints(document: GuidedEditPlanDocument): GuidedEditFingerprints {
  const renderInput = { ...document };
  delete renderInput.fingerprints;
  const sourceIds = [...new Set(document.timeline.map((clip) => clip.sourceId))].sort();
  const narration = document.beats.map(({ id, text, voiceoverText }) => ({
    id,
    text: voiceoverText ?? text,
  }));
  return {
    analysis: fingerprint(sourceIds),
    voiceover: fingerprint({
      narration,
      audioMode: document.brief.audioMode,
      speechRate: document.brief.speechRate ?? 1,
      voice: document.brief.voiceoverVoice,
      uploadedFile: document.brief.audioMode === "uploaded_voice" ? document.brief.voiceoverFile : undefined,
    }),
    render: fingerprint(renderInput),
  };
}

export function resequenceGuidedTimeline(
  document: GuidedEditPlanDocument,
  timeline: GuidedTimelineClip[],
): GuidedEditPlanDocument {
  let cursor = 0;
  const resequenced = timeline.map((clip) => {
    const duration = Math.max(0.04, clip.end - clip.start);
    const next = { ...clip, outputStart: cursor, outputEnd: cursor + duration };
    cursor += duration;
    return next;
  });
  const next: GuidedEditPlanDocument = {
    ...document,
    timeline: resequenced,
    outputDuration: cursor,
  };
  return { ...next, fingerprints: guidedEditFingerprints(next) };
}

export function moveGuidedTimelineClip(
  document: GuidedEditPlanDocument,
  clipId: string,
  targetIndex: number,
): GuidedEditPlanDocument {
  const sourceIndex = document.timeline.findIndex((clip) => clip.id === clipId);
  if (sourceIndex < 0) return document;
  const timeline = [...document.timeline];
  const [clip] = timeline.splice(sourceIndex, 1);
  const destination = Math.min(timeline.length, Math.max(0, Math.trunc(targetIndex)));
  timeline.splice(destination, 0, clip);
  return resequenceGuidedTimeline(document, timeline);
}

export function trimGuidedTimelineClip(
  document: GuidedEditPlanDocument,
  clipId: string,
  range: { start: number; end: number },
): GuidedEditPlanDocument {
  const clip = document.timeline.find((item) => item.id === clipId);
  if (!clip) return document;
  const scene = document.scenes.find((item) => item.id === clip.sceneId);
  const minimum = scene?.start ?? 0;
  const maximum = scene?.end ?? Number.POSITIVE_INFINITY;
  const start = Math.min(maximum, Math.max(minimum, Number(range.start)));
  const end = Math.min(maximum, Math.max(start, Number(range.end)));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.2) return document;
  return resequenceGuidedTimeline(document, document.timeline.map((item) =>
    item.id === clipId ? { ...item, start, end } : item
  ));
}

export function replaceGuidedTimelineClip(
  document: GuidedEditPlanDocument,
  clipId: string,
  sceneId: string,
): GuidedEditPlanDocument {
  const clip = document.timeline.find((item) => item.id === clipId);
  const scene = document.scenes.find((item) => item.id === sceneId && item.selected && item.label !== "unused");
  if (!clip || !scene) return document;
  const duration = Math.min(clip.end - clip.start, scene.end - scene.start);
  if (duration < 0.2) return document;
  return resequenceGuidedTimeline(document, document.timeline.map((item) =>
    item.id === clipId
      ? { ...item, sceneId: scene.id, start: scene.start, end: scene.start + duration }
      : item
  ));
}

export function guidedEditInvalidation(
  applied: GuidedEditPlanDocument,
  draft: GuidedEditPlanDocument,
): GuidedEditInvalidation {
  const before = guidedEditFingerprints(applied);
  const after = guidedEditFingerprints(draft);

  return {
    analysis: before.analysis !== after.analysis,
    voiceover: before.voiceover !== after.voiceover,
    render: before.render !== after.render,
  };
}
