import { NextRequest, NextResponse } from "next/server";
import { errText } from "@/lib/api-error";
import { isOllama, listModels } from "@/lib/llm-models";

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
    const { baseUrl, apiKey } = await req.json();
    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: errText(req, "缺少 baseUrl", "Missing baseUrl") }, { status: 400 });
    }
    const models = await listModels(String(baseUrl), String(apiKey || ""));
    if (models.length === 0) {
      const localOllama = isOllama(String(baseUrl));
      return NextResponse.json({
        ok: false,
        models: [],
        code: localOllama ? "OLLAMA_MODELS_UNAVAILABLE" : "REMOTE_MODEL_LIST_UNAVAILABLE",
        error: errText(
          req,
          localOllama
            ? "没有读到本机模型。请确认 Ollama 正在运行，并至少安装一个模型。"
            : "没有从当前服务读到模型列表。请检查 API 地址和 Key，或稍后重试；也可以直接输入模型 ID。",
          localOllama
            ? "No local models were found. Make sure Ollama is running and at least one model is installed."
            : "No model list was returned by this service. Check the API URL and key, try again later, or enter a model ID directly.",
        ),
      });
    }
    return NextResponse.json({ ok: true, models });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      models: [],
      error: error instanceof Error ? error.message : errText(req, "读取失败", "Request failed"),
    });
  }
}
