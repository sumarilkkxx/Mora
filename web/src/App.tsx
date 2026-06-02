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
  { key: "upload", title: "上传素材", desc: "导入视频", eyebrow: "素材入库" },
  { key: "template", title: "选择模板", desc: "确定风格", eyebrow: "模板编排" },
  { key: "voice", title: "配音文案", desc: "完善表达", eyebrow: "表达配置" },
  { key: "render", title: "生成导出", desc: "输出成片", eyebrow: "结果交付" },
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

  const progressTitle = useMemo(() => ["素材入库", "模板编排", "文案驱动", "成片交付"], []);
  const completionPercent = Math.round(((activeStep + 1) / STEPS.length) * 100);
  const filledVariableCount = Object.keys(variables).filter((key) => (variables[key] || "").trim()).length;
  const currentTemplateSummary = templates.find((item) => item.name === selectedTemplate) ?? null;
  const templateScenarios = TEMPLATE_SCENARIOS[selectedTemplate ?? "__auto__"] ?? TEMPLATE_SCENARIOS.__auto__;
  const templateDescription = currentTemplateSummary?.description ?? "系统将结合素材比例、时长与内容重心，为你匹配更顺滑的成片结构。";

  function renderStepRail() {
    return (
      <div className="rounded-[1.6rem] border border-[hsl(var(--border)/0.76)] bg-[hsl(var(--card)/0.78)] px-5 py-5 shadow-[0_12px_36px_rgba(55,39,27,0.06)] backdrop-blur">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
            <div className="flex shrink-0 items-center gap-3">
              <BrandMark className="h-10 w-10" />
              <div className="min-w-0">
                <div className="text-lg font-semibold tracking-tight leading-tight">ClipCraft</div>
                <Badge variant="secondary" className="mt-1.5">智能视频工作台</Badge>
              </div>
            </div>

            <div
              className="cc-progress-block sm:mt-1 sm:border-l sm:border-[hsl(var(--border)/0.65)] sm:pl-6"
              role="progressbar"
              aria-valuenow={completionPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`整体进度 ${completionPercent}%`}
            >
              <div className="cc-progress-meta">
                <span>当前阶段</span>
                <strong>{progressTitle[activeStep]}</strong>
                <em>{completionPercent}%</em>
              </div>
              <div className="cc-progress-track">
                <div className="cc-progress-fill" style={{ width: `${completionPercent}%` }} />
              </div>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 xl:max-w-[58%] xl:justify-end">
            {STEPS.map((step, index) => {
              const active = index === activeStep;
              const done = index < activeStep;
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => setActiveStep(index)}
                  className={`flex min-w-[128px] shrink-0 items-center gap-2.5 rounded-[1rem] border px-3 py-2 text-left transition ${
                    active
                      ? "border-[hsl(var(--primary)/0.38)] bg-[hsl(var(--primary)/0.1)] shadow-sm"
                      : done
                        ? "border-[hsl(var(--border)/0.72)] bg-[hsl(var(--card)/0.92)]"
                        : "border-[hsl(var(--border)/0.68)] bg-[hsl(var(--background)/0.52)] hover:bg-[hsl(var(--card)/0.82)]"
                  }`}
                >
                  <span
                    className={`inline-grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                      active
                        ? "bg-[hsl(var(--foreground))] text-[hsl(var(--background))]"
                        : done
                          ? "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                          : "bg-[hsl(var(--muted)/0.78)] text-[hsl(var(--muted-foreground))]"
                    }`}
                  >
                    {done ? <CheckCircle2 size={14} /> : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-tight">{step.title}</span>
                    <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">{active ? "当前操作" : done ? "已完成" : step.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function renderFooterActions(prevDisabled = false, nextDisabled = false, nextLabel = "下一步", nextAction?: () => void) {
    return (
      <div className="cc-page-footer">
        <p className="cc-page-footer-hint">
          当前阶段：<strong>{progressTitle[activeStep]}</strong>，系统会保留已填写内容，便于继续衔接下一步。
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
      <div key="page-upload" className="w-full">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
          <section className="flex flex-col rounded-[1.75rem] border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.82)] p-6 shadow-[0_24px_80px_rgba(60,42,30,0.10)] backdrop-blur md:p-8">
            <Badge variant="secondary">第一步 · 上传素材</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">让每一段素材快速进入可交付流程</h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[hsl(var(--muted-foreground))]">
              上传原始视频后，系统会自动识别画幅、时长与基础信息，为模板匹配、配音编排和成片生成做好准备。
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-[hsl(var(--muted)/0.36)] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">支持格式</div>
                <div className="mt-1.5 text-sm font-medium">mp4 / mov / avi / mkv / webm</div>
              </div>
              <div className="rounded-xl bg-[hsl(var(--muted)/0.36)] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">自动处理</div>
                <div className="mt-1.5 text-sm font-medium">识别尺寸、时长与基础信息</div>
              </div>
              <div className="rounded-xl bg-[hsl(var(--muted)/0.36)] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">适用场景</div>
                <div className="mt-1.5 text-sm font-medium">推广、商品展示、知识内容</div>
              </div>
            </div>

            <label className="cc-upload-zone mt-6 min-h-[280px] flex-1 rounded-[1.5rem]">
              <input id="clip-upload" className="hidden" type="file" accept="video/*" onChange={(e) => void handleDrop(e.target.files)} />
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
                <CloudUpload size={28} />
              </span>
              <span className="space-y-2 text-center">
                <span className="block text-2xl font-semibold tracking-tight">点击上传视频素材</span>
                <span className="block max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                  上传后将自动进入下一阶段，并保留素材信息供后续流程复用。
                </span>
              </span>
            </label>
            {renderFooterActions(true, !upload, upload ? "进入模板选择" : "请先上传素材")}
          </section>

          <aside className="cc-sidebar-stack lg:sticky lg:top-6">
            <Card className="cc-glass-card rounded-[1.75rem]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><FileVideo size={17} /> 当前素材</CardTitle>
                <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">上传后在此查看文件名、分辨率与时长。</p>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="rounded-xl bg-[hsl(var(--muted)/0.5)] px-4 py-3.5 text-sm text-[hsl(var(--muted-foreground))]">
                  {upload ? upload.name : "尚未上传视频"}
                </div>
                {upload && (
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.62)] px-4 py-1 text-sm">
                    <div className="cc-meta-row"><span>文件名称</span><b>{upload.name}</b></div>
                    <div className="cc-meta-row"><span>画面尺寸</span><b>{upload.asset.width} x {upload.asset.height}</b></div>
                    <div className="cc-meta-row"><span>素材时长</span><b>{Math.round(upload.asset.duration ?? 0)} 秒</b></div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="cc-glass-card rounded-[1.75rem]">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center gap-2 text-base font-semibold"><Sparkles size={17} className="text-[hsl(var(--primary))]" /> 创作收益</div>
                <ul className="space-y-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                  <li className="rounded-xl bg-[hsl(var(--muted)/0.45)] px-4 py-3">自动衔接模板、配音与成片流程</li>
                  <li className="rounded-xl bg-[hsl(var(--muted)/0.45)] px-4 py-3">保留素材信息，减少重复配置</li>
                  <li className="rounded-xl bg-[hsl(var(--muted)/0.45)] px-4 py-3">适合门店推广、商品介绍与教程讲解</li>
                </ul>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    );
  }

  function renderTemplatePage() {
    return (
      <div key="page-template" className="w-full">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(260px,300px)]">
          <section className="rounded-[1.75rem] border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.82)] p-6 shadow-[0_24px_80px_rgba(60,42,30,0.10)] backdrop-blur md:p-8">
            <Badge variant="secondary">第二步 · 选择模板</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">为你的内容选择更合适的表达结构</h2>
            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[hsl(var(--muted-foreground))]">
              模板会影响镜头节奏、字幕布局和信息排序。你可以直接指定业务场景，也可以交给系统进行智能匹配。
            </p>
            <div className="mt-8 grid gap-5">
              <div className="grid gap-4 rounded-[1.7rem] border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--muted)/0.28)] p-5 md:grid-cols-3">
                <div className="rounded-[1.35rem] bg-[hsl(var(--card)/0.82)] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">选择建议</div>
                  <div className="mt-2 text-sm font-medium">有明确场景时优先手动选择，可获得更稳定的成片表达。</div>
                </div>
                <div className="rounded-[1.35rem] bg-[hsl(var(--card)/0.82)] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">当前模式</div>
                  <div className="mt-2 text-sm font-medium">{selectedTemplate ? "已指定模板" : "智能匹配"}</div>
                </div>
                <div className="rounded-[1.35rem] bg-[hsl(var(--card)/0.82)] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">产出目标</div>
                  <div className="mt-2 text-sm font-medium">强化信息呈现与发布转化效率。</div>
                </div>
              </div>
              <TemplatePicker templates={templates} selected={selectedTemplate} onSelect={setSelectedTemplate} />
            </div>
            {renderFooterActions(false, false, "进入配音设置")}
          </section>

          <aside className="cc-sidebar-stack lg:sticky lg:top-6">
            <Card className="cc-glass-card overflow-hidden rounded-[1.75rem]">
              <div className="h-40 bg-[linear-gradient(135deg,#2f241f_0%,#b9744e_50%,#e8c4a6_100%)]" />
              <CardContent className="space-y-5 p-6 -mt-14 relative z-10">
                <div className="rounded-[1.6rem] border border-white/40 bg-[hsl(var(--card)/0.82)] p-5 backdrop-blur">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">当前策略</div>
                      <div className="cc-text-safe mt-2 text-2xl font-semibold tracking-tight">{selectedTemplateLabel}</div>
                      <div className="cc-text-safe mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{templateDescription}</div>
                    </div>
                    <Badge variant="secondary">{selectedTemplate ? "手动指定" : "自动匹配"}</Badge>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.35rem] bg-[hsl(var(--muted)/0.42)] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">成片节奏</div>
                    <div className="cc-text-safe mt-2 text-sm font-medium leading-6">{selectedTemplate === "tutorial" ? "结构清晰，适合分段讲解" : selectedTemplate === "emotional_story" ? "情绪递进，适合叙事表达" : "紧凑有重点，兼顾转化效率"}</div>
                  </div>
                  <div className="rounded-[1.35rem] bg-[hsl(var(--muted)/0.42)] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">变量要求</div>
                    <div className="mt-2 text-sm font-medium">{detail ? `${detail.variables.length} 项可配置字段` : "按素材自动生成内容策略"}</div>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--card)/0.68)] p-5">
                  <div className="text-sm font-semibold">适用场景</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {templateScenarios.map((item) => (
                      <Badge key={item} variant="outline">{item}</Badge>
                    ))}
                  </div>
                </div>

                {detail ? (
                  <div className="space-y-3 rounded-[1.6rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.62)] p-5 text-sm text-[hsl(var(--muted-foreground))]">
                    <div className="cc-meta-row"><span>输出尺寸</span><b>{String(detail.canvas.width ?? "-")} x {String(detail.canvas.height ?? "-")}</b></div>
                    <div className="cc-meta-row"><span>帧率</span><b>{String(detail.canvas.fps ?? "-")} fps</b></div>
                    <div className="cc-meta-row"><span>变量数量</span><b>{detail.variables.length}</b></div>
                  </div>
                ) : (
                  <div className="rounded-[1.6rem] border border-dashed border-[hsl(var(--border))] p-5 text-sm text-[hsl(var(--muted-foreground))]">
                    智能匹配模式会在创建任务时根据素材自动挑选更适合的视频结构与信息节奏。
                  </div>
                )}
              </CardContent>
            </Card>

            <Alert>
              <Info size={16} />
              <AlertTitle>使用建议</AlertTitle>
              <AlertDescription>如果素材目标明确，建议优先选择贴近业务场景的模板，成片结果通常会更稳定、更聚焦。</AlertDescription>
            </Alert>
          </aside>
        </div>
      </div>
    );
  }

  function renderVoicePage() {
    const vars = detail?.variables || [];
    return (
      <div key="page-voice" className="w-full">
        <section className="rounded-[1.75rem] border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.82)] p-6 shadow-[0_24px_80px_rgba(60,42,30,0.10)] backdrop-blur md:p-8">
            <Badge variant="secondary">第三步 · 配音文案</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">专业配音控制台，让表达更精准、更有节奏</h2>
            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[hsl(var(--muted-foreground))]">
              在这里统一完成音色选择、语速微调和文案变量配置。所有设置都会直接影响成片节奏、口播风格和字幕信息密度。
            </p>

            <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <Card className="rounded-[1.8rem] border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.76)] shadow-sm">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2"><Sparkles size={18} className="text-[hsl(var(--primary))]" /> 音色引擎</CardTitle>
                    <div className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">选择与业务场景更匹配的中文音色，让成片更自然、更具说服力。</div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Select value={voice} onValueChange={setVoice} options={voiceOptions} />
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-[1.3rem] bg-[hsl(var(--muted)/0.5)] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">已选音色</div>
                        <div className="mt-2 text-lg font-semibold">{selectedVoice?.name || "待选择"}</div>
                      </div>
                      <div className="rounded-[1.3rem] bg-[hsl(var(--muted)/0.5)] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">声音风格</div>
                        <div className="mt-2 text-sm font-medium text-[hsl(var(--foreground))]">{selectedVoice?.style || "默认"}</div>
                      </div>
                      <div className="rounded-[1.3rem] bg-[hsl(var(--muted)/0.5)] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">适用场景</div>
                        <div className="mt-2 text-sm font-medium text-[hsl(var(--foreground))]">{selectedVoice?.scene || "通用场景"}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-[1.8rem] border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.76)] shadow-sm">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2"><Wand2 size={18} className="text-[hsl(var(--primary))]" /> 文案变量面板</CardTitle>
                    <div className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">按模板要求补全标题、卖点和口播信息，系统会自动组织字幕与表达节奏。</div>
                  </CardHeader>
                  <CardContent>
                    {vars.length === 0 ? (
                      <div className="rounded-[1.6rem] border border-dashed border-[hsl(var(--border))] p-6 text-sm text-[hsl(var(--muted-foreground))]">
                        当前模板无需额外变量，系统会根据素材自动组织文案与节奏。
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        {vars.map((variable) => (
                          <Card key={variable.name} className="rounded-[1.5rem] border-[hsl(var(--border)/0.8)] bg-[hsl(var(--muted)/0.26)] shadow-none">
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

              <aside className="cc-sidebar-stack lg:sticky lg:top-6">
                <Card className="rounded-[1.5rem] border-[hsl(var(--border)/0.8)] bg-[linear-gradient(180deg,hsl(var(--card)/0.88),hsl(var(--muted)/0.42))] shadow-sm">
                  <CardHeader className="pb-4">
                    <CardTitle>配音控制台</CardTitle>
                    <div className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">集中查看关键控制项和本次生成策略，让口播表达更稳定。</div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="rounded-[1.5rem] border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.8)] p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[hsl(var(--muted-foreground))]">语速校准</span>
                        <b>{rate >= 0 ? "+" : ""}{rate}%</b>
                      </div>
                      <input
                        className="mt-4 w-full accent-[hsl(var(--primary))]"
                        type="range"
                        min="-30"
                        max="30"
                        step="5"
                        value={rate}
                        onChange={(e) => setRate(Number(e.target.value || 0))}
                      />
                      <div className="mt-3 flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
                        <span>更沉稳</span>
                        <span>标准</span>
                        <span>更紧凑</span>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <div className="rounded-[1.35rem] bg-[hsl(var(--muted)/0.45)] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">内容节奏</div>
                        <div className="mt-2 text-sm font-medium">{rate <= -10 ? "舒缓叙述" : rate >= 10 ? "高信息密度" : "均衡表达"}</div>
                      </div>
                      <div className="rounded-[1.35rem] bg-[hsl(var(--muted)/0.45)] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">变量完成度</div>
                        <div className="mt-2 text-sm font-medium">{vars.length === 0 ? "无需补充" : `${filledVariableCount}/${vars.length} 项已填写`}</div>
                      </div>
                      <div className="rounded-[1.35rem] bg-[hsl(var(--muted)/0.45)] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">成片预期</div>
                        <div className="mt-2 text-sm font-medium">更适合用于推广发布、商品讲解和业务展示。</div>
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.8)] p-4 text-sm">
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
      <div key="page-render" className="w-full">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
          <section className="rounded-[1.75rem] border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.82)] p-6 shadow-[0_24px_80px_rgba(60,42,30,0.10)] backdrop-blur md:p-8">
            <Badge variant="secondary">第四步 · 生成导出</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">将创意配置快速转化为成片结果</h2>
            <p className="mt-3 text-[15px] leading-7 text-[hsl(var(--muted-foreground))]">
              这里会集中展示预览、任务进度和下载结果。完成生成后，可直接查看视频并导出最终成品。
            </p>

            <div className="mt-8 space-y-4 rounded-[1.8rem] border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--muted)/0.36)] p-5">
              {STEPS.map((step, index) => {
                const active = index === activeStep;
                const done = index < activeStep;
                return (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => setActiveStep(index)}
                    className={`flex w-full items-start gap-3 rounded-[1.4rem] px-4 py-4 text-left transition ${active ? "bg-[hsl(var(--card))] shadow-sm" : "hover:bg-[hsl(var(--card)/0.66)]"}`}
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
            </div>

            <div className="mt-6 grid gap-3">
              <div className="rounded-[1.35rem] bg-[hsl(var(--muted)/0.48)] p-4 text-sm text-[hsl(var(--muted-foreground))]">成片生成完成后，可直接在右侧预览并下载，用于发布、交付或团队审核。</div>
              <div className="rounded-[1.35rem] bg-[hsl(var(--muted)/0.48)] p-4 text-sm text-[hsl(var(--muted-foreground))]">当前配置会同步传递到渲染流程，无需重复录入。</div>
            </div>
            <div className="mt-6">
              <Button variant="outline" className="rounded-full" onClick={() => setActiveStep(2)}>
                <ArrowLeft size={16} /> 返回调整配置
              </Button>
            </div>
          </section>

          <section className="min-h-[480px] rounded-[1.75rem] border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.82)] p-6 shadow-[0_24px_80px_rgba(60,42,30,0.10)] backdrop-blur md:p-8">
            <RunPanel upload={upload} job={job} connected={connected} busy={creating} onStart={() => void startJob()} />
          </section>
        </div>
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(232,203,174,0.24),transparent_30%),linear-gradient(180deg,#f7f1e8_0%,#f4ede3_100%)] text-[hsl(var(--foreground))]">
      <div className="cc-app-shell mx-auto w-full max-w-7xl px-4 md:px-6">
        <div className="pt-6">{renderStepRail()}</div>
        <div className="pb-12 pt-6">{renderCurrentPage()}</div>
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
