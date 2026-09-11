import { describe, expect, it } from "vitest";
import { briefChanged, canRetry, completedSteps, draftChanged, exportFor, initialDraft, isActive, playableRun, plansFor, readDraft, requiresReview, runStep, type EditRun } from "../auto-edit/workspace";
import { fallbackCandidatePlans } from "../auto-edit/planning";
import type { Analysis, EditPlan } from "../auto-edit/contract";

const plan: EditPlan = { version: 1, title: "Plan", explanation: "Source", clips: [{ sourceId: "source", start: 0, end: 5, speed: 1, fit: "contain", transition: "cut", text: "Approved", reason: "Opening", evidence: "Source scene" }] };
function run(id: string, patch: Partial<EditRun> = {}): EditRun {
  return { id, sourceId: "source", status: "done", stage: "done", brief: initialDraft(undefined, "source", false).brief,
    checkpoint: { operation: "manual", plan, history: [], repairs: 0 }, url: `/video/${id}.mp4`, error: null, quality: "720p", ...patch };
}
describe("editing workspace state", () => {
  it("keeps the playable original throughout exporting, failure and cancellation", () => {
    const original = run("original");
    for (const status of ["queued", "running", "failed", "interrupted", "cancel_requested", "cancelled"] as const) {
      const hd = run("hd", { parentId: original.id, status, url: null, quality: "1080p", checkpoint: { ...original.checkpoint, operation: "export" } });
      expect(playableRun(hd, [hd, original])).toBe(original);
      expect(exportFor(original, [hd, original])).toBe(hd);
    }
    expect(playableRun(run("new-edit", { parentId: original.id, url: null }), [original])).toBeUndefined();
  });
  it("reuses HD only for the same parent, source, brief and timeline", () => {
    const original = run("original");
    const hd = run("hd", { parentId: original.id, quality: "1080p", checkpoint: { ...original.checkpoint, operation: "export" } });
    expect(exportFor(original, [hd])).toBe(hd);
    for (const change of [{ parentId: "another" }, { sourceId: "another" }, { brief: { ...hd.brief, instruction: "changed" } }, { checkpoint: { ...hd.checkpoint, plan: { ...plan, clips: [] } } }]) {
      expect(exportFor(original, [{ ...hd, ...change }])).toBeUndefined();
    }
  });
  it("finds candidate ancestors and tolerates malformed cyclic lineage", () => {
    const parent = run("parent", { checkpoint: { history: [], repairs: 0, candidates: [plan] } });
    const child = run("child", { parentId: parent.id });
    expect(plansFor(child, [parent, child])).toEqual([plan]);
    expect(plansFor(run("loop", { parentId: "loop", checkpoint: { history: [], repairs: 0 } }), [])).toEqual([]);
  });
  it("separates completion, review and recoverable states", () => {
    expect(completedSteps(run("video"), [plan])).toEqual([false, true, true, true]);
    expect(runStep(run("analysis", { url: null, checkpoint: { operation: "analysis", history: [], repairs: 0 } }))).toBe(1);
    expect(runStep(run("plans", { url: null, checkpoint: { operation: "candidates", history: [], repairs: 0 } }))).toBe(2);
    expect(requiresReview(run("review", { status: "needs_review" }))).toBe(true);
    expect(requiresReview(run("review", { checkpoint: { history: [], repairs: 0, checks: { technical: true, issues: [], review: ["Check captions"], duration: 15 } } }))).toBe(true);
    for (const status of ["failed", "interrupted", "cancelled"] as const) expect(canRetry(run(status, { status }))).toBe(true);
    expect(isActive(run("cancel", { status: "cancel_requested" }))).toBe(true);
    expect(canRetry(run("review", { status: "needs_review" }))).toBe(false);
  });
  it("persists valid drafts and rejects corrupt storage without discarding server data", () => {
    const base = initialDraft(run("copy"), "source", false);
    expect(readDraft(JSON.stringify(base))).toEqual(base);
    for (const bad of [null, "{", "null", JSON.stringify({ ...base, brief: { target: 90 } })]) expect(readDraft(bad)).toBeUndefined();
    const copy = { ...base, copy: { ...base.copy, voiceover: "Edited copy" } };
    expect(draftChanged(copy, base)).toBe(true);
    expect(briefChanged(copy, base)).toBe(false);
    expect(briefChanged({ ...copy, sourceId: "new-source" }, base)).toBe(true);
  });
  it("restores the approved candidate instead of resetting to the model recommendation", () => {
    const base = initialDraft(undefined, "source", false);
    const recommended = { ...base.copy, id: "effect", recommended: true, hook: "A", body: "B", cta: "C", voiceover: "A\nB\nC", evidence: ["frame"] };
    const approved = { ...recommended, id: "scenario", recommended: false, hook: "D", voiceover: "D\nB\nC" };
    const saved = run("selected", { checkpoint: { history: [], repairs: 0, promotionCandidates: [recommended, approved], recommendedCopyId: "effect", promotionCopy: approved } });
    expect(initialDraft(saved, "source", false).copy.id).toBe("scenario");
  });
  it("uses approved one-sentence copy instead of stale creative references", () => {
    const draft = initialDraft(undefined, "source", false);
    const copy = { ...draft.copy, hook: "Stale hook", body: "Stale body", cta: "Stale CTA", voiceover: "唯一确认的完整文案。" };
    const analysis: Analysis = { version: 1, summary: "Source", style: "", scenes: [], speech: [], sampledAt: [], warnings: [] };
    for (const candidate of fallbackCandidatePlans("source", 20, draft.brief, analysis, copy)) {
      expect(candidate.clips.map(clip => clip.text).filter(Boolean)).toEqual(["唯一确认的完整文案"]);
    }
  });
});
