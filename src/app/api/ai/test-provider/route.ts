import { NextRequest, NextResponse } from "next/server";

/**
 * AI 平台 Key 连通性校验（生图/生视频平台）。
 * 各平台用最便宜的「鉴权先过」端点探针：
 * - 2xx → ok（Key 有效）
 * - 401/403 → invalid（Key 无效）
 * - 其它(404/400/5xx/网络) → unknown（无法判定，可直接试生成）
 * 走服务端发起，绕开浏览器 CORS；只读探针，不产生计费生成。
 */

const DEFAULT_BASE: Record<string, string> = {
  replicate: "https://api.replicate.com/v1",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  alibaba: "https://dashscope.aliyuncs.com/api/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

type Probe = { url: string; headers: Record<string, string>; authFirst?: boolean; method?: "GET" | "POST"; body?: string };

function buildProbe(name: string, apiKey: string, baseUrl?: string): Probe {
  const base = (baseUrl || DEFAULT_BASE[name] || "").replace(/\/$/, "");
  if (name === "replicate") {
    return { url: `${base}/account`, headers: { Authorization: `Bearer ${apiKey}` } };
  }
  if (name === "alibaba") {
    // dashscope 原生无 /models，用 OpenAI 兼容模式的 /models 验 Key
    return { url: `https://dashscope.aliyuncs.com/compatible-mode/v1/models`, headers: { Authorization: `Bearer ${apiKey}` } };
  }
  if (name === "openrouter") {
    // OpenRouter's key metadata endpoint validates the supplied bearer token
    // without submitting a generation request or incurring model charges.
    return { url: `${base}/key`, headers: { Authorization: `Bearer ${apiKey}` } };
  }
  // siliconflow / volcengine / 自定义 OpenAI 兼容：GET /models
  return { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey}` } };
}

export async function POST(req: NextRequest) {
  let body: { name?: string; apiKey?: string; baseUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* 空 body */
  }
  const { name, apiKey, baseUrl } = body;
  if (!name || !apiKey) {
    return NextResponse.json({ status: "unknown", code: "MISSING_CONFIG", message: "请先填写 API Key。" }, { status: 400 });
  }

  const probe = buildProbe(name, apiKey, baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(probe.url, { method: probe.method ?? "GET", headers: probe.headers, body: probe.body, signal: controller.signal });
    if (r.status === 401 || r.status === 403) {
      return NextResponse.json({ status: "invalid", code: "INVALID_KEY", message: "平台拒绝了该 Key，请检查是否填错、过期或权限不足。" });
    }
    if (r.ok || probe.authFirst) {
      // authFirst 平台：非 401/403 即视为鉴权通过
      return NextResponse.json({ status: "ok", code: "CONNECTED", message: "已由本地服务连接并通过平台验证。" });
    }
    if (r.status === 429) {
      return NextResponse.json({ status: "unknown", code: "RATE_LIMITED", message: "平台暂时限制了请求，请稍后再试。" });
    }
    if (r.status >= 500) {
      return NextResponse.json({ status: "unknown", code: "PROVIDER_UNAVAILABLE", message: `平台服务暂时不可用（HTTP ${r.status}），请稍后重试。` });
    }
    return NextResponse.json({ status: "unknown", code: "UNEXPECTED_RESPONSE", message: `平台返回了 HTTP ${r.status}，暂时无法确认 Key 状态。` });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return NextResponse.json({
      status: "unknown",
      code: aborted ? "TIMEOUT" : "NETWORK_UNREACHABLE",
      message: aborted
        ? "本地服务连接平台超时，请检查代理设置或稍后重试。"
        : "本地服务无法连接到平台；请检查系统代理、防火墙或 DNS。",
    });
  } finally {
    clearTimeout(timer);
  }
}
