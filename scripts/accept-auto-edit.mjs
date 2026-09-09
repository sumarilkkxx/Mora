/** Local acceptance only: synthetic footage + localhost model/TTS, no user media or remote AI. */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const execute = promisify(execFile);
const base = process.env.MORA_ACCEPT_URL || "http://localhost:3000";
const directory = join(process.cwd(), "data", "acceptance", "auto-edit");
await mkdir(directory, { recursive: true });
const sourceFile = join(directory, "synthetic.mp4"), voiceFile = join(directory, "synthetic-voice.mp3");
await execute(require("ffmpeg-static"), ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=32", "-an", "-c:v", "libx264", sourceFile]);
await execute(require("ffmpeg-static"), ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100:duration=0.8", voiceFile]);
const original = await readFile(sourceFile), voice = await readFile(voiceFile);
const hash = createHash("sha256").update(original).digest("hex");
let calls = 0, jsonFallbacks = 0, sourceId;
const planFor = (id, offset = 0, target = 15) => ({ version: 1, title: `本地验收方案 ${offset + 1}`, explanation: "模拟模型选择不同原片段；只验收执行链路，不代表真实模型效果。", clips: [0, 1, 2].map(i => ({ sourceId: id, start: i * 7 + offset, end: i * 7 + offset + (target === 15 ? 4 : 6), speed: 1, fit: i % 2 ? "cover" : "contain", transition: "cut", text: `验收画面 ${i + 1}`, reason: "人工测试样本", evidence: `${i * 7 + offset}s` })) });
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (req.url.endsWith("/audio/speech")) { res.writeHead(200, { "Content-Type": "audio/mpeg" }); res.end(voice); return; }
    calls++;
    // Exercise the JSON-action compatibility fallback using a real HTTP error response.
    if (body.tools) { jsonFallbacks++; res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "Tools unsupported by this test provider", type: "invalid_request_error" } })); return; }
    const last = body.messages.at(-1).content;
    const prompt = typeof last === "string" ? last : last.find(c => c.type === "text").text;
    let answer;
    if (prompt.startsWith("Analyze timestamped")) {
      const times = last.filter(c => c.type === "text" && c.text.startsWith("Timestamp ")).map(c => Number(c.text.match(/[\d.]+/)[0]));
      answer = { summary: "人工生成的测试图案", style: "合成图案", scenes: [{ start: times[0], end: Math.min(32, times.at(-1) + 0.03), text: "动态测试图案", uncertainty: "用于本地接口验收" }] };
    } else if (prompt.startsWith("Review these output")) answer = { issues: [], summary: "模拟检查通过（不代表真实语义审核）" };
    else if (prompt.startsWith("Create up to 3")) answer = { plans: [0, 1, 2].map(offset => planFor(sourceId, offset)) };
    else {
      const c = JSON.parse(prompt);
      if (!c.currentPlan) answer = { tool: "validate_edit_plan", arguments: { plan: planFor(c.sourceId, 0, c.brief.target) } };
      else if (!c.render) answer = { tool: "render_edit", arguments: {} };
      else if (!c.render.inspected) answer = { tool: "inspect_output", arguments: {} };
      else answer = { tool: "finish", arguments: { needsReview: false, reason: "本地模拟链路验收完成" } };
    }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: randomUUID(), object: "chat.completion", created: Math.floor(Date.now()/1000), model: "local-test", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }] }));
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const credentials = { llm: { baseUrl: endpoint, apiKey: "local-acceptance-only", model: "test-text", visionModel: "test-vision" }, tts: { provider: "openai", baseUrl: endpoint, apiKey: "local-acceptance-only", model: "test-voice", voice: "test" } };
async function request(path, body, options) {
  const response = await fetch(base + path, options || (body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}));
  const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data)); return data;
}
try {
  const project = await request("/api/project", { name: "AI 自动剪辑 · 本地验收（合成素材）", workflowType: "edit" });
  const media = await request(`/api/project/${project.id}/media`, null, { method: "POST", headers: { "Content-Type": "video/mp4", "x-file-name": "synthetic-acceptance.mp4" }, body: original });
  sourceId = media.id;
  const path = `/api/project/${project.id}/auto-edit`;
  const brief = { instruction: "本地模拟验收：按原始合成图案剪辑，不调用外部模型。", target: 15, aspect: "9:16", audio: "muted", style: "highlights", captions: true, locale: "zh" };
  async function wait(id) {
    for (let n = 0; n < 180; n++) {
      const row = (await request(path)).runs.find(r => r.id === id);
      if (!["queued", "running", "cancel_requested"].includes(row.status)) {
        assert.ok(["done", "needs_review", "waiting_input"].includes(row.status), JSON.stringify(row)); return row;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error("Acceptance timed out");
  }
  const start = await request(path, { action: "start", requestId: randomUUID(), sourceId, brief, credentials });
  const muted = await wait(start.runId); console.log("PASS muted HTTP → model JSON fallback → render → checks", muted.checkpoint.checks);
  const voicedId = await request(path, { action: "revise", runId: muted.id, requestId: randomUUID(), brief: { ...brief, audio: "voiceover" }, credentials });
  const voiced = await wait(voicedId.runId); console.log("PASS local TTS → duration check → voiced render", voiced.checkpoint.checks);
  const callsBefore = calls;
  const exportedId = await request(path, { action: "export", runId: voiced.id, requestId: randomUUID() });
  const exported = await wait(exportedId.runId); assert.equal(calls, callsBefore); assert.deepEqual(exported.checkpoint.plan, voiced.checkpoint.plan); console.log("PASS immutable 1080p export without model calls");
  const choicesId = await request(path, { action: "candidates", runId: muted.id, requestId: randomUUID(), credentials });
  const choices = await wait(choicesId.runId); assert.equal(choices.checkpoint.candidates.length, 3);
  const manualId = await request(path, { action: "manual", runId: choices.id, requestId: randomUUID(), brief, plan: choices.checkpoint.candidates[1], credentials });
  const manual = await wait(manualId.runId); console.log("PASS 3 alternatives → explicit selection → new version");
  const settled = (await request(path)).runs.find(r => r.id === choices.id);
  assert.equal(settled.status, "done"); assert.equal(settled.stage, "selected"); choices.status = settled.status;
  assert.equal(createHash("sha256").update(await readFile(sourceFile)).digest("hex"), hash);
  assert.ok(jsonFallbacks > 0); assert.ok(muted.checkpoint.checks.technical && voiced.checkpoint.checks.technical && exported.checkpoint.checks.technical && manual.checkpoint.checks.technical);
  const report = { at: new Date().toISOString(), type: "synthetic-source-local-model-only", projectId: project.id, url: `${base}/project/${project.id}/auto-edit`, calls, jsonFallbacks, runs: [muted, voiced, exported, choices, manual].map(r => ({ id: r.id, status: r.status, quality: r.quality, url: r.url, checks: r.checkpoint.checks })) };
  await writeFile(join(directory, "http-acceptance.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
