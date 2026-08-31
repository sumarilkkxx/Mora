// @vitest-environment node
// （openai SDK 在浏览器环境会拒绝构造以防 Key 泄漏；这些代码本就只跑在服务端）
/**
 * 连接探针 + 模型发现 —— issue #19 追问的两个新故障，都用「按真实报文复刻的假 provider」端到端验证：
 *
 *  1) Pollinations（上游 azure-openai）把「输出到达 token 上限」当成 400 返回，而不是截断内容。
 *     旧探针固定发 max_tokens:1，于是 Key 再正确也永远测不通：用户拿着刚领的 Key 看到「连接失败」。
 *  2) 本机 Ollama 的模型名带 :tag（`ollama pull qwen2.5:7b-instruct`），预设写的是裸名 `qwen2.5`，
 *     用户只能看到一个 404，无从知道自己装的模型到底叫什么。
 */
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import { probeLLMEndpoint, PROBE_MAX_TOKENS } from "@/lib/llm-probe";
import { listModels, modelListHint, isOllama, normalizeBase } from "@/lib/llm-models";
import { LLMRequestError, createLLMClient, explainLLMStatus, isTokenCapRejection, withLLMErrors } from "@/lib/llm-error";
import { LLM_PRESETS } from "@/lib/llm-presets";
import { migrateSettings, type SettingsState } from "@/lib/stores/settings-store";
import { settings } from "@/lib/i18n/messages/settings";

/** Pollinations 实测报文（issue #19 追问截图里的原文）。 */
const CAP_ERROR_BODY = JSON.stringify({
  success: false,
  error: {
    message:
      '400 Bad Request: azure-openai error: Could not finish the message because max_tokens or model output limit was reached. Please try again with higher max_tokens.',
  },
});

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** 起一个假 provider，返回 baseUrl。 */
async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<string> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => handler(req, res, raw));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const CHAT_OK = { id: "x", choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] };

describe("探针：把「输出上限」类 400 和真正的配置错误分开", () => {
  it("Pollinations 式 provider（带 max_tokens 就 400）→ 去掉上限重试一次即通过", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const base = await serve((req, res, body) => {
      const parsed = JSON.parse(body || "{}");
      seen.push(parsed);
      if (parsed.max_tokens !== undefined) return json(res, 400, CAP_ERROR_BODY);
      json(res, 200, CHAT_OK);
    });

    const out = await probeLLMEndpoint({ baseUrl: base, apiKey: "real-key", model: "openai-fast" });

    expect(out.ok).toBe(true); // 这正是修复前必然红叉的场景
    expect(out.warning).toBeUndefined();
    expect(seen).toHaveLength(2);
    expect(seen[0].max_tokens).toBe(PROBE_MAX_TOKENS);
    expect(seen[1].max_tokens).toBeUndefined(); // 第二次必须彻底不带上限，而不是换个更大的值
  });

  it("推理模型式 provider（拒收 max_tokens，要求 max_completion_tokens）→ 同一条兜底路径救回", async () => {
    const base = await serve((req, res, body) => {
      if (JSON.parse(body || "{}").max_tokens !== undefined) {
        return json(res, 400, {
          error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
        });
      }
      json(res, 200, CHAT_OK);
    });
    expect((await probeLLMEndpoint({ baseUrl: base, apiKey: "k", model: "o5-mini" })).ok).toBe(true);
  });

  it("去掉上限仍报「输出装不下」→ 判通过但给黄色提醒（鉴权与模型名已被证明有效，红叉是错的）", async () => {
    const base = await serve((_req, res) => json(res, 400, CAP_ERROR_BODY));
    const out = await probeLLMEndpoint({ baseUrl: base, apiKey: "k", model: "tiny" });
    expect(out.ok).toBe(true);
    expect(out.warning?.zh).toContain("输出上限");
    expect(out.warning?.en).toMatch(/output budget/i);
  });

  it("真正的参数错误（与 token 上限无关的 400）仍然如实报失败，不被兜底掩盖", async () => {
    let calls = 0;
    const base = await serve((_req, res) => {
      calls++;
      json(res, 400, { error: { message: "Invalid value for 'temperature'" } });
    });
    const out = await probeLLMEndpoint({ baseUrl: base, apiKey: "k", model: "m" });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
    expect(calls).toBe(1); // 非上限类 400 不该白白重试一次
    expect(out.error?.zh).toContain("请求被拒绝");
    expect(out.error?.zh).toContain("temperature"); // 原始报文要带上，截图即可定位
  });

  it("Key 无效仍然是红叉（修好探针不能把 401 也放过去）", async () => {
    const base = await serve((_req, res) => json(res, 401, { error: { message: "Unauthorized" } }));
    const out = await probeLLMEndpoint({ baseUrl: base, apiKey: "bad", model: "m" });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(401);
    expect(out.error?.zh).toContain("API Key");
  });

  it("已停用的 Pollinations 免 Key 地址：不发请求就判失败并给迁移指引", async () => {
    const out = await probeLLMEndpoint({
      baseUrl: "https://text.pollinations.ai/openai",
      apiKey: "x",
      model: "openai-fast",
      fetchImpl: () => Promise.reject(new Error("不该发出任何请求")),
    });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(402);
    expect(out.error?.zh).toContain("gen.pollinations.ai/v1");
  });

  it("未填模型名时退回 Key 级校验（GET /models）", async () => {
    const hit: string[] = [];
    const base = await serve((req, res) => {
      hit.push(req.url || "");
      json(res, 200, { data: [{ id: "m1" }] });
    });
    expect((await probeLLMEndpoint({ baseUrl: base, apiKey: "k" })).ok).toBe(true);
    expect(hit[0]).toContain("/models");
  });

  it("baseUrl 末尾多写一个斜杠不影响拼接", async () => {
    const paths: string[] = [];
    const base = await serve((req, res) => {
      paths.push(req.url || "");
      json(res, 200, CHAT_OK);
    });
    await probeLLMEndpoint({ baseUrl: `${base}/`, apiKey: "k", model: "m" });
    expect(paths[0]).toBe("/v1/chat/completions");
  });
});

// 生成路径固定发 max_tokens:16000，这是我们对「别人家模型上限」的一个猜测。猜错时厂商会 400，
// 而这跟用户填的东西毫无关系——预防性地去掉上限重试一次，让厂商用自己的默认值。
describe("生成路径：厂商嫌我们的 max_tokens 不合法时自动去掉重试（预防，非用户可修）", () => {
  const okBody = { id: "x", choices: [{ index: 0, message: { role: "assistant", content: "成了" }, finish_reason: "stop" }] };

  it("上限超过厂商天花板 → 去掉 max_tokens 重试，调用方直接拿到成功结果", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const base = await serve((_req, res, body) => {
      const parsed = JSON.parse(body || "{}");
      bodies.push(parsed);
      if (parsed.max_tokens !== undefined) {
        return json(res, 400, { error: { message: "max_tokens is greater than the maximum allowed (8192) for this model" } });
      }
      json(res, 200, okBody);
    });
    const client = createLLMClient({ baseUrl: base, apiKey: "k", model: "m" });
    const res = await client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "hi" }], max_tokens: 16000 });
    expect(res.choices[0].message.content).toBe("成了");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].max_tokens).toBeUndefined();
  });

  it("推理模型嫌字段名不对 → 改名成 max_completion_tokens 而不是丢掉限额", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const base = await serve((_req, res, body) => {
      const parsed = JSON.parse(body || "{}");
      bodies.push(parsed);
      if (parsed.max_tokens !== undefined) {
        return json(res, 400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } });
      }
      json(res, 200, okBody);
    });
    const client = createLLMClient({ baseUrl: base, apiKey: "k", model: "o5" });
    await client.chat.completions.create({ model: "o5", messages: [{ role: "user", content: "hi" }], max_tokens: 16000 });
    expect(bodies[1].max_tokens).toBeUndefined();
    expect(bodies[1].max_completion_tokens).toBe(16000);
  });

  it("与上限无关的 400 原样抛出：不重试、报错内容完整保留（读 body 不能把报文吃掉）", async () => {
    let calls = 0;
    const base = await serve((_req, res) => {
      calls++;
      json(res, 400, { error: { message: "Invalid value for 'temperature'" } });
    });
    const client = createLLMClient({ baseUrl: base, apiKey: "k", model: "m" });
    const err = await client.chat.completions
      .create({ model: "m", messages: [{ role: "user", content: "hi" }], max_tokens: 16000 })
      .catch((e) => e);
    expect(calls).toBe(1);
    expect(err.status).toBe(400);
    expect(String(err.message)).toContain("temperature");
  });

  it("没带 max_tokens 的请求不受影响（少读一次 body，流式响应不能被碰）", async () => {
    let calls = 0;
    const base = await serve((_req, res) => {
      calls++;
      json(res, 200, okBody);
    });
    const client = createLLMClient({ baseUrl: base, apiKey: "k", model: "m" });
    const res = await client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(res.choices[0].message.content).toBe("成了");
    expect(calls).toBe(1);
  });

  it("流式请求成功时响应体原样透传（错误分支绝不能把 SSE 流读掉）", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ id: "x", choices: [{ index: 0, delta: { content: "流" } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    const client = createLLMClient({ baseUrl: base, apiKey: "k", model: "m" });
    const stream = await client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "hi" }], max_tokens: 16000, stream: true });
    let out = "";
    for await (const chunk of stream) out += chunk.choices[0]?.delta?.content ?? "";
    expect(out).toBe("流");
  });
});

describe("探针：模型名写错时，直接说出这个地址上真正有哪些模型", () => {
  /** 复刻本机 Ollama：裸名 qwen2.5 未安装 → 404；/models 里是带 tag 的 qwen2.5:7b-instruct。 */
  const ollamaLike = () =>
    serve((req, res) => {
      if ((req.url || "").includes("/models")) {
        return json(res, 200, { object: "list", data: [{ id: "qwen2.5:7b-instruct" }, { id: "llama3.2:latest" }] });
      }
      json(res, 404, { error: { message: 'model "qwen2.5" not found, try pulling it first' } });
    });

  it("404 → 列出实际可用模型，并猜出用户想填的那个 tag", async () => {
    const base = await ollamaLike();
    const out = await probeLLMEndpoint({ baseUrl: base, apiKey: "ollama", model: "qwen2.5" });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(404);
    expect(out.error?.zh).toContain("qwen2.5:7b-instruct");
    expect(out.error?.zh).toContain("是不是想填");
    expect(out.error?.en).toContain("Did you mean");
  });

  it("/models 也读不到时不产生第二个错误，只保留原始 404 文案", async () => {
    const base = await serve((req, res) => {
      if ((req.url || "").includes("/models")) return json(res, 500, "boom");
      json(res, 404, { error: { message: "model not found" } });
    });
    const out = await probeLLMEndpoint({ baseUrl: base, apiKey: "k", model: "nope" });
    expect(out.ok).toBe(false);
    expect(out.error?.zh).toContain("模型名");
  });

  it("生成路径（不只是设置页）同样会带出可用模型列表", async () => {
    const base = await ollamaLike();
    const client = new OpenAI({ baseURL: base, apiKey: "ollama", maxRetries: 0 });
    const err = await withLLMErrors(
      () => client.chat.completions.create({ model: "qwen2.5", messages: [{ role: "user", content: "hi" }] }),
      { baseUrl: base, apiKey: "ollama", model: "qwen2.5" },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(LLMRequestError);
    expect(err.zh).toContain("qwen2.5:7b-instruct");
  });
});

describe("listModels / modelListHint", () => {
  it("解析 OpenAI 兼容的 /models 报文", async () => {
    const base = await serve((_req, res) => json(res, 200, { data: [{ id: "a" }, { id: "b" }, { id: 42 }] }));
    expect(await listModels(base, "k")).toEqual(["a", "b"]);
  });

  it("任何异常都返回空数组（这只是给报错加料，不能自己变成新报错）", async () => {
    const bad = await serve((_req, res) => json(res, 200, "not json at all"));
    expect(await listModels(bad, "k")).toEqual([]);
    expect(await listModels("http://127.0.0.1:1/v1", "k")).toEqual([]);
  });

  it("模型很多时截断展示并说明总数", () => {
    const hint = modelListHint(Array.from({ length: 30 }, (_, i) => `m${i}`), "zzz", "https://x.ai/v1");
    expect(hint?.zh).toContain("共 30 个");
    expect(hint?.zh.split("、").length).toBeLessThanOrEqual(8);
  });

  it("Ollama 一个模型都没装时给 pull 指令；非 Ollama 空列表则不硬凑提示", () => {
    expect(modelListHint([], "qwen2.5", "http://127.0.0.1:11434/v1")?.zh).toContain("ollama pull");
    expect(modelListHint([], "gpt-4o", "https://api.openai.com/v1")).toBeUndefined();
  });

  it("端点识别与地址归一", () => {
    expect(isOllama("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isOllama("http://localhost:11434")).toBe(true);
    expect(isOllama("https://api.openai.com/v1")).toBe(false);
    expect(normalizeBase("https://a.com/v1//")).toBe("https://a.com/v1");
  });
});

describe("文案：400 要能区分「模型名写错」和「模型写不下」", () => {
  it("带输出上限特征的 400 → 让用户缩短内容/换模型，而不是去改模型名", () => {
    const { zh, en } = explainLLMStatus(400, { detail: CAP_ERROR_BODY, model: "openai-fast" });
    expect(zh).toContain("输出长度");
    expect(zh).not.toContain("模型名填错");
    expect(en).toMatch(/output budget/i);
  });

  it("普通 400 仍是原来的说法", () => {
    expect(explainLLMStatus(400, { detail: "bad temperature" }).zh).toContain("模型名填错");
  });

  it("isTokenCapRejection 认得两种写法，且不误伤普通报文", () => {
    expect(isTokenCapRejection(CAP_ERROR_BODY)).toBe(true);
    expect(isTokenCapRejection("Use 'max_completion_tokens' instead")).toBe(true);
    expect(isTokenCapRejection("invalid api key")).toBe(false);
    expect(isTokenCapRejection(undefined)).toBe(false);
  });
});

describe("Ollama 预设与迁移（Windows 上 localhost 会先解析到 ::1，而 Ollama 只监听 127.0.0.1）", () => {
  it("预设用 127.0.0.1，不用 localhost", () => {
    const p = LLM_PRESETS.find((x) => x.label === "Ollama 本地");
    expect(p?.baseUrl).toBe("http://127.0.0.1:11434/v1");
  });

  it("老配置里的 localhost:11434 升级后自动改写，其它端口/域名不动", () => {
    const build = (baseUrl: string): SettingsState => ({ llm: { provider: "", baseUrl, apiKey: "", model: "" } }) as SettingsState;
    expect(migrateSettings(build("http://localhost:11434/v1")).llm.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(migrateSettings(build("http://localhost:3000/v1")).llm.baseUrl).toBe("http://localhost:3000/v1");
    expect(migrateSettings(build("https://api.openai.com/v1")).llm.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("模型选择器与 Ollama 提示的文案键中英齐全（缺键只会在用户点开时才露出）", () => {
    for (const key of ["modelListButton", "modelListLoading", "modelListFilter", "modelListNoMatch", "modelListFailed", "ollamaModelHint"]) {
      expect(settings.zh, `zh:${key}`).toHaveProperty(key);
      expect(settings.en, `en:${key}`).toHaveProperty(key);
    }
  });
});
