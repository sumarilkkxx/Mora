import { NextRequest, NextResponse } from "next/server";
import { generateSpeech, type TTSConfig } from "@/lib/tts";
import { apiError, errText } from "@/lib/api-error";
import { classifyProviderError } from "@/lib/provider-error-classification";
import { preflightCapabilityRequest, resolveCapabilityContract } from "@/lib/provider-capability-contract";

// TTS voice preview: return mp3 audio bytes for the frontend to preview a voice
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, ttsConfig } = body as { text?: string; ttsConfig?: TTSConfig };

    if (!text) {
      return apiError(req, "缺少配音文本", "Missing voiceover text");
    }
    if (!ttsConfig?.baseUrl || !ttsConfig?.apiKey || !ttsConfig?.model || !ttsConfig?.voice) {
      return apiError(
        req,
        "请先在设置中配置 TTS（baseUrl、apiKey、model、voice）",
        "Please configure TTS in settings first (baseUrl, apiKey, model, voice)"
      );
    }

    const capability = resolveCapabilityContract({
      capability: "tts",
      provider: ttsConfig.provider ?? "openai",
      modelId: ttsConfig.model,
    });
    const preflight = preflightCapabilityRequest(capability, { speed: ttsConfig.speed });
    if (!preflight.ok) {
      return NextResponse.json({
        error: errText(req, "当前 TTS 参数超出所选平台支持范围", "The TTS parameters exceed the selected provider's supported range"),
        code: "CAPABILITY_MISMATCH",
        contractVersion: capability.version,
        issues: preflight.issues,
      }, { status: 422 });
    }

    const audio = await generateSpeech(text, ttsConfig);
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("TTS failed:", error);
    const classified = classifyProviderError(error, "tts");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : errText(req, "TTS 失败", "TTS failed"),
        code: classified.code,
        category: classified.category,
        retryable: classified.retryable,
      },
      { status: classified.httpStatus }
    );
  }
}
