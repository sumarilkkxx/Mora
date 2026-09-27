import { NextRequest } from "next/server";
import { getDataDir } from "@/lib/paths";
import { apiError } from "@/lib/api-error";
import { open, stat } from "fs/promises";
import { join, normalize, sep } from "path";
import { existsSync } from "fs";
import { detectImageMime } from "@/lib/image-format";
import { createMediaFileResponse } from "@/lib/media-runtime";

// Static file server - serves uploaded images/videos.
// Streams from disk (no whole-file buffering) and supports single-range HTTP Range requests (206),
// so video previews can seek without re-downloading and memory stays flat under concurrent loads.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // Root directory for uploads
  const uploadsRoot = join(getDataDir(), "uploads");
  // Decode and normalize path segments before joining to prevent path traversal via encodings like ..%2f
  const decodedSegments = path.map((seg) => decodeURIComponent(seg));
  const filePath = normalize(join(uploadsRoot, ...decodedSegments));

  // Verify the resolved path is still within the uploads root directory
  if (filePath !== uploadsRoot && !filePath.startsWith(uploadsRoot + sep)) {
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
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    m4v: "video/x-m4v",
  };

  let contentType = mimeTypes[ext || ""] || "application/octet-stream";
  if (contentType.startsWith("image/") && contentType !== "image/svg+xml") {
    const handle = await open(filePath, "r");
    try {
      const signature = Buffer.alloc(16);
      const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
      contentType = detectImageMime(signature.subarray(0, bytesRead)) ?? contentType;
    } finally {
      await handle.close();
    }
  }

  return createMediaFileResponse(filePath, {
    contentType,
    rangeHeader: req.headers.get("range"),
    cacheControl: "public, max-age=31536000",
    signal: req.signal,
  });
}
