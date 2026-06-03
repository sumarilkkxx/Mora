import type { ReactNode } from "react";
import { Book, Bot, Camera, Check, Heart, Scissors, ShoppingBag, Sparkles, Zap } from "lucide-react";
import type { TemplateSummary } from "../api/client";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { cn } from "../lib-utils";

interface Props {
  templates: TemplateSummary[];
  selected: string | null;
  onSelect: (name: string | null) => void;
}

interface Theme {
  grad: string;
  icon: ReactNode;
  tone: string;
  highlight: string;
  pitch: string;
}

const LABEL_MAP: Record<string, string> = {
  __auto__: "智能匹配",
  barbershop: "门店焕新",
  product_showcase: "商品展示",
  tutorial: "教程讲解",
  emotional_story: "故事表达",
};

const THEME: Record<string, Theme> = {
  __auto__: {
    grad: "linear-gradient(145deg,#222a34 0%,#3a4a62 52%,#d59a63 100%)",
    icon: <Bot size={18} />,
    tone: "智能策略",
    highlight: "自动识别素材节奏与内容重点",
    pitch: "适合快速起稿与批量生成",
  },
  barbershop: {
    grad: "linear-gradient(145deg,#2d221a 0%,#7a3f2a 48%,#f0c197 100%)",
    icon: <Scissors size={18} />,
    tone: "本地服务",
    highlight: "强化前后对比与服务亮点",
    pitch: "适合门店引流与转化",
  },
  product_showcase: {
    grad: "linear-gradient(145deg,#1d2c28 0%,#4f7d68 48%,#bdd5bf 100%)",
    icon: <ShoppingBag size={18} />,
    tone: "商品展示",
    highlight: "突出卖点、细节与购买引导",
    pitch: "适合电商投放与产品种草",
  },
  tutorial: {
    grad: "linear-gradient(145deg,#202837 0%,#5d6f91 52%,#d0d7e6 100%)",
    icon: <Book size={18} />,
    tone: "知识教程",
    highlight: "结构清晰，适合步骤讲解",
    pitch: "适合教学、培训与科普内容",
  },
  emotional_story: {
    grad: "linear-gradient(145deg,#3d1f29 0%,#9b5966 50%,#efc4bb 100%)",
    icon: <Heart size={18} />,
    tone: "情绪叙事",
    highlight: "强化代入感与情绪递进",
    pitch: "适合品牌故事与人物内容",
  },
  default: {
    grad: "linear-gradient(145deg,#2b2723 0%,#6f655d 50%,#d7cabb 100%)",
    icon: <Camera size={18} />,
    tone: "通用模板",
    highlight: "适配常见视频表达场景",
    pitch: "适合多类型素材快速成片",
  },
};

const FALLBACK: Theme = THEME.default;

function formatCanvas(template: TemplateSummary) {
  const w = template.canvas.width ?? "-";
  const h = template.canvas.height ?? "-";
  const fps = template.canvas.fps ?? "-";
  return `${w} × ${h} / ${fps}fps`;
}

function Item({ active, theme, title, desc, tags, meta, isDefault, onClick }: { active: boolean; theme: Theme; title: string; desc: string; tags?: string[]; meta: string; isDefault?: boolean; onClick: () => void }) {
  return (
    <Card
      className={cn(
        "cc-template-card group flex h-full min-w-0 flex-col rounded-[1.4rem] border bg-[hsl(var(--card))] p-0 shadow-sm transition-transform duration-300 hover:-translate-y-0.5",
        active
          ? "border-[hsl(var(--primary))]"
          : "border-[hsl(var(--border))]",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col items-stretch justify-start whitespace-normal rounded-[1.35rem] p-0 text-left hover:bg-transparent"
        onClick={onClick}
      >
        <div className="relative min-h-[11.5rem] shrink-0 overflow-hidden rounded-t-[1.35rem]" style={{ background: theme.grad }}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.36),transparent_28%),radial-gradient(circle_at_78%_0%,rgba(255,255,255,0.18),transparent_28%),linear-gradient(to_bottom,transparent,rgba(19,13,10,0.24))]" />
          <div className="relative z-10 flex flex-col gap-4 p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-start gap-3">
              <div className="flex min-w-0 items-start gap-3 text-white">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[1.1rem] bg-white/18 backdrop-blur-md">{theme.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/72">{theme.tone}</div>
                  <div className="cc-text-safe mt-1 text-lg font-semibold leading-snug tracking-tight">{title}</div>
                  {isDefault && (
                    <span className="mt-2 inline-flex rounded-full bg-white/18 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">推荐</span>
                  )}
                </div>
              </div>
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full transition-opacity",
                  active ? "bg-white text-[hsl(var(--primary))] opacity-100 shadow-sm" : "opacity-0",
                )}
                aria-hidden={!active}
              >
                <Check size={16} />
              </span>
            </div>
            <div className="cc-text-safe rounded-[1.25rem] border border-white/18 bg-black/14 p-3 text-sm leading-6 text-white/92 backdrop-blur-md">
              {theme.highlight}
            </div>
          </div>
        </div>

        <CardContent className="flex min-h-0 w-full min-w-0 flex-1 flex-col space-y-4 p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_1.25rem] items-start gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[hsl(var(--muted-foreground))]">成片方向</div>
              <div className="cc-text-safe mt-1 text-sm leading-6 text-[hsl(var(--foreground))]">{desc}</div>
            </div>
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {active ? (
                <Sparkles className="text-[hsl(var(--primary))]" size={16} />
              ) : (
                <Zap className="text-[hsl(var(--muted-foreground))]" size={16} />
              )}
            </span>
          </div>

          <div className="rounded-[1rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
            <div className="text-xs uppercase tracking-[0.16em]">适用价值</div>
            <div className="cc-text-safe mt-2 font-medium leading-6 text-[hsl(var(--foreground))]">{theme.pitch}</div>
          </div>

          <div className="mt-auto flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="cc-text-safe max-w-full whitespace-normal">{meta}</Badge>
            {tags?.slice(0, 2).map((t) => (
              <Badge key={t} variant="outline" className="cc-text-safe max-w-full whitespace-normal">{t}</Badge>
            ))}
          </div>
        </CardContent>
      </Button>
    </Card>
  );
}

export default function TemplatePicker({ templates, selected, onSelect }: Props) {
  return (
    <div className="cc-template-grid grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Item
        active={selected === null}
        theme={THEME.__auto__}
        title={LABEL_MAP.__auto__}
        desc="按素材比例、时长和画面节奏自动匹配模板，让创作流程更顺滑。"
        meta="自动决策"
        onClick={() => onSelect(null)}
      />
      {templates.map((t) => (
        <Item
          key={t.name}
          active={selected === t.name}
          theme={THEME[t.name] ?? FALLBACK}
          title={LABEL_MAP[t.name] ?? t.name}
          desc={t.description}
          tags={t.tags}
          meta={formatCanvas(t)}
          isDefault={t.is_default}
          onClick={() => onSelect(t.name)}
        />
      ))}
    </div>
  );
}
