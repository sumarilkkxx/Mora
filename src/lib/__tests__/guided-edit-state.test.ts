import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUIDED_EDIT_BRIEF,
  createGuidedEditPlan,
  guidedNarrationText,
  type GuidedEditPlanDocument,
} from "@/lib/guided-edit";
import { guidedEditFingerprints, guidedEditInvalidation, moveGuidedTimelineClip, replaceGuidedTimelineClip, trimGuidedTimelineClip } from "@/lib/guided-edit-state";

function plan(): GuidedEditPlanDocument {
  return createGuidedEditPlan({
    brief: { ...DEFAULT_GUIDED_EDIT_BRIEF, audioMode: "local_voice" },
    scenes: [{ id: "scene-1", start: 0, end: 6, label: "highlight", selected: true }],
    sourceId: "source-1",
    sourceDuration: 6,
    existingBeats: [{ id: "beat-1", role: "hook", text: "原始旁白", captionText: "原始字幕", estimatedDuration: 3, sceneIds: ["scene-1"] }],
  });
}

describe("guided edit state", () => {
  it("invalidates only render output when subtitle text changes", () => {
    const applied = plan();
    const draft = structuredClone(applied);
    draft.beats[0].captionText = "修改后的字幕";

    expect(guidedEditInvalidation(applied, draft)).toEqual({
      analysis: false,
      voiceover: false,
      render: true,
    });
  });

  it("invalidates voiceover and render when narration changes", () => {
    const applied = plan();
    const draft = structuredClone(applied);
    draft.beats[0].voiceoverText = "修改后的旁白";

    expect(guidedEditInvalidation(applied, draft)).toEqual({
      analysis: false,
      voiceover: true,
      render: true,
    });
  });

  it("keeps analysis and voiceover fingerprints stable for a caption-only edit", () => {
    const applied = plan();
    const draft = structuredClone(applied);
    draft.beats[0].captionText = "只修改字幕";

    const before = guidedEditFingerprints(applied);
    const after = guidedEditFingerprints(draft);
    expect(after.analysis).toBe(before.analysis);
    expect(after.voiceover).toBe(before.voiceover);
    expect(after.render).not.toBe(before.render);
  });

  it("persists reproducible fingerprints in a newly compiled edit plan", () => {
    const current = plan();
    expect(current.fingerprints).toEqual(guidedEditFingerprints(current));
  });

  it("builds synthesis input from narration overrides instead of captions", () => {
    const current = plan();
    current.beats[0].voiceoverText = "旁白版本";
    current.beats[0].captionText = "字幕版本";

    expect(guidedNarrationText(current.beats)).toBe("旁白版本");
  });

  it("reorders shot cards and recomputes the read-only output timeline", () => {
    const current = plan();
    current.timeline = [
      { ...current.timeline[0], id: "clip-1", start: 0, end: 1, outputStart: 0, outputEnd: 1 },
      { ...current.timeline[0], id: "clip-2", start: 3, end: 5, outputStart: 1, outputEnd: 3 },
    ];
    current.outputDuration = 3;

    const moved = moveGuidedTimelineClip(current, "clip-2", 0);
    expect(moved.timeline.map((clip) => clip.id)).toEqual(["clip-2", "clip-1"]);
    expect(moved.timeline.map((clip) => [clip.outputStart, clip.outputEnd])).toEqual([[0, 2], [2, 3]]);
    expect(moved.timeline.map((clip) => [clip.start, clip.end])).toEqual([[3, 5], [0, 1]]);
    expect(moved.outputDuration).toBe(3);
  });

  it("updates a shot in/out range and shifts only the following output positions", () => {
    const current = plan();
    current.scenes = [{ id: "scene-1", start: 0, end: 6, label: "highlight", selected: true }];
    current.timeline = [
      { ...current.timeline[0], id: "clip-1", start: 0, end: 2, outputStart: 0, outputEnd: 2 },
      { ...current.timeline[0], id: "clip-2", start: 3, end: 6, outputStart: 2, outputEnd: 5 },
    ];
    current.outputDuration = 5;

    const trimmed = trimGuidedTimelineClip(current, "clip-2", { start: 3.5, end: 4.5 });
    expect(trimmed.timeline[0]).toMatchObject({ outputStart: 0, outputEnd: 2 });
    expect(trimmed.timeline[1]).toMatchObject({ start: 3.5, end: 4.5, outputStart: 2, outputEnd: 3 });
    expect(trimmed.outputDuration).toBe(3);
  });

  it("replaces one shot from analyzed scenes without invalidating source analysis", () => {
    const current = plan();
    current.scenes.push({ id: "scene-2", start: 3, end: 5, label: "product_detail", selected: true });

    const replaced = replaceGuidedTimelineClip(current, current.timeline[0].id, "scene-2");
    expect(replaced.timeline[0]).toMatchObject({ sceneId: "scene-2", start: 3, end: 5 });
    expect(guidedEditInvalidation(current, replaced)).toEqual({
      analysis: false,
      voiceover: false,
      render: true,
    });
  });

  it("preserves a validated card timeline when recompiling a saved draft", () => {
    const current = plan();
    const saved = createGuidedEditPlan({
      brief: current.brief,
      scenes: current.scenes,
      sourceId: "source-1",
      sourceDuration: 6,
      existingBeats: current.beats,
      timeline: [{ ...current.timeline[0], start: 2, end: 4, outputStart: 99, outputEnd: 101 }],
    });

    expect(saved.timeline[0]).toMatchObject({ start: 2, end: 4, outputStart: 0, outputEnd: 2 });
    expect(saved.outputDuration).toBe(2);
  });
});
