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
  icon: ReactNode;
  tone: string;
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
    icon: <Bot size={18} />,
    tone: "智能策略",
    pitch: "适合快速起稿与批量生成",
  },
  barbershop: {
    icon: <Scissors size={18} />,
    tone: "本地服务",
    pitch: "适合门店引流与转化",
  },
  product_showcase: {
    icon: <ShoppingBag size={18} />,
    tone: "商品展示",
    pitch: "适合电商投放与产品种草",
  },
  tutorial: {
    icon: <Book size={18} />,
    tone: "知识教程",
    pitch: "适合教学、培训与科普内容",
  },
  emotional_story: {
    icon: <Heart size={18} />,
    tone: "情绪叙事",
    pitch: "适合品牌故事与人物内容",
  },
  default: {
    icon: <Camera size={18} />,
    tone: "通用模板",
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

function Item({ active, theme, title, desc, tags, meta, isDefault, onClick, id }: { active: boolean; theme: Theme; title: string; desc: string; tags?: string[]; meta: string; isDefault?: boolean; onClick: () => void; id: string }) {
  return (
    <Card
      data-template-card={id}
      data-selected={active ? "true" : "false"}
      className={cn(
        "cc-template-card cc-selection-feedback group flex h-full min-w-0 flex-col rounded-[1.2rem] border bg-[hsl(var(--card)/0.96)] p-0",
        active
          ? "border-[hsl(var(--primary)/0.52)] bg-[hsl(var(--primary)/0.06)] shadow-[var(--shadow-md)]"
          : "border-[hsl(var(--border)/0.88)] shadow-[var(--shadow-xs)] hover:-translate-y-px hover:border-[hsl(var(--primary)/0.26)] hover:shadow-[var(--shadow-sm)]",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col items-stretch justify-start whitespace-normal rounded-[1.2rem] p-0 text-left hover:bg-transparent"
        onClick={onClick}
      >
        <div className="shrink-0 border-b border-[hsl(var(--border)/0.72)] bg-[hsl(var(--muted)/0.22)]">
          <div className="flex flex-col gap-4 p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-start gap-3">
              <div className="flex min-w-0 items-start gap-3 text-[hsl(var(--foreground))]">
                <span className={cn(
                  "grid h-11 w-11 shrink-0 place-items-center rounded-[0.95rem] bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-[var(--shadow-xs)] transition-all duration-200 ease-out",
                  active && "bg-[hsl(var(--foreground))] text-white",
                )}>{theme.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">{theme.tone}</div>
                  <div className="cc-text-safe mt-1 text-lg font-semibold leading-snug tracking-tight">{title}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isDefault && (
                      <span className="inline-flex rounded-full bg-[hsl(var(--primary)/0.12)] px-2.5 py-0.5 text-[11px] font-medium text-[hsl(var(--primary))]">推荐</span>
                    )}
                    {active && (
                      <span className="inline-flex rounded-full bg-[hsl(var(--foreground))] px-2.5 py-0.5 text-[11px] font-medium text-white">已选择</span>
                    )}
                  </div>
                </div>
              </div>
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full transition-all duration-200 ease-out",
                  active
                    ? "bg-[hsl(var(--foreground))] text-white opacity-100 scale-100 shadow-[var(--shadow-xs)]"
                    : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] opacity-100 scale-[0.96]",
                )}
              >
                {active ? <Check size={16} /> : <span className="text-xs font-semibold">选择</span>}
              </span>
            </div>
            <div className="cc-text-safe rounded-[1rem] bg-[hsl(var(--card)/0.82)] px-4 py-3 text-sm leading-6 text-[hsl(var(--foreground))]">
              {theme.pitch}
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

          <div className="rounded-[1rem] border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.18)] p-3 text-sm text-[hsl(var(--muted-foreground))]">
            <div className="text-xs uppercase tracking-[0.16em]">输出规格</div>
            <div className="cc-text-safe mt-2 font-medium leading-6 text-[hsl(var(--foreground))]">{meta}</div>
          </div>

          <div className="mt-auto flex flex-wrap gap-1.5">
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
        id="__auto__"
        onClick={() => onSelect(null)}
      />
      {templates.map((t) => (
        <Item
          key={t.name}
          // Playwright uses this stable marker to verify selected-state feedback.
          active={selected === t.name}
          theme={THEME[t.name] ?? FALLBACK}
          title={LABEL_MAP[t.name] ?? t.name}
          desc={t.description}
          tags={t.tags}
          meta={formatCanvas(t)}
          isDefault={t.is_default}
          id={t.name}
          onClick={() => onSelect(t.name)}
        />
      ))}
    </div>
  );
}
