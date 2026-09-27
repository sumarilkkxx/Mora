import { createHash, randomUUID } from "node:crypto";
import AdmZip from "adm-zip";

export const DIAGNOSTIC_BUNDLE_FORMAT = "mora-diagnostics";
export const DIAGNOSTIC_BUNDLE_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

export interface DiagnosticSources {
  application: (signal?: AbortSignal) => Promise<UnknownRecord>;
  system: (signal?: AbortSignal) => Promise<UnknownRecord>;
  database: (signal?: AbortSignal) => Promise<UnknownRecord>;
  media: (signal?: AbortSignal) => Promise<UnknownRecord>;
}

export interface DiagnosticPreviewFile {
  path: "README.txt" | "diagnostics.json" | "manifest.json";
  category: "guide" | "diagnostics" | "manifest";
  sizeBytes: number;
  sha256: string;
  content: string;
}

export interface DiagnosticDraft {
  id: string;
  format: typeof DIAGNOSTIC_BUNDLE_FORMAT;
  version: typeof DIAGNOSTIC_BUNDLE_VERSION;
  generatedAt: string;
  riskNotice: string;
  missing: Array<keyof DiagnosticSources>;
  files: DiagnosticPreviewFile[];
}

interface DiagnosticBundleServiceOptions {
  sources: DiagnosticSources;
  now?: () => Date;
  randomId?: () => string;
}

interface ExportOptions {
  signal?: AbortSignal;
}

const EXPECTED_FILES = ["README.txt", "diagnostics.json", "manifest.json"] as const;
const RISK_NOTICE = "请在导出前检查全部文件。诊断包只包含白名单环境、迁移、媒体工具和操作阶段信息；不会包含凭证、用户媒体、完整提示词、商品内容、日志，也不会自动上传或发送。";

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function safeString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.trim() ? redactString(value.trim()).slice(0, 160) : fallback;
}

function safeNullableString(value: unknown): string | null {
  return value == null ? null : safeString(value);
}

function safeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function safeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function classifyError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? "");
  if (/authori[sz]ation|bearer|cookie|credential|api[ _-]?key|token/i.test(message)) return "authorization";
  if (/ffmpeg|ffprobe|codec|media/i.test(message)) return "media_runtime";
  if (/sqlite|database|migration|db\b/i.test(message)) return "database";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/cancel|abort/i.test(message)) return "cancelled";
  return "unknown";
}

function redactString(value: string): string {
  return value
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(/\b[A-Za-z]:\\(?:[^\s"'<>]+\\)*[^\s"'<>]*/g, "[REDACTED_PATH]")
    .replace(/(^|[\s(])\/(?:Users|home|private|var|tmp|Volumes|opt|usr|data)(?:\/[^\s"'<>]*)?/gi, "$1[REDACTED_PATH]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED_AUTH]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_-]+|AKIA[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{12,})\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\b(api[_ -]?key|authorization|cookie|password|secret|token|session)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function normalizeApplication(value: unknown) {
  const source = asRecord(value);
  return {
    status: "available",
    version: safeString(source.version),
    buildVersion: safeString(source.buildVersion),
  };
}

function normalizeSystem(value: unknown) {
  const source = asRecord(value);
  return {
    status: "available",
    platform: safeString(source.platform),
    arch: safeString(source.arch),
    release: safeString(source.release),
    nodeVersion: safeString(source.nodeVersion),
    electronVersion: safeNullableString(source.electronVersion),
  };
}

function normalizeDatabase(value: unknown) {
  const source = asRecord(value);
  const operations = Array.isArray(source.operations) ? source.operations.slice(0, 50).map(item => {
    const operation = asRecord(item);
    const rawError = typeof operation.error === "string" ? operation.error : null;
    return {
      kind: safeString(operation.kind),
      status: safeString(operation.status),
      stage: safeString(operation.stage),
      attempt: safeInteger(operation.attempt),
      createdAt: safeIsoDate(operation.createdAt),
      updatedAt: safeIsoDate(operation.updatedAt),
      ...(rawError ? {
        errorCategory: classifyError(rawError),
        errorFingerprint: sha256(rawError).slice(0, 16),
      } : {}),
    };
  }) : [];
  return {
    status: source.status === "degraded" ? "degraded" : "available",
    migrationVersion: safeString(source.migrationVersion),
    migrationCount: safeInteger(source.migrationCount),
    operationCount: operations.length,
    operations,
  };
}

function normalizeTool(value: unknown) {
  const source = asRecord(value);
  const status = source.status === "available" ? "available" : "unavailable";
  return {
    status,
    ...(status === "available" ? { version: safeString(source.version) } : { errorCode: safeString(source.errorCode, "tool_unavailable") }),
  };
}

function normalizeMedia(value: unknown) {
  const source = asRecord(value);
  const ffmpeg = normalizeTool(source.ffmpeg);
  const ffprobe = normalizeTool(source.ffprobe);
  return {
    status: ffmpeg.status === "available" && ffprobe.status === "available" ? "available" : "degraded",
    ffmpeg,
    ffprobe,
  };
}

function unavailable(error: unknown) {
  const category = classifyError(error);
  return { status: "unavailable", errorCode: category === "unknown" ? "probe_failed" : category };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function previewFile(path: DiagnosticPreviewFile["path"], category: DiagnosticPreviewFile["category"], content: string): DiagnosticPreviewFile {
  return { path, category, sizeBytes: Buffer.byteLength(content), sha256: sha256(content), content };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Diagnostic bundle export cancelled", "AbortError");
}

/**
 * Local-only diagnostic boundary. Sources may fail independently, while this
 * service owns whitelist projection, redaction, preview integrity and archive creation.
 */
export class DiagnosticBundleService {
  private readonly sources: DiagnosticSources;
  private readonly now: () => Date;
  private readonly randomId: () => string;

  constructor(options: DiagnosticBundleServiceOptions) {
    this.sources = options.sources;
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
  }

  async generate(options: ExportOptions = {}): Promise<DiagnosticDraft> {
    throwIfAborted(options.signal);
    const missing: Array<keyof DiagnosticSources> = [];
    const collect = async (name: keyof DiagnosticSources, normalize: (value: unknown) => unknown) => {
      try {
        const result = await this.sources[name](options.signal);
        throwIfAborted(options.signal);
        return normalize(result);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        missing.push(name);
        return unavailable(error);
      }
    };
    const generatedAt = this.now().toISOString();
    const sections = {
      application: await collect("application", normalizeApplication),
      system: await collect("system", normalizeSystem),
      database: await collect("database", normalizeDatabase),
      media: await collect("media", normalizeMedia),
    };
    const diagnosticsContent = json({
      format: DIAGNOSTIC_BUNDLE_FORMAT,
      version: DIAGNOSTIC_BUNDLE_VERSION,
      generatedAt,
      sections,
      missing,
    });
    const readmeContent = [
      "Mora 本地诊断包",
      "",
      RISK_NOTICE,
      "",
      `生成时间：${generatedAt}`,
      `缺失部分：${missing.length ? missing.join(", ") : "无"}`,
      "",
    ].join("\n");
    const firstFiles = [
      previewFile("README.txt", "guide", readmeContent),
      previewFile("diagnostics.json", "diagnostics", diagnosticsContent),
    ];
    const manifestContent = json({
      format: DIAGNOSTIC_BUNDLE_FORMAT,
      version: DIAGNOSTIC_BUNDLE_VERSION,
      generatedAt,
      files: firstFiles.map(({ path, category, sizeBytes, sha256: hash }) => ({ path, category, sizeBytes, sha256: hash })),
    });
    return {
      id: this.randomId(),
      format: DIAGNOSTIC_BUNDLE_FORMAT,
      version: DIAGNOSTIC_BUNDLE_VERSION,
      generatedAt,
      riskNotice: RISK_NOTICE,
      missing,
      files: [...firstFiles, previewFile("manifest.json", "manifest", manifestContent)],
    };
  }

  async export(draft: DiagnosticDraft, options: ExportOptions = {}): Promise<Buffer> {
    throwIfAborted(options.signal);
    if (draft.format !== DIAGNOSTIC_BUNDLE_FORMAT || draft.version !== DIAGNOSTIC_BUNDLE_VERSION) throw new Error("Unsupported diagnostic draft");
    if (draft.files.length !== EXPECTED_FILES.length || draft.files.some((file, index) => file.path !== EXPECTED_FILES[index])) throw new Error("Diagnostic draft file list changed after preview");
    for (const file of draft.files) {
      if (Buffer.byteLength(file.content) !== file.sizeBytes || sha256(file.content) !== file.sha256) throw new Error(`Diagnostic draft changed after preview: ${file.path}`);
    }
    const archive = new AdmZip();
    for (const file of draft.files) archive.addFile(file.path, Buffer.from(file.content, "utf8"));
    throwIfAborted(options.signal);
    return archive.toBuffer();
  }
}
