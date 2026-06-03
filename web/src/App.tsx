import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CloudUpload,
  FileVideo,
  Info,
  LayoutDashboard,
  PanelsTopLeft,
  Sparkles,
  Wand2,
} from "lucide-react";
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
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Select } from "./components/ui/select";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import BrandMark from "./components/BrandMark";

interface Toast {
  id: number;
  variant: "info" | "warning" | "destructive" | "success";
  message: string;
}

const STEPS = [
  { key: "upload", title: "素材导入", desc: "视频入库与基础校验", eyebrow: "Source" },
  { key: "template", title: "模板编排", desc: "选择叙事结构与场景策略", eyebrow: "Template" },
  { key: "voice", title: "表达配置", desc: "控制音色、语速与变量内容", eyebrow: "Voice" },
  { key: "render", title: "渲染交付", desc: "查看进度、预览并导出成片", eyebrow: "Render" },
] as const;

const FALLBACK_TEMPLATES: TemplateSummary[] = [
  {
    name: "barbershop",
    description: "面向门店服务的前后对比、亮点字幕与快节奏剪辑。",
    tags: ["门店", "服务", "短视频"],
    version: "体验版",
    is_default: false,
    canvas: { width: 1080, height: 1920, fps: 30 },
    aspect_ratio: "portrait",
  },
  {
    name: "product_showcase",
    description: "围绕商品卖点、细节镜头和购买引导组织展示视频。",
    tags: ["商品", "电商", "展示"],
    version: "体验版",
    is_default: false,
    canvas: { width: 1080, height: 1920, fps: 30 },
    aspect_ratio: "portrait",
  },
  {
    name: "tutorial",
    description: "适合知识讲解、步骤拆解和清晰字幕的教程型视频。",
    tags: ["教程", "解说", "字幕"],
    version: "体验版",
    is_default: false,
    canvas: { width: 1920, height: 1080, fps: 30 },
    aspect_ratio: "landscape",
  },
];

const FALLBACK_VOICES: Voice[] = [
  { id: "zh-CN-XiaoxiaoNeural", name: "小晓", gender: "female", style: "年轻女声", scene: "产品推荐 / 日常", recommended: true },
  { id: "zh-CN-YunxiNeural", name: "云希", gender: "male", style: "阳光男声", scene: "教程 / 解说", recommended: false },
  { id: "zh-CN-XiaoyiNeural", name: "小艺", gender: "female", style: "温柔女声", scene: "情感 / 故事", recommended: false },
];

const TEMPLATE_LABELS: Record<string, string> = {
  __auto__: "智能匹配",
  barbershop: "门店焕新",
  product_showcase: "商品展示",
  tutorial: "教程讲解",
  emotional_story: "故事表达",
};

const TEMPLATE_SCENARIOS: Record<string, string[]> = {
  __auto__: ["快速起稿", "批量创作", "多场景适配"],
  barbershop: ["门店引流", "服务展示", "前后对比"],
  product_showcase: ["商品上新", "转化推广", "卖点拆解"],
  tutorial: ["教程培训", "步骤演示", "知识讲解"],
  emotional_story: ["品牌内容", "人物故事", "氛围表达"],
};

export default function App() {
  const [, setConfig] = useState<AppConfig | null>(null);
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
  const [activeStep, setActiveStep] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { job, connected } = useJobStream(jobId);

  function pushToast(variant: Toast["variant"], message: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, variant, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  }

  useEffect(() => {
    void (async () => {
      try {
        const [c, v, t] = await Promise.all([api.config(), api.voices(), api.templates()]);
        setConfig(c);
        setVoices(v);
        setTemplates(t);
        setVoice(c.defaults.voice);
        setRate(parseInt(c.defaults.rate, 10) || 0);
      } catch {
        setTemplates(FALLBACK_TEMPLATES);
        setVoices(FALLBACK_VOICES);
        pushToast("warning", "服务暂未连接，当前展示演示内容，可继续体验完整流程。");
      }
    })();
  }, []);

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

  async function handleDrop(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const allowed = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/x-matroska", "video/webm"];
    if (!allowed.includes(file.type)) {
      pushToast("destructive", "仅支持 mp4 / mov / avi / mkv / webm 视频文件。");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "上传失败");
      }
      const data = (await res.json()) as UploadResult;
      setUpload(data);
      setSelectedTemplate(null);
      setVariables({});
      setJobId(null);
      setActiveStep(1);
      pushToast("success", `已上传：${data.name}`);
    } catch (e) {
      pushToast("destructive", e instanceof Error ? e.message : "上传失败");
    }
  }

  async function startJob() {
    if (!upload) return pushToast("warning", "请先上传素材，再开始生成。");
    const requiredMissing = (detail?.variables || []).filter((v) => v.required && !(variables[v.name] || v.default || "").trim());
    if (requiredMissing.length > 0) return pushToast("warning", `请先填写必填字段：${requiredMissing.map((v) => v.name).join("、")}`);
    setCreating(true);
    const vars = Object.fromEntries(Object.entries(variables).filter(([, val]) => val.trim() !== ""));
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
      setActiveStep(3);
    } catch (e) {
      pushToast("destructive", e instanceof Error ? e.message : "创建任务失败");
    } finally {
      setCreating(false);
    }
  }

  const selectedVoice = voices.find((v) => v.id === voice || v.name === voice);
  const selectedTemplateLabel = TEMPLATE_LABELS[selectedTemplate ?? "__auto__"] ?? selectedTemplate ?? "智能匹配";
  const voiceOptions = voices.map((v) => ({
    value: v.id,
    label: `${v.name} · ${v.style}${v.recommended ? " · 推荐" : ""}`,
  }));

  const progressTitle = useMemo(() => ["素材导入", "模板编排", "表达配置", "渲染交付"], []);
  const completionPercent = Math.round(((activeStep + 1) / STEPS.length) * 100);
  const filledVariableCount = Object.keys(variables).filter((key) => (variables[key] || "").trim()).length;
  const currentTemplateSummary = templates.find((item) => item.name === selectedTemplate) ?? null;
  const templateScenarios = TEMPLATE_SCENARIOS[selectedTemplate ?? "__auto__"] ?? TEMPLATE_SCENARIOS.__auto__;
  const templateDescription = currentTemplateSummary?.description ?? "系统将结合素材比例、时长与内容重心，为你匹配更顺滑的成片结构。";

  function renderWorkspaceHeader() {
    return (
      <header className="cc-workspace-header">
        <div className="cc-workspace-top">
          <div className="cc-workspace-brand">
            <BrandMark className="h-11 w-11" />
            <div className="min-w-0">
              <div className="cc-app-eyebrow">ClipCraft Studio</div>
              <div className="cc-app-title-row">
                <h1>AI 视频剪辑工作台</h1>
              </div>
              <p>参考专业创作工具的布局方式，把素材、模板、表达配置与渲染交付放在同一个清晰工作区中。</p>
            </div>
          </div>

          <div className="cc-workspace-actions">
            <div className="cc-header-chip">
              <PanelsTopLeft size={15} />
              <span>多面板创作</span>
            </div>
            <div className="cc-header-chip">
              <LayoutDashboard size={15} />
              <span>{progressTitle[activeStep]}</span>
            </div>
          </div>
        </div>

        {/* Integrate the step rail into the header so the top area stays clean and ordered. */}
        <div className="cc-header-progress">{renderTopProgress()}</div>
      </header>
    );
  }

  function renderTopProgress() {
    return (
      <section className="cc-top-progress" aria-label="创作阶段">
        <div className="cc-topline">
          <div className="cc-topline-left">
            <span>创作阶段</span>
            <Badge variant="secondary" className="rounded-full">Workspace</Badge>
          </div>
          <strong>{completionPercent}%</strong>
        </div>
        <div className="cc-progress-track cc-progress-track-thin">
          <div className="cc-progress-fill" style={{ width: `${completionPercent}%` }} />
        </div>
        <div className="cc-top-rail">
          {STEPS.map((step, index) => {
            const active = index === activeStep;
            const done = index < activeStep;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => setActiveStep(index)}
                className={`cc-top-rail-item ${active ? "is-active" : ""} ${done ? "is-done" : ""}`}
                aria-current={active ? "step" : undefined}
              >
                <span className="cc-top-rail-index">{done ? <CheckCircle2 size={14} /> : index + 1}</span>
                <span className="cc-top-rail-text">
                  <em>{step.eyebrow}</em>
                  <strong>{step.title}</strong>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  function renderFooterActions(prevDisabled = false, nextDisabled = false, nextLabel = "下一步", nextAction?: () => void) {
    return (
      <div className="cc-page-footer">
        <p className="cc-page-footer-hint">
          当前阶段：<strong>{progressTitle[activeStep]}</strong>，所有配置都会实时保留，便于你像在专业工具里一样逐步调整与回看。
        </p>
        <div className="cc-page-footer-actions">
          <Button variant="outline" className="min-w-[108px] rounded-full" disabled={prevDisabled} onClick={() => setActiveStep((s) => Math.max(0, s - 1))}>
            <ArrowLeft size={16} /> 上一步
          </Button>
          <Button className="min-w-[148px] rounded-full shadow-[0_18px_34px_rgba(201,111,74,0.18)]" disabled={nextDisabled} onClick={nextAction ?? (() => setActiveStep((s) => Math.min(3, s + 1)))}>
            {nextLabel} <ArrowRight size={16} />
          </Button>
        </div>
      </div>
    );
  }

  function renderUploadPage() {
    return (
      <div key="page-upload" className="cc-workspace-grid">
        <section className="cc-main-panel">
          <div className="cc-panel-header">
            <Badge variant="secondary">Source Intake</Badge>
            <h2>导入素材并建立本次创作任务</h2>
            <p>上传后，系统会完成文件校验、基础元数据识别与后续流程预置。这个区域更像创作工具中的主工作区，专注当前动作本身。</p>
          </div>

          <div className="cc-upload-layout">
            <label className="cc-upload-zone cc-upload-zone-strong text-center">
              <input id="clip-upload" className="hidden" type="file" accept="video/*" onChange={(e) => void handleDrop(e.target.files)} />
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]">
                <CloudUpload size={28} />
              </span>
              <span className="space-y-2 text-center">
                <span className="block text-2xl font-semibold tracking-tight">点击上传视频素材</span>
                <span className="block max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                  上传成功后会自动进入模板编排区，并把素材信息同步到右侧状态面板。
                </span>
              </span>
            </label>

            <div className="cc-inspector-stack">
              <div className="cc-mini-panel">
                <div className="cc-mini-title">输入规格</div>
                <div className="cc-mini-grid">
                  <div><span>格式</span><strong>mp4 / mov / avi / mkv / webm</strong></div>
                  <div><span>自动处理</span><strong>尺寸 / 时长 / 文件信息</strong></div>
                  <div><span>适用内容</span><strong>推广、讲解、商品展示</strong></div>
                </div>
              </div>

              <div className="cc-mini-panel">
                <div className="cc-mini-title">当前素材</div>
                <div className="rounded-xl bg-[hsl(var(--muted)/0.4)] px-4 py-3.5 text-sm text-[hsl(var(--muted-foreground))]">
                  {upload ? upload.name : "尚未上传视频"}
                </div>
                {upload && (
                  <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.72)] px-4 py-1 text-sm">
                    <div className="cc-meta-row"><span>文件名称</span><b>{upload.name}</b></div>
                    <div className="cc-meta-row"><span>画面尺寸</span><b>{upload.asset.width} x {upload.asset.height}</b></div>
                    <div className="cc-meta-row"><span>素材时长</span><b>{Math.round(upload.asset.duration ?? 0)} 秒</b></div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {renderFooterActions(true, !upload, upload ? "进入模板编排" : "请先上传素材")}
        </section>

        <aside className="cc-side-panel">
          <Card className="cc-glass-card rounded-[1.6rem]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><FileVideo size={17} /> 工作区说明</CardTitle>
              <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">左侧完成主要操作，右侧持续作为状态与说明面板，减少上下跳转。</p>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="rounded-xl bg-[hsl(var(--muted)/0.45)] px-4 py-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">上传素材后，模板、配音和渲染模块会自动复用这些信息。</div>
              <div className="rounded-xl bg-[hsl(var(--muted)/0.45)] px-4 py-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">你可以随时回到任一步骤重新调整，不需要重复录入。</div>
            </CardContent>
          </Card>

          <Card className="cc-glass-card rounded-[1.6rem]">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2 text-base font-semibold"><Sparkles size={17} className="text-[hsl(var(--primary))]" /> 任务收益</div>
              <ul className="space-y-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                <li className="rounded-xl bg-[hsl(var(--muted)/0.45)] px-4 py-3">统一管理素材与配置</li>
                <li className="rounded-xl bg-[hsl(var(--muted)/0.45)] px-4 py-3">减少生成前的重复确认成本</li>
                <li className="rounded-xl bg-[hsl(var(--muted)/0.45)] px-4 py-3">更符合专业工具的工作流操作习惯</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    );
  }

  function renderTemplatePage() {
    return (
      <div key="page-template" className="cc-workspace-grid">
        <section className="cc-main-panel">
          <div className="cc-panel-header">
            <Badge variant="secondary">Template Board</Badge>
            <h2>像选择编辑预设一样确定成片结构</h2>
            <p>模板区域从营销卡片改成更接近工作台中的 preset browser，用统一信息层级展示场景、节奏和输出规格。</p>
          </div>

          <div className="cc-panel-section">
            <div className="cc-kpi-row">
              <div className="cc-kpi-card"><span>当前模式</span><strong>{selectedTemplate ? "已指定模板" : "智能匹配"}</strong></div>
              <div className="cc-kpi-card"><span>推荐策略</span><strong>有明确场景时优先手动选择</strong></div>
              <div className="cc-kpi-card"><span>输出目标</span><strong>提升信息表达与发布效率</strong></div>
            </div>
            <TemplatePicker templates={templates} selected={selectedTemplate} onSelect={setSelectedTemplate} />
          </div>

          {renderFooterActions(false, false, "进入表达配置")}
        </section>

        <aside className="cc-side-panel">
          <Card className="cc-glass-card overflow-hidden rounded-[1.6rem] border border-[hsl(var(--border)/0.7)] bg-[linear-gradient(180deg,hsl(var(--card)/0.92),hsl(var(--card)/0.78))] shadow-sm">
            <div className="h-20 bg-[radial-gradient(circle_at_20%_20%,hsl(var(--primary)/0.22),transparent_55%),radial-gradient(circle_at_80%_0%,hsl(42_78%_79%/0.38),transparent_52%),linear-gradient(135deg,hsl(24_22%_18%/0.92),hsl(34_20%_22%/0.62))]" />
            <CardContent className="space-y-4 p-5 -mt-8 relative z-10">
              <div className="rounded-[1.35rem] border border-[hsl(var(--border)/0.72)] bg-[hsl(var(--card)/0.88)] p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">当前策略</div>
                <div className="cc-text-safe mt-2 text-xl font-semibold tracking-tight">{selectedTemplateLabel}</div>
                <div className="cc-text-safe mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{templateDescription}</div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.2rem] bg-[hsl(var(--muted)/0.42)] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">成片节奏</div>
                  <div className="cc-text-safe mt-2 text-sm font-medium leading-6">{selectedTemplate === "tutorial" ? "结构清晰，适合分段讲解" : selectedTemplate === "emotional_story" ? "情绪递进，适合叙事表达" : "紧凑有重点，兼顾转化效率"}</div>
                </div>
                <div className="rounded-[1.2rem] bg-[hsl(var(--muted)/0.42)] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">变量要求</div>
                  <div className="mt-2 text-sm font-medium">{detail ? `${detail.variables.length} 项可配置字段` : "按素材自动生成内容策略"}</div>
                </div>
              </div>

              <div className="rounded-[1.35rem] border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--card)/0.72)] p-4">
                <div className="text-sm font-semibold">适用场景</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {templateScenarios.map((item) => (
                    <Badge key={item} variant="outline">{item}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Alert>
            <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center">
              <Info size={16} />
            </span>
            <AlertTitle>使用建议</AlertTitle>
            <AlertDescription>如果素材目标明确，建议优先选择贴近业务场景的模板，整体结果会更稳定、更像可复用的内容 preset。</AlertDescription>
          </Alert>
        </aside>
      </div>
    );
  }

  function renderVoicePage() {
    const vars = detail?.variables || [];
    return (
      <div key="page-voice" className="cc-workspace-grid">
        <section className="cc-main-panel">
          <div className="cc-panel-header">
            <Badge variant="secondary">Expression Inspector</Badge>
            <h2>在同一工作区里控制音色、节奏和脚本变量</h2>
            <p>这个页面调整成更接近 inspector + property panel 的结构，让配音参数与模板变量更清晰地分层展示。</p>
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <Card className="rounded-[1.5rem] border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.82)] shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2"><Sparkles size={18} className="text-[hsl(var(--primary))]" /> 音色引擎</CardTitle>
                  <div className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">选择与业务场景更匹配的中文音色，控制系统生成时的表达风格。</div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Select value={voice} onValueChange={setVoice} options={voiceOptions} />
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-[1.2rem] bg-[hsl(var(--muted)/0.5)] p-4"><div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">已选音色</div><div className="mt-2 text-lg font-semibold">{selectedVoice?.name || "待选择"}</div></div>
                    <div className="rounded-[1.2rem] bg-[hsl(var(--muted)/0.5)] p-4"><div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">声音风格</div><div className="mt-2 text-sm font-medium text-[hsl(var(--foreground))]">{selectedVoice?.style || "默认"}</div></div>
                    <div className="rounded-[1.2rem] bg-[hsl(var(--muted)/0.5)] p-4"><div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">适用场景</div><div className="mt-2 text-sm font-medium text-[hsl(var(--foreground))]">{selectedVoice?.scene || "通用场景"}</div></div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[1.5rem] border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.82)] shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2"><Wand2 size={18} className="text-[hsl(var(--primary))]" /> 文案变量面板</CardTitle>
                  <div className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">按模板要求补全标题、卖点和口播信息，保持所有字段像属性面板一样统一排布。</div>
                </CardHeader>
                <CardContent>
                  {vars.length === 0 ? (
                    <div className="rounded-[1.4rem] border border-dashed border-[hsl(var(--border))] p-6 text-sm text-[hsl(var(--muted-foreground))]">
                      当前模板无需额外变量，系统会根据素材自动组织文案与节奏。
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {vars.map((variable) => (
                        <Card key={variable.name} className="rounded-[1.3rem] border-[hsl(var(--border)/0.8)] bg-[hsl(var(--muted)/0.26)] shadow-none">
                          <CardContent className="space-y-3 p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold">{variable.name}</div>
                                {variable.description && <div className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{variable.description}</div>}
                              </div>
                              {variable.required ? <Badge>必填</Badge> : <Badge variant="secondary">选填</Badge>}
                            </div>
                            <Input
                              className="h-11 rounded-xl bg-[hsl(var(--card))]"
                              placeholder={variable.default || `请输入${variable.name}`}
                              value={variables[variable.name] ?? variable.default ?? ""}
                              onChange={(e) => setVariables((prev) => ({ ...prev, [variable.name]: e.target.value }))}
                            />
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <aside className="cc-side-panel">
              <Card className="rounded-[1.5rem] border-[hsl(var(--border)/0.8)] bg-[linear-gradient(180deg,hsl(var(--card)/0.88),hsl(var(--muted)/0.42))] shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle>表达控制台</CardTitle>
                  <div className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">集中查看关键控制项和本次生成策略，让口播表达更稳定。</div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-[1.35rem] border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.8)] p-4">
                    <div className="flex items-center justify-between text-sm"><span className="text-[hsl(var(--muted-foreground))]">语速校准</span><b>{rate >= 0 ? "+" : ""}{rate}%</b></div>
                    <input className="mt-4 w-full accent-[hsl(var(--primary))]" type="range" min="-30" max="30" step="5" value={rate} onChange={(e) => setRate(Number(e.target.value || 0))} />
                    <div className="mt-3 flex justify-between text-xs text-[hsl(var(--muted-foreground))]"><span>更沉稳</span><span>标准</span><span>更紧凑</span></div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-[1.2rem] bg-[hsl(var(--muted)/0.45)] p-4"><div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">内容节奏</div><div className="mt-2 text-sm font-medium">{rate <= -10 ? "舒缓叙述" : rate >= 10 ? "高信息密度" : "均衡表达"}</div></div>
                    <div className="rounded-[1.2rem] bg-[hsl(var(--muted)/0.45)] p-4"><div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">变量完成度</div><div className="mt-2 text-sm font-medium">{vars.length === 0 ? "无需补充" : `${filledVariableCount}/${vars.length} 项已填写`}</div></div>
                    <div className="rounded-[1.2rem] bg-[hsl(var(--muted)/0.45)] p-4"><div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">成片预期</div><div className="mt-2 text-sm font-medium">更适合用于推广发布、商品讲解和业务展示。</div></div>
                  </div>

                  <div className="rounded-[1.35rem] border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.8)] p-4 text-sm">
                    <div className="cc-meta-row"><span>素材</span><b>{upload?.name || "未上传"}</b></div>
                    <div className="cc-meta-row"><span>模板</span><b>{selectedTemplateLabel}</b></div>
                    <div className="cc-meta-row"><span>音色</span><b>{selectedVoice?.name || "默认音色"}</b></div>
                    <div className="cc-meta-row"><span>语速</span><b>{rate >= 0 ? "+" : ""}{rate}%</b></div>
                  </div>
                </CardContent>
              </Card>

              <Alert>
                <Sparkles size={16} />
                <AlertTitle>生成效果</AlertTitle>
                <AlertDescription>系统会自动完成配音、字幕、节奏编排与导出，帮助你更快产出可发布的短视频内容。</AlertDescription>
              </Alert>
            </aside>
          </div>

          {renderFooterActions(false, false, "开始生成", () => void startJob())}
        </section>
      </div>
    );
  }

  function renderRenderPage() {
    return (
      <div key="page-render" className="cc-workspace-grid cc-workspace-grid-render">
        <section className="cc-main-panel">
          <div className="cc-panel-header">
            <Badge variant="secondary">Render Console</Badge>
            <h2>集中查看任务进度、预览与导出结果</h2>
            <p>把原来的“左侧说明 + 右侧结果”改成更像专业软件的渲染台：左侧是流程导航，右侧是主渲染面板。</p>
          </div>

          <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="rounded-[1.5rem] border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--muted)/0.34)] p-4">
              {STEPS.map((step, index) => {
                const active = index === activeStep;
                const done = index < activeStep;
                return (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => setActiveStep(index)}
                    className={`flex w-full items-start gap-3 rounded-[1.15rem] px-4 py-4 text-left transition ${active ? "bg-[hsl(var(--card))] shadow-sm" : "hover:bg-[hsl(var(--card)/0.66)]"}`}
                  >
                    <span className={`mt-0.5 inline-grid h-9 w-9 place-items-center rounded-full ${done || active ? "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]" : "bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]"}`}>
                      {done ? <CheckCircle2 size={18} /> : <CircleDot size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{step.title}</span>
                      <span className="mt-1 block text-sm text-[hsl(var(--muted-foreground))]">{step.desc}</span>
                    </span>
                    <ChevronRight size={16} className="mt-1 text-[hsl(var(--muted-foreground))]" />
                  </button>
                );
              })}
              <div className="mt-4 rounded-[1.15rem] bg-[hsl(var(--card)/0.76)] p-4 text-sm text-[hsl(var(--muted-foreground))]">
                当前配置会同步传递到渲染流程，无需重复录入。生成完成后，可直接在右侧预览并下载。
              </div>
            </div>

            <section className="rounded-[1.5rem] border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.82)] p-5 shadow-sm">
              <RunPanel upload={upload} job={job} connected={connected} busy={creating} onStart={() => void startJob()} />
            </section>
          </div>
        </section>
      </div>
    );
  }

  function renderCurrentPage() {
    switch (activeStep) {
      case 0:
        return renderUploadPage();
      case 1:
        return renderTemplatePage();
      case 2:
        return renderVoicePage();
      case 3:
        return renderRenderPage();
      default:
        return renderUploadPage();
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(232,203,174,0.18),transparent_26%),linear-gradient(180deg,#f4eee6_0%,#efe6dc_100%)] text-[hsl(var(--foreground))]">
      <div className="cc-app-shell mx-auto w-full max-w-[1500px] px-4 pb-12 pt-6 md:px-6">
        {renderWorkspaceHeader()}
        <div className="mt-6">{renderCurrentPage()}</div>
      </div>

      <div className="pointer-events-none fixed right-4 top-4 z-50 flex max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${toast.variant === "destructive"
              ? "border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))]"
              : toast.variant === "success"
                ? "border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]"
                : toast.variant === "warning"
                  ? "border-[hsl(var(--warning)/0.25)] bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))]"
                  : "border-[hsl(var(--border))] bg-[hsl(var(--card)/0.88)] text-[hsl(var(--foreground))]"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
