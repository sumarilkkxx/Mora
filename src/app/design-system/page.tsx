"use client";

import { useState } from "react";
import { ArrowRight, Check, Film, ImagePlus, Sparkles } from "lucide-react";

import { PageFrame, SegmentedControl, SegmentedItem, Surface } from "@/components/studio/page";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";

export default function DesignSystemPage() {
  const [choice, setChoice] = useState("local");
  const [autoCompose, setAutoCompose] = useState(true);
  const [showProductCard, setShowProductCard] = useState(false);

  return (
    <div className="apple-spec">
      <section className="apple-spec-hero">
        <div className="apple-spec-kicker">Mora Interface System</div>
        <h1 className="apple-spec-display">创作工具，也可以安静而精确。</h1>
        <p className="apple-spec-lead">让内容成为主角，用材质表达层级，用即时反馈建立信任。明暗模式共享同一套信息结构。</p>
        <div className="mt-7 flex justify-center"><ThemeToggle /></div>
      </section>

      <PageFrame width="wide" className="pt-0">
        <div className="apple-spec-grid">
          <section className="apple-spec-panel apple-spec-panel-wide">
            <div className="apple-spec-panel-copy">
              <h2>中性为底，蓝色只属于操作。</h2>
              <p>界面不依赖渐变和光晕。色彩只负责链接、选中状态、进度和明确的下一步。</p>
              <div className="apple-spec-swatch-row">
                <div className="apple-spec-swatch bg-[#f5f5f7]" />
                <div className="apple-spec-swatch bg-white" />
                <div className="apple-spec-swatch bg-[#1d1d1f]" />
                <div className="apple-spec-swatch bg-[#0071e3]" />
                <div className="apple-spec-swatch bg-[#34c759]" />
              </div>
            </div>
          </section>

          <section className="apple-spec-panel">
            <div className="apple-spec-panel-copy">
              <h2>排版先于装饰。</h2>
              <p>大标题更紧，小字号更松；通过尺度、字重和留白建立层级。</p>
              <div className="apple-spec-type-sample">
                <strong>让商品动起来。</strong>
                <span>Geist 作为系统字体，使用紧凑标题字距和舒适正文行距。产品文案保持自然、具体、可扫描。</span>
              </div>
            </div>
          </section>

          <section className="apple-spec-panel">
            <div className="apple-spec-panel-copy">
              <h2>控制清晰，反馈即时。</h2>
              <p>控件在按下时立即响应。圆角依角色变化，不把所有内容都做成胶囊。</p>
              <div className="apple-spec-controls">
                <Button size="lg">开始制作 <ArrowRight /></Button>
                <Button size="lg" variant="secondary"><ImagePlus /> 添加素材</Button>
                <Button size="lg" variant="ghost">稍后设置</Button>
              </div>
              <div className="mt-5">
                <SegmentedControl label="样例分段控件">
                  <SegmentedItem selected onClick={() => undefined}>项目</SegmentedItem>
                  <SegmentedItem selected={false} onClick={() => undefined}>作品</SegmentedItem>
                </SegmentedControl>
              </div>
              <div className="mt-5 grid gap-3 rounded-2xl border border-border/65 bg-muted/25 p-4 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">自动合成</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">即时保存当前选择</div>
                  </div>
                  <Switch checked={autoCompose} onCheckedChange={setAutoCompose} aria-label="自动合成" />
                </div>
                <Checkbox
                  checked={showProductCard}
                  onChange={(event) => setShowProductCard(event.target.checked)}
                  label="显示商品卡片"
                  description="复选项使用整行点击区域和明确焦点状态。"
                />
              </div>
            </div>
          </section>

          <section className="apple-spec-panel apple-spec-panel-wide apple-spec-material">
            <div className="apple-spec-material-card">材质只用于浮动导航、工具栏与任务面板。</div>
          </section>

          <section className="apple-spec-panel apple-spec-panel-wide">
            <div className="apple-spec-panel-copy">
              <h2>让选中、提示与正文各司其职。</h2>
              <p>颜色表达语义，布局表达关系。选中卡始终保留深色正文，并用边框、浅色底和勾选标记共同确认状态。</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="成片方式示例">
                <ChoiceCard selected={choice === "local"} title="本地素材合成" description="使用已有素材完成剪辑，不调用付费图片或视频生成模型。" onClick={() => setChoice("local")} />
                <ChoiceCard selected={choice === "ai"} title="生成式制作" description="生成新画面或动态镜头，费用由模型平台按实际调用收取。" onClick={() => setChoice("ai")} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Notice tone="info" title="正在分析素材">任务继续运行，你可以留在当前页面。</Notice>
                <Notice tone="warning" title="还需要一个视频模型">完成配置后即可开始生成动态镜头。</Notice>
              </div>
            </div>
          </section>

          <section className="apple-spec-panel apple-spec-panel-wide">
            <div className="apple-spec-panel-copy">
              <h2>功能排布遵循创作心智。</h2>
              <p>创作台负责开始，项目负责继续，素材库负责复用，批量制作负责规模化，设置负责连接与默认值。</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-4">
                {[
                  [Sparkles, "创作台", "选择起点"],
                  [Film, "项目", "推进制作"],
                  [ImagePlus, "素材库", "整理复用"],
                  [Check, "交付", "检查导出"],
                ].map(([Icon, title, detail]) => {
                  const Glyph = Icon as typeof Sparkles;
                  return <Surface key={String(title)} className="p-5 shadow-none"><Glyph className="size-5 text-primary" /><div className="mt-5 font-semibold">{String(title)}</div><div className="mt-1 text-xs text-muted-foreground">{String(detail)}</div></Surface>;
                })}
              </div>
            </div>
          </section>
        </div>
      </PageFrame>
    </div>
  );
}
