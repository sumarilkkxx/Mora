import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSqlite } from "@/lib/db";
import { createFileResponseStream } from "@/lib/file-response-stream";
import { getDataDir } from "@/lib/paths";
import { ProjectPackageError, ProjectPackageService } from "@/lib/project-package";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ProjectPackageError) {
    const status = error.code === "PROJECT_NOT_FOUND" ? 404
      : error.code === "INSUFFICIENT_DISK" ? 507
        : error.code === "SOURCE_FILE_MISSING" ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  console.error("Project package export failed:", error);
  return NextResponse.json({ error: error instanceof Error ? error.message : "Project package export failed", code: "EXPORT_FAILED" }, { status: 500 });
}

function downloadName(name: string): string {
  const safe = name.replace(/[\\/\0-\x1f\x7f]/g, "-").trim().slice(0, 80) || "project";
  return `${safe}.mora`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) return NextResponse.json({ error: "Invalid project ID", code: "INVALID_PROJECT_ID" }, { status: 400 });
  const service = new ProjectPackageService({ database: getSqlite(), dataDir: getDataDir() });
  try {
    if (request.nextUrl.searchParams.get("estimate") === "1") return NextResponse.json(await service.estimate(id));

    const exportRoot = join(getDataDir(), ".mora-exports", randomUUID());
    const packagePath = join(exportRoot, "project.mora");
    await mkdir(exportRoot, { recursive: true });
    try {
      const result = await service.export(id, packagePath, { signal: request.signal });
      const info = await stat(packagePath);
      const project = getSqlite().prepare("select name from projects where id = ?").get(id) as { name: string };
      const name = downloadName(project.name);
      const stream = await createFileResponseStream(packagePath, {
        end: info.size - 1,
        signal: request.signal,
        onClose: () => rm(exportRoot, { recursive: true, force: true }),
      });
      return new NextResponse(stream, {
        headers: {
          "Content-Type": "application/vnd.mora.project+zip",
          "Content-Length": String(info.size),
          "Content-Disposition": `attachment; filename="project.mora"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Cache-Control": "no-store",
          "X-Mora-Manifest-SHA256": result.manifestSha256,
          "X-Mora-Expanded-Bytes": String(result.sourceBytes),
        },
      });
    } catch (error) {
      await rm(exportRoot, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
