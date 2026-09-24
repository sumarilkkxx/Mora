import { NextRequest, NextResponse } from "next/server";
import { decodeStoredAdTemplate } from "@/lib/ad-templates";
import { apiError } from "@/lib/api-error";

const MAX_STORED_TEMPLATE_LENGTH = 50_000;

export async function POST(req: NextRequest) {
  let stored: unknown;
  try {
    ({ stored } = await req.json());
  } catch {
    return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON");
  }
  if (typeof stored !== "string" || stored.length > MAX_STORED_TEMPLATE_LENGTH) {
    return apiError(req, "模板选择无效", "Invalid template selection", 422);
  }
  const template = decodeStoredAdTemplate(stored);
  if (!template) return apiError(req, "模板不存在或已损坏", "Template not found or invalid", 404);
  return NextResponse.json({ template });
}
