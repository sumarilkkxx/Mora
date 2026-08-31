export type SupportedImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "image/bmp";

/**
 * Detect an image's real format from its binary signature.
 *
 * Provider metadata, HTTP Content-Type headers, and file extensions are all
 * advisory. Some image APIs return WebP bytes while labelling them image/png;
 * forwarding that declaration causes strict video APIs to reject the image.
 */
export function detectImageMime(bytes: Uint8Array): SupportedImageMime | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) return "image/webp";

  if (bytes.length >= 6) {
    const signature = ascii(bytes, 0, 6);
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }

  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  return undefined;
}

export function imageExtension(mime: string): string {
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  return "png";
}

export function imageDataUri(bytes: Uint8Array, declaredMime?: string): string {
  const mime = detectImageMime(bytes) ?? declaredMime ?? "image/png";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Correct a data URI whose declared MIME disagrees with its decoded bytes. */
export function normalizeImageDataUri(ref: string): string {
  if (!ref.startsWith("data:")) return ref;
  const comma = ref.indexOf(",");
  if (comma === -1) return ref;
  const meta = ref.slice(5, comma);
  const declaredMime = meta.split(";")[0] || "image/png";
  try {
    const bytes = /;base64/i.test(meta)
      ? Buffer.from(ref.slice(comma + 1), "base64")
      : Buffer.from(decodeURIComponent(ref.slice(comma + 1)), "utf8");
    return imageDataUri(bytes, declaredMime);
  } catch {
    return ref;
  }
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
