import { withBatchExecution } from "@/lib/batch-execution";
import { NextRequest, NextResponse } from "next/server";
import { fileNameOf } from "@/lib/paths";
import { getDb } from "@/lib/db";
import { compositions, projects } from "@/lib/db/schema";
import { and, desc, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { productionModeForCreation, productionModeForVideoOrigin } from "@/lib/production-mode";
import { normalizeTargetVideoDuration } from "@/lib/target-video-duration";
import { userVisibleProjects } from "@/lib/project-visibility";

// fetch project list, most recently edited first (the /start "continue" cards rely on this order)
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const includeTrash = req.nextUrl.searchParams.get("trash") === "1";
    const result = await db.select().from(projects)
      .where(and(userVisibleProjects(), includeTrash ? isNotNull(projects.deletedAt) : isNull(projects.deletedAt)))
      .orderBy(desc(includeTrash ? projects.deletedAt : projects.updatedAt));
    if (result.length === 0) return NextResponse.json(result);

    // One batched query (not N+1): the newest non-failed final-video job owns the
    // current workflow. Image/audio provenance is intentionally absent here.
    const compositionRows = await db
      .select({ projectId: compositions.projectId, videoOrigin: compositions.videoOrigin, thumbnailPath: compositions.thumbnailPath, status: compositions.status })
      .from(compositions)
      .where(and(
        inArray(compositions.projectId, result.map((project) => project.id)),
        ne(compositions.status, "failed"),
      ))
      .orderBy(desc(compositions.createdAt));
    const latestOrigin = new Map<string, string>();
    const posters = new Map<string, string>();
    for (const row of compositionRows) {
      if (!latestOrigin.has(row.projectId)) latestOrigin.set(row.projectId, row.videoOrigin);
      const thumbnail = fileNameOf(row.thumbnailPath);
      if (row.status === "done" && thumbnail && !posters.has(row.projectId)) {
        posters.set(row.projectId, `/api/output/${row.projectId}/${encodeURIComponent(thumbnail)}`);
      }
    }
    return NextResponse.json(result.map((project) => ({
      ...project,
      thumbnailUrl: posters.get(project.id) ?? null,
      productionMode: productionModeForVideoOrigin(latestOrigin.get(project.id), project.productionMode),
    })));
  } catch (error) {
    console.error("获取项目列表失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取项目列表失败" },
      { status: 500 }
    );
  }
}

// create a new project
export async function POST(req: NextRequest) {
  return withBatchExecution(req, "project", () => handlePost(req));
}

async function handlePost(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();

    // validate videoMode / sourceType against enum allowlists; fall back to default for invalid values
    const VIDEO_MODES = ["product_closeup", "graphic_montage", "scene_demo", "live_presenter"];
    const videoMode = VIDEO_MODES.includes(body.videoMode) ? body.videoMode : undefined;
    const sourceType = body.sourceType === "clone" ? "clone" : undefined;
    const workflowType = body.workflowType === "edit" ? "edit" : "generate";
    const productionMode = productionModeForCreation(body.productionMode);

    const newProject = await db
      .insert(projects)
      .values({
        name: body.name || "未命名项目",
        workflowType,
        productionMode,
        targetDuration: normalizeTargetVideoDuration(body.targetDuration),
        productName: body.productName,
        productCategory: body.productCategory,
        productDescription: body.productDescription,
        productImages: body.productImages || [],
        ...(videoMode && { videoMode }),
        ...(sourceType && { sourceType }),
        ...(body.sourceVideoUrl && { sourceVideoUrl: body.sourceVideoUrl }),
      })
      .returning();

    return NextResponse.json(newProject[0], { status: 201 });
  } catch (error) {
    console.error("创建项目失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建项目失败" },
      { status: 500 }
    );
  }
}
