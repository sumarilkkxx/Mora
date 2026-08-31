import { NextRequest, NextResponse } from "next/server";
import { rm } from "fs/promises";
import { join } from "path";
import { and, inArray, isNotNull } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getOutputDir, getUploadsDir } from "@/lib/paths";

export const runtime = "nodejs";
const SAFE_ID = /^[a-zA-Z0-9-]+$/;

function idsFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id)))].slice(0, 200)
    : [];
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { ids?: unknown };
  const ids = idsFrom(body.ids);
  if (!ids.length) return apiError(req, "请选择要恢复的项目", "Select projects to restore", 400);
  const restored = await getDb().update(projects).set({ deletedAt: null, updatedAt: new Date() })
    .where(and(inArray(projects.id, ids), isNotNull(projects.deletedAt))).returning({ id: projects.id });
  return NextResponse.json({ success: true, count: restored.length });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { ids?: unknown };
  const ids = idsFrom(body.ids);
  if (!ids.length) return apiError(req, "请选择要永久删除的项目", "Select projects to delete permanently", 400);
  const db = getDb();
  const deleted = await db.delete(projects)
    .where(and(inArray(projects.id, ids), isNotNull(projects.deletedAt))).returning({ id: projects.id });
  await Promise.all(deleted.flatMap(({ id }) => [
    rm(join(getUploadsDir(), id), { recursive: true, force: true }).catch(() => {}),
    rm(join(getOutputDir(), id), { recursive: true, force: true }).catch(() => {}),
  ]));
  return NextResponse.json({ success: true, count: deleted.length });
}
