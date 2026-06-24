import { Bolt, CheckCircle2, Download, FileVideo, Info, Radio, Timer, Wand2 } from "lucide-react";
import type { Job, UploadResult } from "../api/client";
import { api } from "../api/client";
import { formatClock, formatDuration } from "../utils/format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

interface Props {
  upload: UploadResult | null;
  job: Job | null;
  connected: boolean;
  busy: boolean;
  onStart: () => void;
}

export default function RunPanel({ upload, job, connected, busy, onStart }: Props) {
  const previewUrl = upload ? api.assetPreviewUrl(upload.path) : null;
  const success = job?.tasks.find((t) => t.status === "success" && t.output);
  const failedTask = job?.tasks.find((t) => t.status === "failed");

  let current = 0;
  if (job?.status === "scanning") current = 1;
  else if (job?.status === "running") current = 2;
  else if (job?.status === "completed") current = 3;

  const running = job?.status === "scanning" || job?.status === "running";
  const pipeline = [
    { label: "素材校验", note: "文件结构与尺寸检查" },
    { label: "内容解析", note: "镜头节奏与关键信息识别" },
    { label: "配音合成", note: running ? formatClock(job?.elapsed_seconds ?? 0) : "口播 / 字幕 / 合成" },
    { label: "成片交付", note: success ? "已生成可下载文件" : "完成后提供预览与下载" },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-[1.35rem] border border-[hsl(var(--border)/0.82)] bg-[hsl(var(--card)/0.95)] p-5 shadow-[var(--shadow-sm)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--muted-foreground))]">
              <Radio size={15} className={connected ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"} />
              {job ? (connected ? "实时生成中" : "渲染任务") : "准备就绪，等待启动"}
            </div>
            <div className="mt-3 text-[clamp(1.6rem,2vw,2.1rem)] font-semibold tracking-tight">{job ? "成片工作流正在推进" : "开始生成你的成片"}</div>
            <div className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
              {job ? "系统会持续完成解析、配音、字幕和渲染，并在完成后交付可下载成片。" : "确认当前配置后即可启动自动生成流程，系统会按模板策略完成全部处理。"}
            </div>
          </div>
          {job && <Badge variant={connected ? "success" : "secondary"}>{connected ? "实时同步" : "任务结束"}</Badge>}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[1rem] border border-[hsl(var(--border)/0.72)] bg-[hsl(var(--card)/0.88)] p-4 shadow-[var(--shadow-xs)]">
            <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">当前状态</div>
            <div className="mt-2 text-sm font-semibold">{running ? "正在处理" : success ? "已完成" : job ? "等待结果" : "待启动"}</div>
          </div>
          <div className="rounded-[1rem] border border-[hsl(var(--border)/0.72)] bg-[hsl(var(--card)/0.88)] p-4 shadow-[var(--shadow-xs)]">
            <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">已用时</div>
            <div className="mt-2 text-sm font-semibold">{job ? formatClock(job.elapsed_seconds) : "00:00"}</div>
          </div>
          <div className="rounded-[1rem] border border-[hsl(var(--border)/0.72)] bg-[hsl(var(--card)/0.88)] p-4 shadow-[var(--shadow-xs)]">
            <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">交付阶段</div>
            <div className="mt-2 text-sm font-semibold">{success ? "可下载" : "处理中"}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <div className="overflow-hidden rounded-[1.25rem] border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--muted)/0.4)] shadow-[var(--shadow-sm)]">
          {previewUrl ? <video className="cc-video" src={previewUrl} controls preload="metadata" /> : (
            <div className="cc-preview-empty">
              <FileVideo size={28} />
              <span>上传视频后在此查看素材预览</span>
            </div>
          )}
        </div>

        <div className="rounded-[1.25rem] border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--muted)/0.24)] p-5 text-sm shadow-[var(--shadow-xs)]">
          <div className="mb-4 flex items-center gap-2 text-base font-semibold"><Wand2 size={16} className="text-[hsl(var(--primary))]" /> 渲染上下文</div>
          <div className="cc-meta-row"><span>文件</span><b title={upload?.name || "未上传"}>{upload?.name || "未上传"}</b></div>
          <div className="cc-meta-row"><span>分辨率</span><b>{upload ? `${upload.asset.width} × ${upload.asset.height}` : "待识别"}</b></div>
          <div className="cc-meta-row"><span>时长</span><b>{upload ? formatDuration(upload.asset.duration) : "待识别"}</b></div>
          <div className="cc-meta-row"><span>连接状态</span><b>{connected ? "实时同步" : job ? "任务已结束" : "待启动"}</b></div>
        </div>
      </div>

      <Button size="lg" className="w-full rounded-[1rem] shadow-[0_20px_40px_rgba(201,111,74,0.18)]" disabled={!upload || running} onClick={onStart}>
        <Bolt size={16} />
        {busy || running ? "正在生成成片..." : "启动成片生成"}
      </Button>

      <div className="rounded-[1.25rem] border border-[hsl(var(--border)/0.82)] bg-[hsl(var(--card)/0.78)] p-5 shadow-[var(--shadow-sm)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-base font-semibold">生成流程</div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">全链路自动执行</div>
        </div>
        <div className="space-y-3 text-sm">
          {pipeline.map((item, idx) => {
            const done = current > idx;
            const active = current === idx || (!job && idx === 0);
            return (
              <div key={item.label} className={done || active ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"}>
                <div className="cc-selection-feedback flex items-center gap-3 rounded-[1rem] border border-[hsl(var(--border)/0.62)] bg-[hsl(var(--muted)/0.28)] px-4 py-3">
                  <span className={`inline-grid h-8 w-8 place-items-center rounded-full ${done ? "bg-[hsl(var(--foreground))] text-white" : active ? "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]" : "bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]"}`}>
                    {done ? <CheckCircle2 size={16} /> : idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{item.label}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{item.note}</div>
                  </div>
                  {idx === 2 && running && <span className="flex items-center gap-1 text-xs"><Timer size={12} />进行中</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {failedTask && (
        <Alert variant="destructive">
          <AlertTitle className="flex items-center gap-2"><Info size={14} /> 生成失败</AlertTitle>
          <AlertDescription>{failedTask.error || job?.error || "未知错误"}</AlertDescription>
        </Alert>
      )}

      {success && success.output && (
        <div className="space-y-4 rounded-[1.25rem] border border-[hsl(var(--border)/0.82)] bg-[hsl(var(--card)/0.78)] p-5 shadow-[var(--shadow-sm)]">
          <div>
            <div className="text-base font-semibold">成片预览</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">已完成导出，可直接预览并下载最终视频。</div>
          </div>
          <video className="cc-video" src={api.jobFileUrl(job!.id, success.output)} controls preload="metadata" />
          <a href={api.jobFileUrl(job!.id, success.output)} download>
            <Button variant="outline" className="w-full rounded-[1rem]">
              <Download size={16} /> 下载成品
            </Button>
          </a>
        </div>
      )}
    </div>
  );
}
