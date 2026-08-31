import { NextRequest, NextResponse } from "next/server";
import { errText } from "@/lib/api-error";
import { isOllama, listModelsDetailed, type ModelCapability, type ModelListResult } from "@/lib/llm-models";

function modelListError(req: NextRequest, result: ModelListResult, localOllama: boolean): string {
  if (localOllama && (result.code === "CONNECTION_REFUSED" || result.models.length === 0)) {
    return errText(req, "没有连接到本机 Ollama。请先启动 Ollama，并至少安装一个模型。", "Could not reach local Ollama. Start Ollama and install at least one model.");
  }
  const messages: Record<string, [string, string]> = {
    NETWORK_BLOCKED: ["本地服务的外网访问被系统权限阻止。请以允许联网的方式重新启动开发服务。", "The local service is blocked from external network access. Restart it with network permission."],
    TIMEOUT: ["模型平台响应超时。请检查网络或代理后重试。", "The model provider timed out. Check the network or proxy and retry."],
    DNS_FAILED: ["无法解析模型平台域名。请检查 API 地址、DNS 或代理设置。", "The provider hostname could not be resolved. Check the API URL, DNS, or proxy."],
    CONNECTION_REFUSED: ["目标服务拒绝连接。请确认 API 地址和端口上的服务正在运行。", "The target refused the connection. Check the API URL and ensure the service is running."],
    UNAUTHORIZED: ["API Key 未通过验证（401）。请检查 Key 是否属于当前平台。", "The API key was rejected (401). Check that it belongs to this provider."],
    FORBIDDEN: ["当前 Key 没有读取模型列表的权限（403）。仍可手动填写模型 ID。", "This key cannot list models (403). You can still enter a model ID manually."],
    NOT_FOUND: ["没有找到模型列表接口（404）。API 地址通常需要以 /v1 结尾。", "The models endpoint was not found (404). The API URL usually needs to end in /v1."],
    RATE_LIMITED: ["模型平台限制了请求频率（429）。请稍后重试。", "The provider rate-limited this request (429). Try again shortly."],
    BAD_RESPONSE: ["服务返回了无法识别的模型列表格式。你仍可手动填写模型 ID。", "The service returned an unsupported model-list format. You can still enter a model ID manually."],
    REQUEST_FAILED: ["本地服务无法连接模型平台。请检查网络、代理和 API 地址。", "The local service could not reach the provider. Check the network, proxy, and API URL."],
  };
  const pair = messages[result.code ?? "REQUEST_FAILED"];
  return errText(req, pair[0], pair[1]);
}

/**
 * List the models an OpenAI-compatible endpoint exposes, so Settings can offer them instead of making
 * the user type a name from memory.
 *
 * Local Ollama is the case that forced this: `ollama pull qwen2.5:7b-instruct` installs a model whose
 * id carries a tag, while the preset ships the bare `qwen2.5`, and the only feedback was a 404
 * (issue #19 follow-up). Runs server-side because provider APIs block browser CORS.
 */
export async function POST(req: NextRequest) {
  try {
    const { baseUrl, apiKey, capability: requestedCapability } = await req.json();
    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: errText(req, "缺少 baseUrl", "Missing baseUrl") }, { status: 400 });
    }
    const capability: ModelCapability = requestedCapability === "vision" ? "vision" : "text";
    const result = await listModelsDetailed(String(baseUrl), String(apiKey || ""), fetch, capability);
    if (result.models.length === 0) {
      const localOllama = isOllama(String(baseUrl));
      return NextResponse.json({
        ok: false,
        models: [],
        code: result.code ?? (localOllama ? "OLLAMA_MODELS_UNAVAILABLE" : "REMOTE_MODEL_LIST_UNAVAILABLE"),
        status: result.status,
        error: modelListError(req, result, localOllama),
      });
    }
    return NextResponse.json({ ok: true, models: result.models, capability });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      models: [],
      error: error instanceof Error ? error.message : errText(req, "读取失败", "Request failed"),
    });
  }
}
