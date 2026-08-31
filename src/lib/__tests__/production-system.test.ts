import { describe, expect, it } from "vitest";
import {
  buildPreviewPlan,
  buildVersionTree,
  buildWorkflowPlan,
  checkPromptConsistency,
  compileCreativePrompt,
  diagnoseGenerationFailure,
  estimateProduction,
  repairPlanFromQc,
  routeModel,
  semanticAssetFromRecord,
} from "@/lib/production-system";

describe("production system contracts", () => {
  it("compiles provider-neutral intent and continuity constraints", () => {
    const out = compileCreativePrompt({ subject: "red bottle", lighting: "soft daylight", continuity: ["same label"], negative: ["warped logo"] });
    expect(out.prompt).toContain("Continuity anchors: same label");
    expect(out.negativePrompt).toBe("warped logo");
  });

  it("builds a skippable workflow and honest cost range", () => {
    const workflow = buildWorkflowPlan({ hasSourceMedia: true, aiKeyframes: true, aiMotion: true, nativeAudio: false });
    const cost = estimateProduction({ shotCount: 4, workflow, imageUnitUsd: 0.03 });
    expect(workflow.find((s) => s.id === "voice")?.enabled).toBe(true);
    expect(cost.knownUsd).toBe(0.12);
    expect(cost.unknownCalls).toBe(5); // analysis + four unknown-price video calls
    expect(cost.rangeUsd.max).toBeGreaterThan(cost.rangeUsd.min);
  });

  it("routes by hard capabilities before a soft goal", () => {
    const result = routeModel([
      { id: "cheap", name: "Cheap", modes: ["image-to-video"], pricePerCall: 0.01, supportsLastFrame: false },
      { id: "steady", name: "Steady", modes: ["image-to-video"], pricePerCall: 0.2, supportsLastFrame: true },
    ], { mode: "image-to-video", goal: "cost", requireLastFrame: true });
    expect(result.selected?.id).toBe("steady");
  });

  it("diagnoses paid task detachment without recommending resubmission", () => {
    expect(diagnoseGenerationFailure("poll timeout; taskId=abc")).toMatchObject({ code: "paid-task-detached", actions: ["resume-task"] });
  });

  it("detects missing and forbidden consistency anchors", () => {
    const issues = checkPromptConsistency("woman holding blue box", {
      characterAnchors: ["black bob"], productAnchors: ["blue box"], wardrobeAnchors: [], environmentAnchors: [], lightingAnchors: [], forbiddenChanges: ["blue box"],
    });
    expect(issues.map((i) => i.kind)).toEqual(["missing-anchor", "forbidden-change"]);
  });

  it("derives semantic assets, version history, preview and QC repairs", () => {
    expect(semanticAssetFromRecord({ id: "a", shotId: 1, type: "user_upload", filePath: "a.mp4", prompt: "coffee table warm light" })).toMatchObject({ mediaType: "video", commercialStatus: "owned" });
    const tree = buildVersionTree({ scripts: [{ id: "s", version: 2, selected: true }], assets: [], tasks: [], compositions: [{ id: "c", status: "done", label: "final" }] });
    expect(tree.generations[0].label).toBe("final");
    expect(buildPreviewPlan({ duration: 60, hasGeneratedMotion: false })).toEqual({ resolution: "720p", videoPreset: "veryfast", crf: 26, paidStagesSkipped: ["motion"] });
    const repairs = repairPlanFromQc({ status: "warn", probe: { hasVideo: true, hasAudio: true, width: 1, height: 1, duration: 1 }, signals: { black: [], silence: [], freeze: [], loudness: -20, truePeak: null }, checks: [{ id: "loudness", level: "warn", message: { zh: "", en: "" } }] });
    expect(repairs[0]).toMatchObject({ stage: "compose", action: "remix-audio", automatic: true });
  });
});
