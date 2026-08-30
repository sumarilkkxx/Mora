import { describe, expect, it } from "vitest";
import { normalizeProductionMode, productionModeForVideoOrigin, projectContinuePath, projectScriptReviewPath } from "./production-mode";

describe("production mode", () => {
  it("defaults legacy and invalid projects to the local workflow", () => {
    expect(normalizeProductionMode(undefined)).toBe("local");
    expect(normalizeProductionMode("unknown")).toBe("local");
  });

  it("preserves the AI workflow selection", () => {
    expect(normalizeProductionMode("ai")).toBe("ai");
  });

  it("classifies workflow from final-video origin, not asset provenance", () => {
    expect(productionModeForVideoOrigin("local_render", "ai")).toBe("local");
    expect(productionModeForVideoOrigin("cloud_ai", "local")).toBe("ai");
    expect(productionModeForVideoOrigin(undefined, "ai")).toBe("ai");
  });

  it("resumes local composing projects in the compose workspace", () => {
    expect(projectContinuePath("p1", "composing", "local")).toBe("/project/p1/compose");
    expect(projectContinuePath("p1", "video", "local")).toBe("/project/p1/compose");
  });

  it("keeps AI projects in AI production until an output exists", () => {
    expect(projectContinuePath("p1", "assets", "ai")).toBe("/project/p1/assets");
    expect(projectContinuePath("p1", "video", "ai")).toBe("/project/p1/ai-video");
    expect(projectContinuePath("p1", "done", "ai")).toBe("/project/p1/export");
  });

  it("keeps guided editing and script entry behavior compatible", () => {
    expect(projectContinuePath("p1", "draft", "local", "edit")).toBe("/project/p1/edit");
    expect(projectContinuePath("p1", "scripting", "ai")).toBe("/project/p1/script");
  });

  it("lands newly generated scripts on review without an auto-run query", () => {
    expect(projectScriptReviewPath("p1")).toBe("/project/p1/script");
    expect(projectScriptReviewPath("p1", "host/a")).toBe("/project/p1/script?presenter=host%2Fa");
  });
});
