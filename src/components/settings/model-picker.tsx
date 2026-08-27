"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, CircleAlert, LibraryBig, LoaderCircle, RotateCw, Search } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface ModelChoice { id: string; name: string; provider?: string; custom?: boolean; }

const BRAND_LABELS: Record<string, string> = {
  openai: "OpenAI", google: "Google", bytedance: "ByteDance", kwaivgi: "Kling", minimax: "MiniMax",
  alibaba: "Alibaba", meta: "Meta", qwen: "Qwen", microsoft: "Microsoft", recraft: "Recraft", xai: "xAI",
  krea: "Krea", "black-forest-labs": "Black Forest Labs", deepseek: "DeepSeek", anthropic: "Anthropic",
  replicate: "Replicate", openrouter: "OpenRouter", volcengine: "ByteDance / Volcengine", siliconflow: "SiliconFlow",
};

function normalizeBrand(raw: string) {
  const clean = raw.replace(/^~+/, "").trim();
  const key = clean.toLowerCase().replace(/[._ ]/g, "-");
  return BRAND_LABELS[key] ?? clean.replace(/(^|[-_])([a-z])/g, (_, lead, letter) => `${lead ? " " : ""}${letter.toUpperCase()}`);
}

function cleanModelLabel(value: string): string {
  return value.replace(/^~+/, "").trim();
}

function modelDisplayName(model: ModelChoice): string {
  const explicit = cleanModelLabel(model.name);
  if (explicit && explicit !== cleanModelLabel(model.id)) return explicit;
  const leaf = cleanModelLabel(model.id).split("/").pop() || explicit;
  return leaf
    .split("-")
    .filter(Boolean)
    .map((part) => (/^(ai|api|gpt|glm|llm|vl|vtr)$/i.test(part) ? part.toUpperCase() : part))
    .join(" ");
}

export function modelBrand(model: Pick<ModelChoice, "id" | "name" | "provider">): string {
  const cleanId = cleanModelLabel(model.id);
  const prefix = cleanId.includes("/") ? cleanId.split("/")[0] : "";
  if (prefix) return normalizeBrand(prefix);
  const id = cleanId.toLowerCase();
  if (/^(doubao|seedance|seedream)/.test(id)) return "ByteDance";
  if (/^(wan|qwen|tongyi)/.test(id)) return "Alibaba";
  if (/^(gpt|sora|dall-e)/.test(id)) return "OpenAI";
  if (/^(veo|imagen|gemini)/.test(id)) return "Google";
  return normalizeBrand(model.provider || cleanModelLabel(model.name).split(":")[0] || "Other");
}

function groupModels(models: ModelChoice[], query: string) {
  const needle = query.trim().toLowerCase();
  const filtered = needle ? models.filter((model) => `${model.name} ${model.id} ${model.provider ?? ""}`.toLowerCase().includes(needle)) : models;
  const groups = new Map<string, ModelChoice[]>();
  for (const model of filtered) {
    const brand = modelBrand(model);
    groups.set(brand, [...(groups.get(brand) ?? []), model]);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...groups.entries()].sort(([a], [b]) => collator.compare(a, b)).map(([brand, choices]) => ({
    brand, choices: choices.sort((a, b) => collator.compare(a.name, b.name)),
  }));
}

function useDismiss(open: boolean, setOpen: (open: boolean) => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [open, setOpen]);
  return rootRef;
}

function ModelMenu({ models, query, onQueryChange, value, onPick }: {
  models: ModelChoice[]; query: string; onQueryChange: (value: string) => void; value?: string; onPick: (model: ModelChoice) => void;
}) {
  const t = useT("settings");
  const groups = useMemo(() => groupModels(models, query), [models, query]);
  return (
    <div className="mora-model-menu" role="listbox">
      <label className="mora-model-search">
        <Search aria-hidden="true" />
        <input aria-label={t("modelListFilter")} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("modelListFilter")} />
      </label>
      <div className="mora-model-groups">
        {groups.map(({ brand, choices }) => (
          <section key={brand} className="mora-model-group">
            <div className="mora-model-group-label">
              <span className="mora-model-group-copy"><strong>{brand}</strong><small>{t("modelGroupCount", { count: choices.length })}</small></span>
            </div>
            {choices.map((model) => (
              <button key={`${model.provider ?? ""}:${model.id}`} type="button" role="option" aria-selected={model.id === value} onClick={() => onPick(model)} className="mora-model-option">
                <span><strong>{modelDisplayName(model)}</strong><small>{cleanModelLabel(model.id)}</small></span>
                <span className="mora-model-option-state">{model.id === value && <><Check aria-hidden="true" /><span>{t("modelSelected")}</span></>}</span>
              </button>
            ))}
          </section>
        ))}
        {groups.length === 0 && <div className="mora-model-empty">{t("modelListNoMatch")}</div>}
      </div>
    </div>
  );
}

export function GroupedModelSelect({ value, models, onChange, placeholder, disabled, loading }: {
  value: string; models: ModelChoice[]; onChange: (model: string) => void; placeholder: string; disabled?: boolean; loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useDismiss(open, setOpen);
  const selected = models.find((model) => model.id === value);
  return (
    <div ref={rootRef} className="mora-model-picker" data-open={open || undefined}>
      <button type="button" className="mora-model-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span className="mora-model-trigger-copy">
          {selected && <small>{modelBrand(selected)}</small>}
          <strong className={cn(!selected && "text-muted-foreground")}>{loading ? "…" : selected ? modelDisplayName(selected) : placeholder}</strong>
        </span>
        <span className="mora-model-trigger-disclosure"><ChevronDown aria-hidden="true" /></span>
      </button>
      {open && <ModelMenu models={models} query={query} onQueryChange={setQuery} value={value} onPick={(model) => { onChange(model.id); setOpen(false); setQuery(""); }} />}
    </div>
  );
}

export function ModelPicker({ value, baseUrl, apiKey, onChange, placeholder }: {
  value: string; baseUrl: string; apiKey: string; onChange: (model: string) => void; placeholder?: string;
}) {
  const t = useT("settings");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useDismiss(open, setOpen);

  const load = async () => {
    if (models.length) { setOpen(true); return; }
    setState("loading"); setError("");
    try {
      const res = await fetch("/api/llm/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl, apiKey }) });
      const data = await res.json().catch(() => ({ ok: false }));
      const choices = (Array.isArray(data.models) ? data.models : []).map((id: string) => ({ id, name: id }));
      setModels(choices); setOpen(Boolean(choices.length));
      if (!data.ok) setError(data.error || t("modelListFailed"));
    } catch (e) { setError(e instanceof Error ? e.message : t("modelListFailed")); }
    finally { setState("idle"); }
  };

  return (
    <div ref={rootRef} className="mora-model-picker" data-open={open || undefined}>
      <div className="mora-model-input-shell">
        <input value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => models.length && setOpen(true)} placeholder={placeholder} className="font-mono" />
        <button type="button" onClick={load} disabled={!baseUrl || state === "loading"} title={t("modelListButton")} aria-label={t("modelListButton")} aria-expanded={open}>
          {state === "loading" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LibraryBig />}
          <span>{state === "loading" ? t("modelListLoading") : t("modelListButton")}</span>
          {state !== "loading" && <ChevronDown className="mora-model-library-chevron" aria-hidden="true" />}
        </button>
      </div>
      {error && (
        <div className="mora-model-feedback" role="status">
          <CircleAlert aria-hidden="true" />
          <span><strong>{t("modelListFailed")}</strong><small>{error}</small></span>
          <button type="button" onClick={load} disabled={state === "loading"} aria-label={t("modelListRetry")}>
            <RotateCw aria-hidden="true" />{t("modelListRetry")}
          </button>
        </div>
      )}
      {open && <ModelMenu models={models} query={query} onQueryChange={setQuery} value={value} onPick={(model) => { onChange(model.id); setOpen(false); setQuery(""); }} />}
    </div>
  );
}
