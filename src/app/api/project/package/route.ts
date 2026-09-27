import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getSqlite } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { ProjectPackageError, ProjectPackageService } from "@/lib/project-package";

export const runtime = "nodejs";

const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ProjectPackageError) {
    const tooLarge = ["ARCHIVE_TOO_LARGE", "ENTRY_TOO_LARGE", "EXPANDED_SIZE_EXCEEDED", "TOO_MANY_ENTRIES", "COMPRESSION_BOMB"].includes(error.code);
    const status = error.code === "INSUFFICIENT_DISK" ? 507 : tooLarge ? 413 : error.code === "PROJECT_PATH_CONFLICT" ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof DOMException && error.name === "AbortError") return NextResponse.json({ error: "Project package import cancelled", code: "IMPORT_CANCELLED" }, { status: 499 });
  console.error("Project package import failed:", error);
  return NextResponse.json({ error: error instanceof Error ? error.message : "Project package import failed", code: "IMPORT_FAILED" }, { status: 500 });
}

async function saveRequestBody(request: NextRequest, path: string): Promise<number> {
  if (!request.body) throw new ProjectPackageError("EMPTY_ARCHIVE", "Project package body is empty");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) throw new ProjectPackageError("ARCHIVE_TOO_LARGE", "Project package exceeds the archive size limit");
  const handle = await open(path, "wx");
  const reader = request.body.getReader();
  let received = 0;
  try {
    while (true) {
      if (request.signal.aborted) throw new DOMException("Project package import cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_ARCHIVE_BYTES) throw new ProjectPackageError("ARCHIVE_TOO_LARGE", "Project package exceeds the archive size limit");
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
  if (received === 0) throw new ProjectPackageError("EMPTY_ARCHIVE", "Project package body is empty");
  return received;
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== "application/vnd.mora.project+zip" && contentType !== "application/octet-stream") {
    return NextResponse.json({ error: "Expected a .mora project package", code: "INVALID_CONTENT_TYPE" }, { status: 415 });
  }
  await mkdir(getDataDir(), { recursive: true });
  const uploadRoot = await mkdtemp(join(getDataDir(), ".mora-upload-"));
  const packagePath = join(uploadRoot, "incoming.mora");
  try {
    await saveRequestBody(request, packagePath);
    const service = new ProjectPackageService({ database: getSqlite(), dataDir: getDataDir() });
    const result = await service.importPackage(packagePath, { signal: request.signal });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await rm(uploadRoot, { recursive: true, force: true });
  }
}
