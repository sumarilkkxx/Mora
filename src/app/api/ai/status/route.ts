import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/providers";
import { apiError, errText } from "@/lib/api-error";

// Query AI task status (image/video generation is asynchronous)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { provider: providerName, taskId, apiKey, baseUrl } = body;

  if (!providerName || !taskId) {
    return apiError(req, "缺少必要参数", "Missing required parameters");
  }

  if (!apiKey) {
    return apiError(req, "缺少 API Key，请先在设置中配置对应平台", "Missing API Key, please configure the corresponding platform in settings first");
  }

  try {
    const provider = createProvider({ name: providerName, apiKey, baseUrl });
    const status = await provider.getTaskStatus(taskId);
    return NextResponse.json(status);
  } catch (error) {
    console.error("查询任务状态失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "查询失败", "Query failed") },
      { status: 500 }
    );
  }
}
