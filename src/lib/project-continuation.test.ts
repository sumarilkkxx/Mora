import { describe, expect, it } from "vitest";
import { resolveProjectContinuation } from "./project-continuation";

const base = {
  projectId: "p1",
  workflowType: "generate",
  workflowMode: null,
  productionMode: "local",
  projectStatus: "draft",
} as const;

describe("resolveProjectContinuation", () => {
  it("keeps the explicitly selected editing workflow across an empty first load", () => {
    expect(resolveProjectContinuation({ ...base, workflowType: "edit", workflowMode: "auto_edit" })).toMatchObject({
      mode: "auto_edit", stage: "source", href: "/project/p1/auto-edit",
    });
    expect(resolveProjectContinuation({ ...base, workflowType: "edit", workflowMode: "guided_edit" })).toMatchObject({
      mode: "guided_edit", href: "/project/p1/edit",
    });
    expect(resolveProjectContinuation({ ...base, workflowType: "edit", workflowMode: "transcript_edit" })).toMatchObject({
      mode: "transcript_edit", href: "/project/p1/transcript",
    });
  });

  it("resumes an auto edit from its persisted run instead of the generic edit page", () => {
    expect(resolveProjectContinuation({
      ...base,
      workflowType: "edit",
      latestAutoEditRun: { id: "run/one", stage: "render", status: "failed" },
    })).toEqual({
      mode: "auto_edit",
      stage: "render",
      operation: { id: "run/one", status: "failed", resumable: true },
      href: "/project/p1/auto-edit?run=run%2Fone",
    });
  });

  it("uses persisted guided and transcript evidence for legacy edit projects", () => {
    expect(resolveProjectContinuation({
      ...base,
      workflowType: "edit",
      latestGuidedPlan: { id: "plan", status: "rendering" },
    })).toMatchObject({ mode: "guided_edit", stage: "rendering", href: "/project/p1/edit" });
    expect(resolveProjectContinuation({
      ...base,
      workflowType: "edit",
      latestMediaEdit: { id: "revision", status: "failed" },
    })).toMatchObject({ mode: "transcript_edit", stage: "failed", href: "/project/p1/transcript" });
  });

  it("uses concrete script, asset and composition evidence before stale project status", () => {
    expect(resolveProjectContinuation({ ...base, projectStatus: "done", hasScript: true })).toMatchObject({
      mode: "local_generate", stage: "assets", href: "/project/p1/assets",
    });
    expect(resolveProjectContinuation({ ...base, projectStatus: "draft", hasScript: true, hasAssets: true })).toMatchObject({
      mode: "local_generate", stage: "compose", href: "/project/p1/compose",
    });
    expect(resolveProjectContinuation({
      ...base,
      workflowMode: "cloud_generate",
      latestComposition: { id: "composition", status: "composing", videoOrigin: "cloud_ai" },
    })).toMatchObject({ mode: "cloud_generate", stage: "render", href: "/project/p1/ai-video" });
    expect(resolveProjectContinuation({
      ...base,
      projectStatus: "draft",
      latestComposition: { id: "composition", status: "done", videoOrigin: "local_render" },
    })).toMatchObject({ mode: "local_generate", stage: "export", href: "/project/p1/export" });
  });

  it("falls back compatibly for legacy projects with no detailed evidence", () => {
    expect(resolveProjectContinuation({ ...base, workflowType: "edit" })).toMatchObject({ mode: "guided_edit", href: "/project/p1/edit" });
    expect(resolveProjectContinuation({ ...base, projectStatus: "scripting" })).toMatchObject({ mode: "local_generate", href: "/project/p1/script" });
    expect(resolveProjectContinuation({ ...base, productionMode: "ai", projectStatus: "video" })).toMatchObject({ mode: "cloud_generate", href: "/project/p1/ai-video" });
  });

  it.each([
    ["auto_edit", { latestAutoEditRun: { id: "auto", stage: "analysis", status: "running" } }, "/project/p1/auto-edit?run=auto"],
    ["guided_edit", { latestGuidedPlan: { id: "guided", status: "failed" } }, "/project/p1/edit"],
    ["transcript_edit", { latestMediaEdit: { id: "transcript", status: "rendering" } }, "/project/p1/transcript"],
    ["local_generate", { latestComposition: { id: "local", status: "failed", videoOrigin: "local_render" } }, "/project/p1/compose"],
    ["cloud_generate", { latestComposition: { id: "cloud", status: "failed", videoOrigin: "cloud_ai" } }, "/project/p1/ai-video"],
  ] as const)("keeps %s on its recoverable route for running or failed persisted work", (mode, evidence, href) => {
    expect(resolveProjectContinuation({ ...base, projectStatus: "draft", ...evidence })).toMatchObject({ mode, href });
  });
});
