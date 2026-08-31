import { NextRequest, NextResponse } from "next/server";
import { listAiTasks, listActiveAiTasksAllProjects } from "@/lib/ai-tasks";
import { errText } from "@/lib/api-error";

// List persisted AI generation tasks (issue #16 recovery UI).
// GET /api/ai/tasks?projectId=xxx&active=1 — active=1 returns only tasks still
// needing attention (submitted / processing / unknown), i.e. resumable ones.
// Without projectId, returns ALL active paid tasks across projects — the global
// task center's cross-project "any money stuck?" view.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const activeOnly = req.nextUrl.searchParams.get("active") === "1";

  try {
    const rows = projectId ? await listAiTasks(projectId, activeOnly) : await listActiveAiTasksAllProjects();
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取任务列表失败", "Failed to list tasks") },
      { status: 500 }
    );
  }
}
