// @vitest-environment node
// （openai SDK 在浏览器环境会拒绝构造以防 Key 泄漏；这些代码本就只跑在服务端）
/**
 * LLM failure handling — issue #19 (Pollinations 免 Key 端点停用后返回 402，用户看到的只有
 * `LLM 请求失败 ... 402 "402 Payment Required"`，Mac/Win 都无从下手).
 *
 * 两条线各自守住：
 *  1) 免费池的 402 要能被 openai SDK 当成可重试（我们通过 SDK 官方的 x-should-retry 响应头协议注入，
 *     重试本身仍由 SDK 做——不自己写重试循环）；
 *  2) 每种失败都要给出"下一步做什么"的文案，且生成路径与"测试连接"共用同一套说法。
 */
import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from "openai";
import {
  FREE_POOL_RETRY_MS,
  LLMRequestError,
  createLLMClient,
  explainLLMError,
  explainLLMStatus,
  freePoolRetryFetch,
  isLegacyPollinations,
  isPollinations,
  jsonModeParams,
  llmErrorPair,
  optionalParamRetryFetch,
  toLLMRequestError,
  withLLMErrors,
} from "@/lib/llm-error";
import { settings } from "@/lib/i18n/messages/settings";
import { LLM_PRESETS } from "@/lib/llm-presets";
import { migrateSettings } from "@/lib/stores/settings-store";
import type { SettingsState } from "@/lib/stores/settings-store";

const LEGACY = "https://text.pollinations.ai/openai";
const NEW_POLLINATIONS = "https://gen.pollinations.ai/v1";

/** Build an SDK APIError with a real Headers object (the SDK reads requestID off it). */
function apiError(status: number, message = "boom", headers: Record<string, string> = {}): APIError {
  return new APIError(status, { message }, message, new Headers(headers));
}

describe("freePoolRetryFetch（把免费池 402 翻译成 SDK 认识的 x-should-retry 协议）", () => {
  it("402 → 打上 x-should-retry:true 和 retry-after-ms，交给 SDK 退避重试", async () => {
    const wrapped = freePoolRetryFetch(async () => new Response("no budget", { status: 402 }));
    const res = await wrapped("https://gen.pollinations.ai/v1/chat/completions");
    expect(res.status).toBe(402); // 状态码不能篡改，否则 SDK 报错文案会失真
    expect(res.headers.get("x-should-retry")).toBe("true");
    expect(res.headers.get("retry-after-ms")).toBe(String(FREE_POOL_RETRY_MS));
    expect(await res.text()).toBe("no budget"); // body 必须原样透传
  });

  it("服务端已给 retry-after 时不覆盖它（尊重对方的节流指示）", async () => {
    const wrapped = freePoolRetryFetch(
      async () => new Response("slow down", { status: 402, headers: { "retry-after": "30" } }),
    );
    const res = await wrapped("https://gen.pollinations.ai/v1/chat/completions");
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("retry-after-ms")).toBeNull();
  });

  it("已停用的旧 Pollinations 地址不标可重试：它只会一直 402，重试白等 90 秒", async () => {
    const wrapped = freePoolRetryFetch(async () => new Response("dead", { status: 402 }));
    const res = await wrapped(`${LEGACY}/chat/completions`);
    expect(res.headers.get("x-should-retry")).toBeNull();
  });

  it("非 402 原样返回（200 不被重新包装）", async () => {
    const original = new Response("ok", { status: 200 });
    const wrapped = freePoolRetryFetch(async () => original);
    expect(await wrapped("https://api.openai.com/v1/chat/completions")).toBe(original);
  });
});

describe("createLLMClient（重试交给 openai SDK，不自研）", () => {
  it("免 Key 端点补占位 Key（SDK 要求非空），并放开重试次数", () => {
    const client = createLLMClient({ baseUrl: NEW_POLLINATIONS, apiKey: "", model: "openai-fast" });
    expect(client.apiKey).toBe("no-key");
    expect(client.maxRetries).toBe(3);
  });

  // 402 只有在「匿名共享池这一秒被抽干」时才值得重试。带上真 Key 之后，Pollinations 的 402 含义
  // 变成「这把 Key 今天的额度用完了」——明天才恢复，重试只会让用户白等 15 秒还是同一句报错。
  // 用行为断言而非对象身份：装没装钩子不重要，重试与否才是用户能感知的事。
  it("只有匿名 Pollinations 会重试 402：带 Key 的 402 是当天额度耗尽，不该白等", async () => {
    const hits = async (apiKey: string) => {
      let calls = 0;
      const server = createServer((_req, res) => {
        calls++;
        res.writeHead(402, { "content-type": "application/json", "retry-after-ms": "5" });
        res.end(JSON.stringify({ error: "402 Payment Required" }));
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as AddressInfo).port;
      try {
        const client = createLLMClient({ baseUrl: `http://127.0.0.1:${port}/pollinations.ai/v1`, apiKey, model: "m" });
        await client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "hi" }] }).catch(() => {});
        return calls;
      } finally {
        server.close();
      }
    };
    expect(await hits("")).toBeGreaterThan(1); // 匿名池：抽干是暂时的，重试
    expect(await hits("real-key")).toBe(1); // 有 Key：额度明天才回，重试无意义
  });
});

describe("集成：真的 openai SDK + 假 provider（验证 402 重试协议确实被 SDK 认账）", () => {
  it("免费池连续 402 后恢复 → SDK 自动重试到成功，调用方无感", async () => {
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      if (calls <= 2) {
        // 真实 Pollinations 的 402 报文；retry-after-ms 由服务端给出以免测试真等 5 秒
        res.writeHead(402, { "content-type": "application/json", "retry-after-ms": "10" });
        return res.end(JSON.stringify({ error: "402 Payment Required" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "x", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const client = new OpenAI({
        baseURL: `http://127.0.0.1:${port}/v1`,
        apiKey: "no-key",
        maxRetries: 3,
        fetch: freePoolRetryFetch(),
      });
      const res = await client.chat.completions.create({ model: "openai-fast", messages: [{ role: "user", content: "hi" }] });
      expect(res.choices[0].message.content).toBe("OK");
      expect(calls).toBe(3);
    } finally {
      server.close();
    }
  });

  it("一直 402 → 重试用尽后抛 APIError(402)，交给文案层翻译成人话", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(402, { "content-type": "application/json", "retry-after-ms": "5" });
      res.end(JSON.stringify({ error: "402 Payment Required" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const client = new OpenAI({ baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "no-key", maxRetries: 1, fetch: freePoolRetryFetch() });
      const err = await withLLMErrors(
        () => client.chat.completions.create({ model: "openai-fast", messages: [{ role: "user", content: "hi" }] }),
        { baseUrl: LEGACY, model: "openai-fast" },
      ).catch((e) => e);
      expect(err).toBeInstanceOf(LLMRequestError);
      expect(err.status).toBe(402);
      expect(err.zh).toContain("gen.pollinations.ai/v1");
    } finally {
      server.close();
    }
  });
});

describe("端点识别", () => {
  it("新旧 Pollinations 都算 Pollinations，只有旧地址算已停用端点", () => {
    expect(isPollinations(LEGACY)).toBe(true);
    expect(isPollinations(NEW_POLLINATIONS)).toBe(true);
    expect(isLegacyPollinations(LEGACY)).toBe(true);
    expect(isLegacyPollinations(NEW_POLLINATIONS)).toBe(false);
    expect(isPollinations("https://api.openai.com/v1")).toBe(false);
    expect(isPollinations(undefined)).toBe(false);
  });
});

describe("explainLLMStatus（每种失败都要说出下一步该做什么）", () => {
  it("旧 Pollinations 地址 402 → 指路新端点 + 免费领 Key 页面（issue #19 的原始场景）", () => {
    const { zh, en } = explainLLMStatus(402, { baseUrl: LEGACY, model: "openai-fast" });
    expect(zh).toContain("gen.pollinations.ai/v1");
    expect(zh).toContain("enter.pollinations.ai/keys");
    expect(zh).toContain("Ollama");
    expect(en).toContain("enter.pollinations.ai/keys");
  });

  it("新 Pollinations 地址 402 → 说清是每日免费额度用完，而不是让人去改地址", () => {
    const { zh } = explainLLMStatus(402, { baseUrl: NEW_POLLINATIONS, model: "openai-fast" });
    expect(zh).toContain("额度");
    expect(zh).not.toContain("已停用");
  });

  it("普通厂商 402 → 充值/换渠道，不提 Pollinations", () => {
    const { zh } = explainLLMStatus(402, { baseUrl: "https://api.deepseek.com", model: "x" });
    expect(zh).toContain("充值");
    expect(zh).not.toContain("Pollinations");
  });

  it("401/403 说 Key，404 带上模型名，429 说限流", () => {
    expect(explainLLMStatus(401, {}).zh).toContain("Key");
    expect(explainLLMStatus(403, {}).zh).toContain("Key");
    expect(explainLLMStatus(404, { model: "gpt-9" }).zh).toContain("gpt-9");
    expect(explainLLMStatus(429, {}).zh).toContain("限流");
    expect(explainLLMStatus(503, {}).zh).toContain("5xx");
  });
});

describe("explainLLMError（SDK 错误类 → 文案，含无状态码的连接层失败）", () => {
  it("连接失败/超时走 SDK 的连接错误类，提示网络与本地 Ollama", () => {
    const conn = explainLLMError(new APIConnectionError({ message: "fetch failed" }), {
      baseUrl: "http://localhost:11434/v1",
      model: "qwen2.5",
    });
    expect(conn.zh).toContain("ollama serve");
    const timeout = explainLLMError(new APIConnectionTimeoutError({ message: "timed out" }), {});
    expect(timeout.zh).toContain("超时");
  });

  it("附带模型/地址/原始报错，便于用户截图反馈", () => {
    const out = explainLLMError(apiError(402, "402 Payment Required"), { baseUrl: LEGACY, model: "openai-fast" });
    expect(out.status).toBe(402);
    expect(out.zh).toContain("openai-fast");
    expect(out.zh).toContain(LEGACY);
    expect(out.zh).toContain("402 Payment Required");
  });

  it("SDK 的具体错误子类都能落到对应文案", () => {
    const t = { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4" };
    expect(explainLLMError(new AuthenticationError(401, {}, "bad key", new Headers()), t).zh).toContain("Key");
    expect(explainLLMError(new NotFoundError(404, {}, "no model", new Headers()), t).zh).toContain("gpt-5.4");
    expect(explainLLMError(new RateLimitError(429, {}, "slow", new Headers()), t).zh).toContain("限流");
  });
});

describe("withLLMErrors（只做错误翻译，不做重试——重试是 SDK 的事）", () => {
  it("成功直接透传返回值", async () => {
    await expect(withLLMErrors(async () => "ok", {})).resolves.toBe("ok");
  });

  it("失败包成带双语的 LLMRequestError，API 路由据此回英文客户端", async () => {
    const err = await withLLMErrors(() => Promise.reject(apiError(402)), { baseUrl: LEGACY, model: "openai-fast" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(LLMRequestError);
    expect(err.status).toBe(402);
    const pair = llmErrorPair(err);
    expect(pair.zh).toContain("enter.pollinations.ai/keys");
    expect(pair.en).toContain("Pollinations");
    expect(pair.en).not.toBe(pair.zh);
  });

  it("用户主动取消不被改写成失败（前端据此区分取消与报错）", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "APIUserAbortError" });
    await expect(withLLMErrors(() => Promise.reject(abort), {})).rejects.toBe(abort);
  });

  it("已经是 LLMRequestError 的不再二次包装", () => {
    const original = new LLMRequestError("中文", "english", 402);
    expect(toLLMRequestError(original, {})).toBe(original);
  });

  it("非 LLM 错误（解析失败等）双语同文，不丢信息", () => {
    expect(llmErrorPair(new Error("JSON 解析失败"))).toEqual({ zh: "JSON 解析失败", en: "JSON 解析失败" });
  });
});

describe("LLM_PRESETS（预设是新装用户的唯一入口，指向死端点就等于开箱不可用）", () => {
  it("没有任何预设指向已停用的 text.pollinations.ai", () => {
    expect(LLM_PRESETS.filter((p) => isLegacyPollinations(p.baseUrl))).toEqual([]);
  });

  it("Pollinations 预设指向新端点，且不再预填占位 Key（否则 401 会被伪装成已配置）", () => {
    const p = LLM_PRESETS.find((x) => x.label === "Pollinations");
    expect(p?.baseUrl).toBe(NEW_POLLINATIONS);
    expect(p?.apiKey).toBeUndefined();
  });

  it("只有真正免 Key 的本地 Ollama 才预填占位 Key", () => {
    expect(LLM_PRESETS.filter((p) => p.apiKey).map((p) => p.label)).toEqual(["Ollama 本地"]);
  });

  it("每个 tipKey 在中英文案里都存在（设置页是客户端渲染，缺键只会在用户点开时露出）", () => {
    for (const p of LLM_PRESETS) {
      if (!p.tipKey) continue;
      expect(settings.zh, `zh:${p.tipKey}`).toHaveProperty(p.tipKey);
      expect(settings.en, `en:${p.tipKey}`).toHaveProperty(p.tipKey);
    }
  });

  it("每个预设都填了 baseUrl 和模型名（缺一个都会在生成时才炸）", () => {
    for (const p of LLM_PRESETS) {
      expect(p.baseUrl, p.label).toMatch(/^https?:\/\//);
      expect(p.model.length, p.label).toBeGreaterThan(0);
    }
  });
});

describe("migrateSettings v2（老用户本地存着已停用的 Pollinations 地址，升级即自愈）", () => {
  const build = (llm: Partial<SettingsState["llm"]>): SettingsState =>
    ({ llm: { provider: "", baseUrl: "", apiKey: "", model: "", ...llm } }) as SettingsState;

  it("旧免 Key 地址 → 新端点，并清掉占位 Key（占位值会把未配置伪装成已配置）", () => {
    const out = migrateSettings(build({ baseUrl: LEGACY, apiKey: "pollinations", model: "openai-fast" }));
    expect(out.llm.baseUrl).toBe(NEW_POLLINATIONS);
    expect(out.llm.apiKey).toBe("");
    expect(out.llm.model).toBe("openai-fast");
  });

  it("用户自己填过的真 Key 不清空", () => {
    const out = migrateSettings(build({ baseUrl: LEGACY, apiKey: "my-real-key", model: "openai-fast" }));
    expect(out.llm.baseUrl).toBe(NEW_POLLINATIONS);
    expect(out.llm.apiKey).toBe("my-real-key");
  });

  it("其他厂商配置不受影响，v1 的失效模型名清洗仍然生效", () => {
    const untouched = migrateSettings(build({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-5.4" }));
    expect(untouched.llm.baseUrl).toBe("https://api.openai.com/v1");
    const v1 = migrateSettings(build({ baseUrl: "https://api.deepseek.com", apiKey: "k", model: "deepseek-v3.2" }));
    expect(v1.llm.model).toBe("deepseek-v4-flash");
  });

});

describe("optionalParamRetryFetch（可选参数被点名拒绝时去掉重放一次）", () => {
  const body = JSON.stringify({ model: "m", messages: [], response_format: { type: "json_object" }, enable_thinking: false });

  it("400 且报错点名 response_format → 去掉该字段重放", async () => {
    const calls: string[] = [];
    const wrapped = optionalParamRetryFetch(async (_url, init) => {
      calls.push(init?.body as string);
      if (calls.length === 1) return new Response('{"error":"response_format is not supported"}', { status: 400 });
      return new Response('{"ok":true}', { status: 200 });
    });
    const res = await wrapped("http://x/v1/chat/completions", { method: "POST", body });
    expect(res.status).toBe(200);
    const replayed = JSON.parse(calls[1]);
    expect(replayed.response_format).toBeUndefined();
    // 未被点名的可选参数保留
    expect(replayed.enable_thinking).toBe(false);
  });

  it("400 但报错与可选参数无关 → 原样返回不重放", async () => {
    let calls = 0;
    const wrapped = optionalParamRetryFetch(async () => {
      calls++;
      return new Response('{"error":"model not found"}', { status: 400 });
    });
    const res = await wrapped("http://x", { method: "POST", body });
    expect(res.status).toBe(400);
    expect(calls).toBe(1);
    // body 被读走后必须还能读（等价 Response）
    expect(await res.text()).toContain("model not found");
  });

  it("请求里没有可选参数 → 不读 body 不重放", async () => {
    let calls = 0;
    const wrapped = optionalParamRetryFetch(async () => {
      calls++;
      return new Response("bad", { status: 400 });
    });
    const res = await wrapped("http://x", { method: "POST", body: JSON.stringify({ model: "m" }) });
    expect(res.status).toBe(400);
    expect(calls).toBe(1);
  });

  it("成功响应直接透传（不消费流式 body）", async () => {
    const wrapped = optionalParamRetryFetch(async () => new Response("stream", { status: 200 }));
    const res = await wrapped("http://x", { method: "POST", body });
    expect(await res.text()).toBe("stream");
  });

  it("jsonModeParams 只对已知支持的端点开启", () => {
    expect(jsonModeParams("https://api.deepseek.com/v1")).toEqual({ response_format: { type: "json_object" } });
    expect(jsonModeParams("https://openrouter.ai/api/v1")).toEqual({ response_format: { type: "json_object" } });
    expect(jsonModeParams("https://gen.pollinations.ai/v1")).toEqual({});
    expect(jsonModeParams("")).toEqual({});
    expect(jsonModeParams(undefined)).toEqual({});
  });
});
