import { NextRequest } from "next/server";
import { getDataDir } from "@/lib/paths";
import { apiError } from "@/lib/api-error";
import { stat } from "fs/promises";
import { join, normalize, sep } from "path";
import { existsSync } from "fs";
import { createMediaFileResponse } from "@/lib/media-runtime";

// File server for composed output (video) — serves finished clips under data/output for playback and download.
// Streams from disk (no whole-file buffering) and supports single-range HTTP Range requests (206),
// so <video> seeking and iOS Safari playback work without re-downloading the entire file.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  const outputRoot = join(getDataDir(), "output");
  // Decode and normalize the path to prevent path traversal via encoded sequences like ..%2f
  const decodedSegments = path.map((seg) => decodeURIComponent(seg));
  const filePath = normalize(join(outputRoot, ...decodedSegments));

  if (filePath !== outputRoot && !filePath.startsWith(outputRoot + sep)) {
    return apiError(req, "非法路径", "Invalid path", 403);
  }

  if (!existsSync(filePath)) {
    return apiError(req, "文件不存在", "File not found", 404);
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    return apiError(req, "文件不存在", "File not found", 404);
  }
  const ext = filePath.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    // poster thumbnails (<output>.thumb.jpg) ride the same file server as the videos
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };

  // Optional download: when ?download=1 is present, instruct the browser to download the file
  const download = req.nextUrl.searchParams.get("download");
  const fileName = filePath.split(sep).pop() ?? "video.mp4";

  return createMediaFileResponse(filePath, {
    contentType: mimeTypes[ext || ""] || "application/octet-stream",
    rangeHeader: req.headers.get("range"),
    cacheControl: "public, max-age=3600",
    signal: req.signal,
    ...(download ? { downloadName: fileName } : {}),
  });
}
