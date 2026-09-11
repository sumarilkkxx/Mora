"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, CircleAlert, LibraryBig, LoaderCircle, RotateCw, Search, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface ModelChoice { id: string; name: string; provider?: string; custom?: boolean; }

const BRAND_LABELS: Record<string, string> = {
  openai: "OpenAI", google: "Google", bytedance: "ByteDance", kwaivgi: "Kling", minimax: "MiniMax",
  alibaba: "Alibaba", meta: "Meta", qwen: "Qwen", microsoft: "Microsoft", recraft: "Recraft", xai: "xAI",
  krea: "Krea", "black-forest-labs": "Black Forest Labs", deepseek: "DeepSeek", anthropic: "Anthropic",
  replicate: "Replicate", openrouter: "OpenRouter", volcengine: "ByteDance / Volcengine", siliconflow: "SiliconFlow",
  "atlas-cloud": "Atlas Cloud",
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

function modelProviderLabel(model: Pick<ModelChoice, "provider">): string {
  return model.provider ? normalizeBrand(model.provider) : "Other";
}

function groupModels(models: ModelChoice[], query: string) {
  const needle = query.trim().toLowerCase();
  const filtered = needle ? models.filter((model) => `${model.name} ${model.id} ${model.provider ?? ""}`.toLowerCase().includes(needle)) : models;
  const groups = new Map<string, ModelChoice[]>();
  for (const model of filtered) {
    // Provider-backed image/video choices show the execution platform. LLM
    // discovery only returns canonical IDs, so group those by their namespace.
    const brand = model.provider ? modelProviderLabel(model) : modelBrand(model);
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

function ModelMenu({ models, query, onQueryChange, value, valueProvider, onPick, onClose, capability }: {
  models: ModelChoice[]; query: string; onQueryChange: (value: string) => void; value?: string; valueProvider?: string; onPick: (model: ModelChoice) => void; onClose?: () => void; capability?: "text" | "vision";
}) {
  const t = useT("settings");
  const groups = useMemo(() => groupModels(models, query), [models, query]);
  return (
    <div className="mora-model-menu" role="listbox">
      <div className="mora-model-menu-head">
        <span><strong>{t(capability === "vision" ? "modelListPanelVision" : capability === "text" ? "modelListPanelText" : "modelListPanelTitle")}</strong><small>{t("modelGroupCount", { count: models.length })}</small></span>
        {onClose && <button type="button" onClick={onClose} aria-label={t("modelListClose")}><X aria-hidden="true" /></button>}
      </div>
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
              <button key={`${model.provider ?? ""}:${model.id}`} type="button" role="option" aria-selected={model.id === value && (!valueProvider || model.provider === valueProvider)} onClick={() => onPick(model)} className="mora-model-option">
                <span><strong>{modelDisplayName(model)}</strong><small>{cleanModelLabel(model.id)}</small></span>
                <span className="mora-model-option-state">{model.id === value && (!valueProvider || model.provider === valueProvider) && <><Check aria-hidden="true" /><span>{t("modelSelected")}</span></>}</span>
              </button>
            ))}
          </section>
        ))}
        {groups.length === 0 && <div className="mora-model-empty">{t("modelListNoMatch")}</div>}
      </div>
    </div>
  );
}

export function GroupedModelSelect({ value, valueProvider, models, onChange, placeholder, disabled, loading }: {
  value: string; valueProvider?: string; models: ModelChoice[]; onChange: (model: string, provider?: string) => void; placeholder: string; disabled?: boolean; loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useDismiss(open, setOpen);
  const selected = models.find((model) => model.id === value && (!valueProvider || model.provider === valueProvider));
  return (
    <div ref={rootRef} className="mora-model-picker" data-open={open || undefined}>
      <button type="button" className="mora-model-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span className="mora-model-trigger-copy">
          {selected && <small>{modelProviderLabel(selected)} · {modelBrand(selected)}</small>}
          <strong className={cn(!selected && "text-muted-foreground")}>{loading ? "…" : selected ? modelDisplayName(selected) : placeholder}</strong>
        </span>
        <span className="mora-model-trigger-disclosure"><ChevronDown aria-hidden="true" /></span>
      </button>
      {open && <ModelMenu models={models} query={query} onQueryChange={setQuery} value={value} valueProvider={valueProvider} onClose={() => setOpen(false)} onPick={(model) => { onChange(model.id, model.provider); setOpen(false); setQuery(""); }} />}
    </div>
  );
}

export function ModelPicker({ value, baseUrl, apiKey, onChange, placeholder, capability = "text" }: {
  value: string; baseUrl: string; apiKey: string; onChange: (model: string) => void; placeholder?: string; capability?: "text" | "vision";
}) {
  const t = useT("settings");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useDismiss(open, setOpen);

  useEffect(() => {
    setModels([]);
    setError("");
    setErrorCode("");
    setOpen(false);
  }, [baseUrl, apiKey, capability]);

  const load = async () => {
    if (models.length) { setOpen((current) => !current); return; }
    setState("loading"); setError(""); setErrorCode("");
    try {
      const res = await fetch("/api/llm/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl, apiKey, capability }) });
      const data = await res.json().catch(() => ({ ok: false }));
      const choices = (Array.isArray(data.models) ? data.models : []).map((id: string) => ({ id, name: id }));
      setModels(choices); setOpen(Boolean(choices.length));
      if (!data.ok) { setError(data.error || t("modelListFailed")); setErrorCode(data.code || "REQUEST_FAILED"); }
    } catch (e) { setError(e instanceof Error ? e.message : t("modelListFailed")); setErrorCode("REQUEST_FAILED"); }
    finally { setState("idle"); }
  };

  return (
    <div ref={rootRef} className="mora-model-picker mora-model-picker-editable" data-open={open || undefined} data-state={error ? "error" : models.length ? "ready" : "idle"}>
      <div className="mora-model-input-shell">
        <input aria-label={t("modelIdLabel")} value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => models.length && setOpen(true)} placeholder={placeholder} className="font-mono" />
        <button type="button" className="mora-model-library-button" onClick={load} disabled={!baseUrl || state === "loading"} aria-label={t("modelListBrowse")} aria-expanded={open}>
          {state === "loading" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LibraryBig />}
          <span>{state === "loading" ? t("modelListLoading") : t("modelListButton")}</span>
          {state !== "loading" && <ChevronDown className="mora-model-library-chevron" aria-hidden="true" />}
        </button>
      </div>
      <p className="mora-model-field-hint">
        {models.length ? t("modelListReady", { count: models.length }) : error ? t("modelManualStillWorks") : t("modelListIdleHint")}
      </p>
      {error && (
        <div className="mora-model-feedback" role="alert" data-code={errorCode}>
          <CircleAlert aria-hidden="true" />
          <span><strong>{t("modelListFailed")}</strong><small>{error}</small><em>{t("modelManualStillWorks")}</em></span>
          <button type="button" onClick={load} disabled={state === "loading"} aria-label={t("modelListRetry")}>
            <RotateCw aria-hidden="true" />{t("modelListRetry")}
          </button>
        </div>
      )}
      {open && <ModelMenu models={models} query={query} onQueryChange={setQuery} value={value} capability={capability} onClose={() => setOpen(false)} onPick={(model) => { onChange(model.id); setOpen(false); setQuery(""); }} />}
    </div>
  );
}
