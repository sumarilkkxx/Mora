import { Alert, Button, Divider, Steps, Tag } from "antd";
import {
  DownloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { Job, UploadResult } from "../api/client";
import { api } from "../api/client";
import { formatClock, formatDuration } from "../utils/format";

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
  let stepStatus: "process" | "finish" | "error" = "process";
  if (job?.status === "scanning") current = 1;
  else if (job?.status === "running") current = 2;
  else if (job?.status === "completed") {
    current = 3;
    stepStatus = "finish";
  } else if (job?.status === "failed") {
    current = 2;
    stepStatus = "error";
  }

  const running = job?.status === "scanning" || job?.status === "running";

  return (
    <div>
      <div className="cc-card-title" style={{ marginBottom: 14 }}>
        预览与生成
        {job && (
          <Tag color={connected ? "green" : "default"} style={{ marginLeft: "auto" }}>
            {connected ? "实时" : "已结束"}
          </Tag>
        )}
      </div>

      {previewUrl ? (
        <video className="cc-video" src={previewUrl} controls preload="metadata" />
      ) : (
        <div className="cc-preview-empty">上传视频后在此预览</div>
      )}

      {upload && (
        <div style={{ marginTop: 12 }}>
          <div className="cc-meta-row">
            <span>文件</span>
            <b title={upload.name}>{upload.name}</b>
          </div>
          <div className="cc-meta-row">
            <span>分辨率</span>
            <b>
              {upload.asset.width}×{upload.asset.height}
            </b>
          </div>
          <div className="cc-meta-row">
            <span>时长</span>
            <b>{formatDuration(upload.asset.duration)}</b>
          </div>
        </div>
      )}

      <Button
        type="primary"
        size="large"
        block
        icon={<ThunderboltOutlined />}
        style={{ marginTop: 16 }}
        disabled={!upload || running}
        loading={busy || running}
        onClick={onStart}
      >
        {running ? "正在生成…" : "生成视频"}
      </Button>

      {job && (
        <>
          <Divider style={{ margin: "20px 0 16px" }} />
          <Steps
            direction="vertical"
            size="small"
            current={current}
            status={stepStatus}
            items={[
              { title: "上传素材", description: upload?.name },
              { title: "解析素材", description: "提取视频元数据" },
              {
                title: "配音与渲染",
                description: running
                  ? `已用时 ${formatClock(job.elapsed_seconds)}`
                  : "TTS 配音 · 字幕 · 运镜合成",
              },
              { title: "完成", description: success ? "成品已生成" : undefined },
            ]}
          />

          {failedTask && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 12 }}
              message="生成失败"
              description={failedTask.error || job.error || "未知错误"}
            />
          )}

          {success && success.output && (
            <div style={{ marginTop: 16 }}>
              <video
                className="cc-video"
                src={api.jobFileUrl(job.id, success.output)}
                controls
                preload="metadata"
              />
              <Button
                block
                icon={<DownloadOutlined />}
                style={{ marginTop: 12 }}
                href={api.jobFileUrl(job.id, success.output)}
                download
              >
                下载成品
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
