import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderCapabilityContract } from "@/lib/provider-capability-contract";
import { validateOrDelete, type MediaKind } from "@/lib/media-validate";
import { readResponseBuffer, safeFetch } from "@/lib/ssrf-guard";

const DEFAULT_MAX_BYTES: Record<MediaKind, number> = {
  image: 20 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
};

export function providerMediaRequestHeaders(
  contract: ProviderCapabilityContract,
  source: string,
  apiKey: string,
): HeadersInit | undefined {
  if (contract.output.authentication !== "provider-bearer" || !apiKey) return undefined;
  try {
    const url = new URL(source);
    if (contract.provider === "openrouter" && url.protocol === "https:" && url.hostname === "openrouter.ai" && url.pathname.startsWith("/api/")) {
      return { Authorization: `Bearer ${apiKey}` };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function decodeDataUri(source: string): Buffer {
  const comma = source.indexOf(",");
  if (comma < 0) throw new Error("Provider 媒体 data URI 无法解析");
  const metadata = source.slice(5, comma);
  return /;base64(?:;|$)/i.test(metadata)
    ? Buffer.from(source.slice(comma + 1), "base64")
    : Buffer.from(decodeURIComponent(source.slice(comma + 1)), "utf8");
}

function expectedOutput(kind: MediaKind): ProviderCapabilityContract["output"]["mediaType"] {
  return kind;
}

export async function persistProviderMedia(input: {
  source: string;
  destination: string;
  kind: MediaKind;
  contract: ProviderCapabilityContract;
  apiKey: string;
}): Promise<string> {
  if (input.contract.output.mediaType !== expectedOutput(input.kind)) {
    throw new Error(`Provider 契约输出为 ${input.contract.output.mediaType}，不能按 ${input.kind} 落盘`);
  }
  const maxBytes = input.contract.output.maxBytes ?? DEFAULT_MAX_BYTES[input.kind];
  try {
    let bytes: Buffer;
    if (input.source.startsWith("data:")) {
      bytes = decodeDataUri(input.source);
      if (bytes.byteLength > maxBytes) throw new Error(`Provider 媒体体积超过 ${maxBytes} 字节安全上限`);
    } else if (/^https:\/\//i.test(input.source)) {
      const response = await safeFetch(input.source, {
        headers: providerMediaRequestHeaders(input.contract, input.source, input.apiKey),
      });
      if (!response.ok) throw new Error(`下载 Provider 媒体失败: ${response.status} ${response.statusText}`);
      bytes = await readResponseBuffer(response, maxBytes, "Provider 媒体");
    } else {
      throw new Error("Provider 媒体来源必须是 HTTPS URL 或 data URI");
    }
    if (bytes.byteLength === 0) throw new Error("Provider 媒体为空");
    await mkdir(dirname(input.destination), { recursive: true });
    await writeFile(input.destination, bytes);
    if (!(await validateOrDelete(input.destination, input.kind))) {
      const label = input.kind === "image" ? "图片" : input.kind === "video" ? "视频" : "音频";
      throw new Error(`Provider 返回的内容不是有效${label}`);
    }
    return input.destination;
  } catch (error) {
    await unlink(input.destination).catch(() => {});
    throw error;
  }
}
