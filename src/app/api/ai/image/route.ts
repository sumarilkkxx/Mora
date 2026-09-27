import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/providers";
import { toRemoteUsableImage } from "@/lib/remote-image";
import { apiError, errText } from "@/lib/api-error";
import { discoverModelCapability, preflightCapabilityRequest } from "@/lib/provider-capability-contract";
import { classifyProviderError } from "@/lib/provider-error-classification";

// AI image generation
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { provider: providerName, model, prompt, imageUrl, imageUrls, mode, apiKey, baseUrl, options } = body;

  if (!providerName || !model || !prompt) {
    return apiError(req, "缺少必要参数", "Missing required parameters");
  }

  if (!apiKey) {
    return apiError(req, "缺少 API Key，请先在设置中配置对应平台", "Missing API Key, please configure the corresponding platform in settings first");
  }

  try {
    const provider = createProvider({ name: providerName, apiKey, baseUrl });
    const capability = await discoverModelCapability(provider, { provider: providerName, modelId: model, mediaType: "image" });
    const preflight = preflightCapabilityRequest(capability, { mode: mode || "text-to-image" });
    if (!preflight.ok) {
      return NextResponse.json({
        error: errText(req, "所选模型不支持当前图片生成模式", "The selected model does not support this image generation mode"),
        code: "CAPABILITY_MISMATCH",
        contractVersion: capability.version,
        issues: preflight.issues,
      }, { status: 422 });
    }

    // For image-to-image mode, convert local reference images to data URIs.
    // imageUrls (plural) feeds multi-reference edits (e.g. character sheet + product photo);
    // the array order is preserved so prompts can cite references by position.
    const referenceImageUrl = await toRemoteUsableImage(imageUrl);
    const referenceImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
      ? (await Promise.all((imageUrls as string[]).map(toRemoteUsableImage))).filter((u): u is string => !!u)
      : undefined;

    const result = await provider.generateImage({
      modelId: model,
      mode: mode || "text-to-image",
      prompt,
      referenceImageUrl,
      ...(referenceImageUrls?.length && { referenceImageUrls }),
      ...options,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("生图失败:", error);
    const classified = classifyProviderError(error, providerName || "");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : errText(req, "生图失败", "Image generation failed"),
        code: classified.code,
        category: classified.category,
        retryable: classified.retryable,
      },
      { status: classified.httpStatus }
    );
  }
}
