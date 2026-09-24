// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("../llm-error", async importOriginal => ({ ...await importOriginal<typeof import("../llm-error")>(), createLLMClient: () => ({ withOptions: () => ({ chat: { completions: { create: request } } }) }) }));
import { conservativeInputTokenUpperBound, EditModel, promotionCopyPrompt } from "../auto-edit/model";
import { AUTO_EDIT_MODEL_CALL_LIMIT } from "../auto-edit/budget";
import type { Analysis, EditBrief } from "../auto-edit/contract";
import type { AutoEditObserver } from "../auto-edit/observer";
const config = { baseUrl: "http://localhost/v1", apiKey: "not-a-real-key", model: "text", visionModel: "vision" };
const jsonReply = (data: unknown) => ({ choices: [{ message: { content: JSON.stringify(data) } }] });
beforeEach(() => { request.mockReset(); });
describe("model protocol adapter", () => {
  it("uses a UTF-8 byte upper bound for multilingual input cost reservations", () => {
    const prompt = "中文预算必须保守".repeat(100);
    const estimate = conservativeInputTokenUpperBound([{ role: "user", content: prompt }], []);
    expect(estimate).toBeGreaterThan(new TextEncoder().encode(prompt).byteLength);
  });
  it("requests distinct promotion directions without a category-specific example", () => {
    const brief: EditBrief = { instruction: "", target: 15, aspect: "9:16", audio: "voiceover", style: "auto", captions: true, locale: "zh", promotion: { subject: "服务", audience: "", sellingPoints: "", action: "" } };
    const analysis: Analysis = { version: 1, summary: "visible result", style: "", scenes: [], speech: [], sampledAt: [], warnings: [] };
    const prompt = promotionCopyPrompt(brief, analysis);
    expect(prompt).toContain("effect"); expect(prompt).toContain("scenario"); expect(prompt).toContain("explore");
    expect(prompt).not.toContain("喜欢蓬松的大卷造型");
  });
  it("uses native tool schemas and dispatches only named tools", async () => {
    request.mockResolvedValue({ choices: [{ message: { tool_calls: [{ id: "render-1", type: "function", function: { name: "render_edit", arguments: "{}" } }] } }] });
    const model = new EditModel(config, new AbortController().signal);
    expect(await model.action("{}")).toEqual({ tool: "render_edit", arguments: {} });
    expect(request.mock.calls[0][0].tools.find((t: { function: { name: string } }) => t.function.name === "validate_edit_plan").function.parameters.required).toEqual(["plan"]);
    expect(request.mock.calls[0][0].parallel_tool_calls).toBe(false);
  });
  it("returns a standard tool result and removes the one-shot media-index tool", async () => {
    request
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "index-1", type: "function", function: { name: "get_media_index", arguments: "{}" } }] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "plan-1", type: "function", function: { name: "request_input", arguments: '{"reason":"test"}' } }] } }] });
    const model = new EditModel(config, new AbortController().signal);
    expect((await model.action("first")).tool).toBe("get_media_index");
    model.recordToolResult({ scenes: ["evidence"] });
    expect((await model.action("second")).tool).toBe("request_input");
    const second = request.mock.calls[1][0];
    expect(second.messages.some((m: { role: string; tool_call_id?: string }) => m.role === "tool" && m.tool_call_id === "index-1")).toBe(true);
    expect(second.tools.some((t: { function: { name: string } }) => t.function.name === "get_media_index")).toBe(false);
  });
  it("exposes only the actions allowed for the current execution stage", async () => {
    request.mockResolvedValue({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "finish-1", type: "function", function: { name: "finish", arguments: '{"needsReview":false,"reason":"checked"}' } }] } }] });
    const model = new EditModel(config, new AbortController().signal);
    expect((await model.action("{}", ["finish", "request_input"])).tool).toBe("finish");
    expect(request.mock.calls[0][0].tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["finish", "request_input"]);
    expect(request.mock.calls[0][0].messages[0].content).toContain("only actions allowed at this stage are: finish, request_input");
  });
  it("treats an autonomous evaluation brief as complete and accepts shorter verified output", async () => {
    request.mockResolvedValue({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "finish-1", type: "function", function: { name: "finish", arguments: '{"needsReview":true,"reason":"source shorter than target"}' } }] } }] });
    const model = new EditModel(config, new AbortController().signal, undefined, "autonomous");
    expect((await model.action("{}", ["finish"])).tool).toBe("finish");
    const system = request.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain("brief is authoritative and complete");
    expect(system).toContain("target is the maximum desired duration");
    expect(system).toContain("finish with needsReview=true");
  });
  it("uses the first valid call when a provider returns multiple tool calls despite parallel calls being disabled", async () => {
    request.mockResolvedValue({ choices: [{ message: { role: "assistant", tool_calls: [
      { id: "inspect-1", type: "function", function: { name: "inspect_video_segment", arguments: '{"start":0,"end":5}' } },
      { id: "inspect-2", type: "function", function: { name: "inspect_video_segment", arguments: '{"start":5,"end":10}' } },
    ] } }] });
    const model = new EditModel(config, new AbortController().signal);
    expect(await model.action("{}", ["inspect_video_segment"])).toEqual({ tool: "inspect_video_segment", arguments: { start: 0, end: 5 } });
  });
  it("rejects an out-of-stage action from JSON-only providers", async () => {
    request.mockRejectedValueOnce({ status: 400, message: "tool_choice unsupported" }).mockResolvedValue(jsonReply({ tool: "inspect_output", arguments: {} }));
    const model = new EditModel(config, new AbortController().signal);
    await expect(model.action("{}", ["finish"])).rejects.toThrow(/not allowed at the current stage/);
  });
  it("falls back to JSON actions only for tool capability rejection", async () => {
    request.mockRejectedValueOnce({ status: 400, message: "tool_choice unsupported" }).mockResolvedValue(jsonReply({ tool: "request_input", arguments: { reason: "素材不足" } }));
    const model = new EditModel(config, new AbortController().signal);
    expect((await model.action("{}")).tool).toBe("request_input");
    expect(model.jsonTools).toBe(true); expect(request.mock.calls[1][0].tools).toBeUndefined();
    request.mockReset().mockRejectedValue({ status: 401, message: "Unauthorized" });
    await expect(new EditModel(config, new AbortController().signal).action("{}")).rejects.toMatchObject({ status: 401 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("routes sampled images to the understanding model and enforces a shared call budget", async () => {
    request.mockResolvedValue(jsonReply({ summary: "test" }));
    const model = new EditModel(config, new AbortController().signal);
    await model.json("Analyze", [{ time: 2, url: "data:image/jpeg;base64,test" }]);
    expect(request.mock.calls[0][0].model).toBe("vision");
    expect(request.mock.calls[0][0].messages[0].content[1].text).toBe("Timestamp 2s");
    model.calls = AUTO_EDIT_MODEL_CALL_LIMIT; await expect(model.json("test")).rejects.toThrow(/上限/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed or unknown model actions", async () => {
    request.mockResolvedValue(jsonReply({ tool: "shell", arguments: { command: "echo test" } }));
    await expect(new EditModel(config, new AbortController().signal).action("{}")).rejects.toThrow(/Unknown tool/);
  });
  it("reports model usage and selected tools through the optional observer", async () => {
    request.mockResolvedValue({
      choices: [{ message: { tool_calls: [{ id: "finish-1", type: "function", function: { name: "finish", arguments: '{"needsReview":false,"reason":"checked"}' } }] } }],
      usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200 },
    });
    const events: Array<{ type: string; value?: unknown }> = [];
    const observer: AutoEditObserver = {
      beginModelCall: input => { events.push({ type: "begin", value: input }); return { id: "call-1", maxOutputTokens: 321 }; },
      completeModelCall: (id, usage) => events.push({ type: "complete", value: { id, usage } }),
      failModelCall: (id, error) => events.push({ type: "fail", value: { id, error } }),
      recordToolDecision: (id, input) => events.push({ type: "tool", value: { id, input } }),
    };
    const model = new EditModel(config, new AbortController().signal, observer);
    expect((await model.action("{}", ["finish"])).tool).toBe("finish");
    expect(events).toMatchObject([
      { type: "begin", value: { stage: "agent_action", model: "text", vision: false, allowedTools: ["finish"] } },
      { type: "complete", value: { id: "call-1", usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200 } } },
      { type: "tool", value: { id: "call-1", input: { tool: "finish", allowed: true, arguments: { needsReview: false, reason: "checked" } } } },
    ]);
    expect(request.mock.calls[0][0].max_tokens).toBe(321);
  });
  it("lets an observer reject a request before contacting the provider", async () => {
    const observer: AutoEditObserver = {
      beginModelCall: () => { throw new Error("budget stop limit"); },
      completeModelCall: () => {},
      failModelCall: () => {},
      recordToolDecision: () => {},
    };
    const model = new EditModel(config, new AbortController().signal, observer);
    await expect(model.action("{}", ["finish"])).rejects.toThrow(/stop limit/);
    expect(request).not.toHaveBeenCalled();
  });
});
