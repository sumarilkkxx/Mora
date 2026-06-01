import type { ReactNode } from "react";
import {
  BookOutlined,
  CheckOutlined,
  HeartOutlined,
  ScissorOutlined,
  ShoppingOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { TemplateSummary } from "../api/client";

interface Props {
  templates: TemplateSummary[];
  selected: string | null;
  onSelect: (name: string | null) => void;
}

interface Theme {
  grad: string;
  icon: ReactNode;
}

const THEME: Record<string, Theme> = {
  __auto__: {
    grad: "linear-gradient(135deg,#6366f1,#a855f7)",
    icon: <ThunderboltOutlined />,
  },
  barbershop: {
    grad: "linear-gradient(135deg,#fb7185,#f43f5e)",
    icon: <ScissorOutlined />,
  },
  product_showcase: {
    grad: "linear-gradient(135deg,#10b981,#06b6d4)",
    icon: <ShoppingOutlined />,
  },
  tutorial: {
    grad: "linear-gradient(135deg,#3b82f6,#22d3ee)",
    icon: <BookOutlined />,
  },
  emotional_story: {
    grad: "linear-gradient(135deg,#ec4899,#a855f7)",
    icon: <HeartOutlined />,
  },
  default: {
    grad: "linear-gradient(135deg,#64748b,#94a3b8)",
    icon: <VideoCameraOutlined />,
  },
};

const FALLBACK: Theme = {
  grad: "linear-gradient(135deg,#6366f1,#8b5cf6)",
  icon: <VideoCameraOutlined />,
};

function Card({
  active,
  theme,
  title,
  desc,
  tags,
  meta,
  onClick,
}: {
  active: boolean;
  theme: Theme;
  title: string;
  desc: string;
  tags?: string[];
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`cc-tpl${active ? " cc-tpl--active" : ""}`}
      onClick={onClick}
    >
      <div className="cc-tpl__cover" style={{ background: theme.grad }}>
        <span className="cc-tpl__glyph">{theme.icon}</span>
        {active && (
          <span className="cc-tpl__badge">
            <CheckOutlined />
          </span>
        )}
      </div>
      <div className="cc-tpl__body">
        <div className="cc-tpl__name">{title}</div>
        <div className="cc-tpl__desc">{desc}</div>
        {tags && tags.length > 0 && (
          <div className="cc-tpl__tags">
            {tags.slice(0, 3).map((t) => (
              <span className="cc-pill" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="cc-tpl__meta">{meta}</div>
      </div>
    </button>
  );
}

export default function TemplatePicker({ templates, selected, onSelect }: Props) {
  return (
    <div className="cc-tpl-grid">
      <Card
        active={selected === null}
        theme={THEME.__auto__}
        title="智能匹配"
        desc="按文件名、画面比例与时长，自动为素材匹配最合适的模板。"
        meta="自动评分 · 兜底 default"
        onClick={() => onSelect(null)}
      />
      {templates.map((t) => (
        <Card
          key={t.name}
          active={selected === t.name}
          theme={THEME[t.name] ?? FALLBACK}
          title={t.name}
          desc={t.description}
          tags={t.tags}
          meta={`${t.canvas.width}×${t.canvas.height} · ${t.canvas.fps}fps${
            t.is_default ? " · 默认" : ""
          }`}
          onClick={() => onSelect(t.name)}
        />
      ))}
    </div>
  );
}
