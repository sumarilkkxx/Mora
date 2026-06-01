// ClipCraft API 客户端 —— 类型定义 + fetch 封装

export interface Voice {
  id: string;
  name: string;
  gender: "male" | "female";
  style: string;
  scene: string;
  recommended: boolean;
}

export interface TemplateSummary {
  name: string;
  description: string;
  tags: string[];
  version: string;
  is_default: boolean;
  canvas: { width: number | null; height: number | null; fps: number | null };
  aspect_ratio: string | null;
}

export interface VarDef {
  name: string;
  required?: boolean;
  default?: string;
  description?: string;
}

export interface TemplateDetail {
  name: string;
  description: string;
  tags: string[];
  canvas: Record<string, unknown>;
  match_rules: Record<string, unknown>;
  variables: VarDef[];
  effects: Record<string, unknown>;
  audio: { voice_id?: string; rate?: string };
}

export interface AppConfig {
  ffmpeg_available: boolean;
  ffprobe_available: boolean;
  defaults: { voice: string; rate: string; workers: number };
  project_root: string;
}

export interface Asset {
  path: string;
  type: "video" | "image" | "audio";
  duration: number | null;
  width: number;
  height: number;
  fps: number | null;
  codec: string | null;
  has_audio: boolean;
  file_size: number;
  aspect_ratio: "portrait" | "landscape" | "square";
}

export interface ScanResult {
  input_path: string;
  summary: {
    total: number;
    videos: number;
    images: number;
    audios: number;
    total_duration: number;
    total_size_mb: number;
  };
  assets: Asset[];
}

export interface UploadResult {
  path: string;
  name: string;
  asset: Asset;
}

export type TaskStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "skipped";

export interface TaskState {
  id: string;
  asset: string;
  asset_path: string;
  asset_type: string;
  template: string;
  status: TaskStatus;
  error: string | null;
  output: string | null;
  title: string;
}

export type JobStatus =
  | "pending"
  | "scanning"
  | "running"
  | "completed"
  | "failed";

export interface JobCounts {
  success: number;
  failed: number;
  skipped: number;
  processing: number;
  done: number;
  pending: number;
}

export interface Job {
  id: string;
  status: JobStatus;
  created_at: string;
  finished_at: string | null;
  elapsed_seconds: number;
  total: number;
  error: string | null;
  counts: JobCounts;
  params: {
    input_path: string;
    output_dir: string;
    template_name: string | null;
    voice: string;
    rate: string;
    workers: number;
    variables: Record<string, string>;
  };
  tasks: TaskState[];
  report: unknown;
}

export interface CreateJobRequest {
  input_path: string;
  output_dir?: string | null;
  template_name?: string | null;
  voice: string;
  rate: string;
  workers: number;
  variables: Record<string, string>;
}

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  config: () => request<AppConfig>("/config"),
  voices: () => request<Voice[]>("/voices"),
  templates: () => request<TemplateSummary[]>("/templates"),
  templateDetail: (name: string) =>
    request<TemplateDetail>(`/templates/${encodeURIComponent(name)}`),
  scan: (input_path: string) =>
    request<ScanResult>("/scan", {
      method: "POST",
      body: JSON.stringify({ input_path }),
    }),
  createJob: (req: CreateJobRequest) =>
    request<Job>("/jobs", { method: "POST", body: JSON.stringify(req) }),
  job: (id: string) => request<Job>(`/jobs/${id}`),
  jobFileUrl: (id: string, filename: string) =>
    `${BASE}/jobs/${id}/files/${encodeURIComponent(filename)}`,
  assetPreviewUrl: (path: string) =>
    `${BASE}/file?path=${encodeURIComponent(path)}`,
};

export function jobWsUrl(id: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${BASE}/jobs/${id}/ws`;
}
