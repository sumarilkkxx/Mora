import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyStage, PlanStage, ResultStage, SourceStage } from "./edit-stages";
import { TaskFeedback, WorkflowSteps } from "./workspace-chrome";
import { initialDraft, type EditRun } from "@/lib/auto-edit/workspace";
import type { EditPlan } from "@/lib/auto-edit/contract";

vi.mock("motion/react", () => ({ useReducedMotion: () => true, motion: { span: ({ children, className }: { children: React.ReactNode; className: string }) => <span className={className}>{children}</span> } }));
const plan: EditPlan = { version: 1, title: "Plan A", explanation: "Compare this edit", clips: [{ sourceId: "source", start: 0, end: 5, speed: 1, fit: "contain", transition: "cut", text: "Approved copy", reason: "Opening", evidence: "Scene" }] };
const draft = initialDraft(undefined, "source", false);
const run: EditRun = { id: "render", sourceId: "source", status: "done", stage: "done", brief: draft.brief, quality: "720p", url: "/video.mp4", error: null, checkpoint: { history: [], repairs: 0, plan, promotionCopy: { ...draft.copy, voiceover: "Approved copy" } } };
let host: HTMLDivElement;
let root: Root;
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
const click = async (element: Element) => { await act(async () => (element as HTMLElement).click()); };
const button = (text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.includes(text))!;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("AI edit decisions and recovery", () => {
  it("selecting a plan does not generate until explicitly confirmed", async () => {
    const choose = vi.fn();
    await render(<PlanStage plans={[plan, { ...plan, title: "Plan B" }]} en={false} locked={false} onBack={vi.fn()} onChoose={choose} />);
    expect(button("按此方案").disabled).toBe(true);
    await click(host.querySelectorAll('input[type="radio"]')[1]);
    expect(choose).not.toHaveBeenCalled();
    expect(button("按此方案").disabled).toBe(false);
    await click(button("按此方案"));
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ title: "Plan B" }));
  });
  it("has one authoritative copy editor and refuses empty copy", async () => {
    await render(<CopyStage draft={draft} run={run} en={false} locked={false} saved="Saved" onBack={vi.fn()} onChange={vi.fn()} onApprove={vi.fn()} />);
    expect(host.querySelectorAll("textarea")).toHaveLength(1);
    expect(button("确认文案，").disabled).toBe(true);
  });
  it("keeps original playback/download while an HD task fails and can resume it", async () => {
    const retry = vi.fn();
    const hd: EditRun = { ...run, id: "hd", parentId: run.id, status: "failed", url: null, error: "Render failed", quality: "1080p", checkpoint: { ...run.checkpoint, operation: "export" } };
    await render(<ResultStage run={run} exportRun={hd} en={false} locked={false} onBack={vi.fn()} onExport={vi.fn()} onRetry={retry} onCancel={vi.fn()} />);
    expect(host.querySelector("video")?.getAttribute("src")).toBe("/video.mp4");
    expect(host.querySelector('a[href="/video.mp4?download=1"]')).not.toBeNull();
    expect(button("生成 1080p").disabled).toBe(true);
    await click(button("继续当前阶段"));
    expect(retry).toHaveBeenCalledWith(hd);
  });
  it("displays actual review issues even when a playable result exists", async () => {
    await render(<ResultStage run={{ ...run, status: "needs_review", checkpoint: { ...run.checkpoint, checks: { technical: true, review: ["字幕需要检查"], issues: [], duration: 15 } } }} en={false} locked={false} onBack={vi.fn()} onExport={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} />);
    expect(host.textContent).toContain("成片已生成 · 待复核");
    expect(host.textContent).toContain("字幕需要检查");
  });
  it("shows cancel and prevents repeated cancellation while stopping", async () => {
    const cancel = vi.fn();
    await render(<TaskFeedback run={{ ...run, status: "running", url: null }} en={false} busy={false} onRetry={vi.fn()} onCancel={cancel} />);
    await click(button("停止本次任务")); expect(cancel).toHaveBeenCalledOnce();
    await render(<TaskFeedback run={{ ...run, status: "cancel_requested", url: null }} en={false} busy={false} onRetry={vi.fn()} onCancel={cancel} />);
    expect(button("停止本次任务").disabled).toBe(true);
  });
  it("preserves completed labels when navigating back and disables unavailable stages", async () => {
    await render(<WorkflowSteps selected={0} progress={2} complete={[true, true, false, false]} available={[true, true, true, false]} running en={false} review={false} onSelect={vi.fn()} />);
    expect(button("素材与目标").getAttribute("aria-current")).toBe("step");
    expect(button("素材与目标").textContent).toContain("已完成");
    expect(button("选择方案").textContent).toContain("处理中");
    expect(button("预览导出").disabled).toBe(true);
  });
  it("explains missing setup and source instead of offering a dead primary action", async () => {
    await render(<SourceStage sources={[]} draft={draft} en={false} locked={false} configured={false} uploading={false} musicUploading={false} musicError="" onChange={vi.fn()} onUpload={vi.fn()} onMusic={vi.fn()} onSubmit={vi.fn()} />);
    expect(button("分析素材，").disabled).toBe(true);
    expect(host.textContent).toContain("请先添加视频素材");
    expect(host.querySelector('a[href="/settings?tab=llm"]')).not.toBeNull();
  });
});
