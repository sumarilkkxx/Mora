import { readFile } from "fs/promises";
import { resolveExistingUploadFilePath } from "@/lib/upload-path";
export { resolveUploadFilePath } from "@/lib/upload-path";
import { imageDataUri, normalizeImageDataUri } from "@/lib/image-format";

/**
 * Convert a local `/api/files` path to a base64 data URI (remote providers cannot access localhost and require a data URI or public URL).
 * http(s) URLs and data URIs are passed through unchanged; non-local paths or path-traversal attempts return ref as-is (no disk read).
 */
export async function toRemoteUsableImage(ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  if (ref.startsWith("data:")) return normalizeImageDataUri(ref);
  if (ref.startsWith("http")) return ref;
  const filePath = resolveExistingUploadFilePath(ref);
  if (!filePath) return ref; // not an /api/files path or path traversal — skip disk read, return as-is
  try {
    const buf = await readFile(filePath);
    const ext = filePath.split(".").pop()?.toLowerCase() || "png";
    const declaredMime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    return imageDataUri(buf, declaredMime);
  } catch {
    return ref;
  }
}
