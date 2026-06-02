import { useEffect, useState } from "react";
import {
  App as AntApp,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Row,
  Select,
  Slider,
  Tag,
  Upload,
} from "antd";
import { InboxOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import {
  api,
  type AppConfig,
  type TemplateDetail,
  type TemplateSummary,
  type UploadResult,
  type Voice,
} from "./api/client";
import { useJobStream } from "./hooks/useJobStream";
import TemplatePicker from "./components/TemplatePicker";
import RunPanel from "./components/RunPanel";

const { Dragger } = Upload;

export default function App() {
  const { message } = AntApp.useApp();

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);

  const [voice, setVoice] = useState("zh-CN-XiaoxiaoNeural");
  const [rate, setRate] = useState(0);
  const [variables, setVariables] = useState<Record<string, string>>({});

  const [jobId, setJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { job, connected } = useJobStream(jobId);

  useEffect(() => {
    void (async () => {
      try {
        const [c, v, t] = await Promise.all([
          api.config(),
          api.voices(),
          api.templates(),
        ]);
        setConfig(c);
        setVoices(v);
        setTemplates(t);
        setVoice(c.defaults.voice);
        setRate(parseInt(c.defaults.rate, 10) || 0);
      } catch {
        message.error("无法连接后端服务");
      }
    })();
  }, [message]);

  useEffect(() => {
    if (!selectedTemplate) {
      setDetail(null);
      return;
    }
    let alive = true;
    void api
      .templateDetail(selectedTemplate)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [selectedTemplate]);

  const handleUpload: UploadProps["onChange"] = (info) => {
    const { status, response } = info.file;
    if (status === "done") {
      setUpload(response as UploadResult);
      setJobId(null);
      message.success(`已上传：${(response as UploadResult).name}`);
    } else if (status === "error") {
      const detailMsg =
        (response as { detail?: string })?.detail || "上传失败";
      message.error(detailMsg);
    }
  };

  async function startJob() {
    if (!upload) return;
    setCreating(true);
    const vars = Object.fromEntries(
      Object.entries(variables).filter(([, val]) => val.trim() !== ""),
    );
    try {
      const created = await api.createJob({
        input_path: upload.path,
        output_dir: null,
        template_name: selectedTemplate,
        voice,
        rate: `${rate >= 0 ? "+" : ""}${rate}%`,
        workers: 1,
        variables: vars,
      });
      setJobId(created.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建任务失败");
    } finally {
      setCreating(false);
    }
  }

  const draggerProps: UploadProps = {
    name: "file",
    multiple: false,
    maxCount: 1,
    accept: ".mp4,.mov,.avi,.mkv,.webm",
    action: "/api/upload",
    showUploadList: false,
    onChange: handleUpload,
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      <header className="cc-header">
        <div className="cc-brand">
          <img className="cc-brand__mark" src="/favicon.svg" alt="ClipCraft" />
          <div>
            <div className="cc-brand__name">ClipCraft</div>
            {/* <div className="cc-brand__tag">批量视频剪辑工作台</div> */}
          </div>
        </div>
        <Tag color={config?.ffmpeg_available ? "green" : "warning"}>
          FFmpeg {config?.ffmpeg_available ? "已就绪" : "未检测到"}
        </Tag>
      </header>

      <div className="cc-content">
        <div className="cc-container">
          <Row gutter={[20, 20]}>
            <Col xs={24} lg={15}>
              <Card style={{ marginBottom: 20 }}>
                <div className="cc-card-title" style={{ marginBottom: 14 }}>
                  <span className="cc-step-no">1</span> 上传视频素材
                </div>
                <Dragger {...draggerProps}>
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text">点击或拖拽视频到此处上传</p>
                  <p className="ant-upload-hint">
                    当前支持单个视频素材（mp4 / mov / avi / mkv / webm）
                  </p>
                </Dragger>
                {upload && (
                  <Tag color="processing" style={{ marginTop: 12 }}>
                    已选择：{upload.name}
                  </Tag>
                )}
              </Card>

              <Card style={{ marginBottom: 20 }}>
                <div className="cc-card-title" style={{ marginBottom: 14 }}>
                  <span className="cc-step-no">2</span> 选择剪辑模板
                </div>
                <TemplatePicker
                  templates={templates}
                  selected={selectedTemplate}
                  onSelect={setSelectedTemplate}
                />
              </Card>

              <Card>
                <div className="cc-card-title" style={{ marginBottom: 18 }}>
                  <span className="cc-step-no">3</span> 配音与文案
                </div>
                <Form layout="vertical">
                  <Row gutter={20}>
                    <Col span={12}>
                      <Form.Item label="配音音色">
                        <Select
                          value={voice}
                          onChange={setVoice}
                          options={voices.map((v) => ({
                            value: v.id,
                            label: `${v.name}（${v.style}）· ${v.scene}${
                              v.recommended ? " ★" : ""
                            }`,
                          }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label={`语速调节（${rate >= 0 ? "+" : ""}${rate}%）`}>
                        <Slider
                          min={-50}
                          max={50}
                          step={2}
                          value={rate}
                          marks={{ 0: "正常" }}
                          onChange={setRate}
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  {detail && detail.variables.length > 0 && (
                    <>
                      <Divider plain style={{ margin: "4px 0 16px" }}>
                        文案变量 · {detail.name}
                      </Divider>
                      <Row gutter={20}>
                        {detail.variables.map((v) => (
                          <Col span={12} key={v.name}>
                            <Form.Item
                              label={v.name}
                              tooltip={v.description}
                              required={v.required}
                            >
                              <Input
                                placeholder={v.default || "（可选）"}
                                value={variables[v.name] ?? ""}
                                onChange={(e) =>
                                  setVariables((prev) => ({
                                    ...prev,
                                    [v.name]: e.target.value,
                                  }))
                                }
                              />
                            </Form.Item>
                          </Col>
                        ))}
                      </Row>
                    </>
                  )}
                </Form>
              </Card>
            </Col>

            <Col xs={24} lg={9}>
              <div className="cc-run">
                <Card>
                  <RunPanel
                    upload={upload}
                    job={job}
                    connected={connected}
                    busy={creating}
                    onStart={startJob}
                  />
                </Card>
              </div>
            </Col>
          </Row>
        </div>
      </div>
    </div>
  );
}
