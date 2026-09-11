// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("../llm-error", async importOriginal => ({ ...await importOriginal<typeof import("../llm-error")>(), createLLMClient: () => ({ withOptions: () => ({ chat: { completions: { create: request } } }) }) }));
import { EditModel, promotionCopyPrompt } from "../auto-edit/model";
import type { Analysis, EditBrief } from "../auto-edit/contract";
const config = { baseUrl: "http://localhost/v1", apiKey: "not-a-real-key", model: "text", visionModel: "vision" };
const jsonReply = (data: unknown) => ({ choices: [{ message: { content: JSON.stringify(data) } }] });
beforeEach(() => { request.mockReset(); });
describe("model protocol adapter", () => {
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
    model.calls = 24; await expect(model.json("test")).rejects.toThrow(/上限/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed or unknown model actions", async () => {
    request.mockResolvedValue(jsonReply({ tool: "shell", arguments: { command: "echo test" } }));
    await expect(new EditModel(config, new AbortController().signal).action("{}")).rejects.toThrow(/Unknown tool/);
  });
});
