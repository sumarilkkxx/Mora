import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";
import { detectImageMime, imageExtension } from "@/lib/image-format";
import { validateOrDelete } from "@/lib/media-validate";
import { MAX_DOWNLOAD_BYTES } from "@/lib/providers/stock-types";
import { resolveUploadFilePath } from "@/lib/remote-image";
import { readResponseBuffer, safeFetch } from "@/lib/ssrf-guard";

/**
 * Materialise an AI image result for FFmpeg. Providers may return a data URI,
 * an expiring HTTPS URL, or an already-local /api/files reference. Derived
 * artwork must never depend on an expiring provider URL while it is rendered.
 */
export async function persistDerivedImage(projectId: string, source: string, prefix: string): Promise<string> {
  const local = resolveUploadFilePath(source);
  if (local) return local;

  let bytes: Buffer;
  let declaredMime = "image/png";
  if (source.startsWith("data:")) {
    const comma = source.indexOf(",");
    if (comma < 0) throw new Error("无法解析 AI 图片 data URI");
    const meta = source.slice(5, comma);
    declaredMime = meta.split(";")[0] || declaredMime;
    bytes = /;base64/i.test(meta)
      ? Buffer.from(source.slice(comma + 1), "base64")
      : Buffer.from(decodeURIComponent(source.slice(comma + 1)), "utf8");
  } else if (/^https?:\/\//i.test(source)) {
    const response = await safeFetch(source);
    if (!response.ok) throw new Error(`下载 AI 图片失败: ${response.status}`);
    bytes = await readResponseBuffer(response, MAX_DOWNLOAD_BYTES, "AI 图片");
    declaredMime = response.headers.get("content-type")?.split(";")[0] || declaredMime;
  } else {
    throw new Error("不支持的 AI 图片来源");
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error("AI 图片为空或体积超过安全上限");
  const mime = detectImageMime(bytes) ?? declaredMime;
  const ext = imageExtension(mime);
  const dir = join(getDataDir(), "uploads", projectId, "derived");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${prefix}-${Date.now()}.${ext}`);
  await writeFile(path, bytes);
  if (!(await validateOrDelete(path, "image"))) throw new Error("AI 图片文件损坏或格式不受支持");
  return path;
}
