import { NextRequest, NextResponse } from "next/server";
import { errText } from "@/lib/api-error";
import { probeLLMEndpoint } from "@/lib/llm-probe";

/**
 * Server-side LLM connection test.
 * Must run server-side: direct browser requests to provider APIs are blocked by CORS, causing a false
 * "connection failed" error even when the API key is valid.
 *
 * All branching lives in lib/llm-probe (unit-tested against fake providers); this route only handles
 * transport and locale.
 */
export async function POST(req: NextRequest) {
  try {
    const { baseUrl, apiKey, model } = await req.json();
    if (!baseUrl || !apiKey) {
      return NextResponse.json({ ok: false, error: errText(req, "缺少 baseUrl 或 apiKey", "Missing baseUrl or apiKey") }, { status: 400 });
    }

    const outcome = await probeLLMEndpoint({ baseUrl: String(baseUrl), apiKey: String(apiKey), model: model ? String(model) : undefined });
    return NextResponse.json({
      ok: outcome.ok,
      ...(outcome.status ? { status: outcome.status } : {}),
      ...(outcome.error ? { error: errText(req, outcome.error.zh, outcome.error.en) } : {}),
      ...(outcome.warning ? { warning: errText(req, outcome.warning.zh, outcome.warning.en) } : {}),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : errText(req, "连接失败", "Connection failed"),
    });
  }
}
