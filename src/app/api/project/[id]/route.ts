import { NextRequest, NextResponse } from "next/server";
import { rm } from "fs/promises";
import { join } from "path";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getUploadsDir, getOutputDir } from "@/lib/paths";
import { eq } from "drizzle-orm";
import { apiError, errText } from "@/lib/api-error";
import { normalizeTargetVideoDuration } from "@/lib/target-video-duration";

// Project ids are UUIDs; validate before using one in a filesystem path (guards the rm below against traversal)
const SAFE_ID = /^[a-zA-Z0-9-]+$/;

// Allowlist of fields that may be updated via PATCH (id/createdAt etc. are blocked to prevent field injection / primary-key corruption)
const PATCHABLE_FIELDS = [
  "name",
  "workflowType",
  "productionMode",
  "targetDuration",
  "productName",
  "productCategory",
  "productDescription",
  "productImages",
  "productAnalysis",
  "shopUrl",
  "affiliateCode",
  "productId",
  "brandId",
  "templateId",
  "videoMode",
  "sourceType",
  "sourceVideoUrl",
  "characterId",
  "status",
] as const;

// Valid enum values for the status field (SQLite does not enforce enums, so we validate manually)
const VALID_STATUS = new Set([
  "draft",
  "scripting",
  "assets",
  "video",
  "composing",
  "done",
]);
const VALID_WORKFLOW_TYPES = new Set(["generate", "edit"]);
const VALID_PRODUCTION_MODES = new Set(["ai", "local"]);

// Fetch a single project
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const result = await db.select().from(projects).where(eq(projects.id, id));

    if (result.length === 0) {
      return apiError(req, "项目不存在", "Project not found", 404);
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("Failed to fetch project:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取项目失败", "Failed to fetch project") },
      { status: 500 }
    );
  }
}

// Update a project
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const db = getDb();

    if (body.action === "restore") {
      const restored = await db.update(projects).set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(projects.id, id)).returning();
      if (!restored[0]) return apiError(req, "项目不存在", "Project not found", 404);
      return NextResponse.json(restored[0]);
    }

    // Only pick allowlisted fields; discard dangerous fields such as id/createdAt
    const updates: Record<string, unknown> = {};
    for (const field of PATCHABLE_FIELDS) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    // Validate that the status value is a legal enum member
    if ("status" in updates && !VALID_STATUS.has(String(updates.status))) {
      return apiError(req, "非法的项目状态值", "Invalid project status value", 400);
    }
    if ("workflowType" in updates && !VALID_WORKFLOW_TYPES.has(String(updates.workflowType))) {
      return apiError(req, "非法的项目工作流类型", "Invalid project workflow type", 400);
    }
    if ("productionMode" in updates && !VALID_PRODUCTION_MODES.has(String(updates.productionMode))) {
      return apiError(req, "制作模式无效", "Invalid production mode", 400);
    }
    if ("targetDuration" in updates) {
      updates.targetDuration = normalizeTargetVideoDuration(updates.targetDuration);
    }
    if ("shopUrl" in updates) {
      const raw = typeof updates.shopUrl === "string" ? updates.shopUrl.trim() : "";
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid protocol");
        updates.shopUrl = parsed.toString();
      } catch {
        return apiError(req, "商品链接必须是有效的 http/https 地址", "Product link must be a valid HTTP(S) URL", 400);
      }
    }

    if (Object.keys(updates).length === 0) {
      return apiError(req, "没有可更新的字段", "No updatable fields provided", 400);
    }

    const result = await db
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();

    if (result.length === 0) {
      return apiError(req, "项目不存在", "Project not found", 404);
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "更新项目失败", "Failed to update project") },
      { status: 500 }
    );
  }
}

// Move a project to trash by default; permanent=1 performs the destructive delete.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || !SAFE_ID.test(id)) {
      return apiError(req, "无效的项目ID", "Invalid project ID", 400);
    }
    const db = getDb();
    const permanent = req.nextUrl.searchParams.get("permanent") === "1";
    if (!permanent) {
      const [trashed] = await db.update(projects).set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, id)).returning();
      if (!trashed) return apiError(req, "项目不存在", "Project not found", 404);
      return NextResponse.json({ success: true, trashed: true });
    }
    // DB rows cascade (scripts/assets/compositions via onDelete:"cascade" + foreign_keys=ON),
    // but the project's on-disk files do not — remove them too so deletes don't leak orphaned
    // uploads/output directories. force:true ignores missing dirs; failures never block the delete.
    await db.delete(projects).where(eq(projects.id, id));
    await Promise.all([
      rm(join(getUploadsDir(), id), { recursive: true, force: true }).catch(() => {}),
      rm(join(getOutputDir(), id), { recursive: true, force: true }).catch(() => {}),
    ]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "删除项目失败", "Failed to delete project") },
      { status: 500 }
    );
  }
}
