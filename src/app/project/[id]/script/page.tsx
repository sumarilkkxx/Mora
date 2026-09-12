"use client";

import { notifyTaskSubmitted } from "@/lib/task-events";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Wand, Clock, Image as ImageIcon, ArrowRight, BookmarkPlus, LoaderCircle, TriangleAlert, CircleCheck, CircleX, Pencil } from "lucide-react";
import { checkScriptCompliance } from "@/lib/ad-compliance";
import { checkPublishReadiness } from "@/lib/publish-readiness";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { Shot } from "@/lib/db/schema";
import { JUDGE_META, type JudgeReport, autoApplicableRewrites, autoApplicableDescriptionRewrites } from "@/lib/script-judge";
import { useTemplateStore } from "@/lib/stores/template-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useCharacterStore } from "@/lib/stores/project-store";
import { resolveDefaultModelTarget, buildImageOptions, buildVideoOptions, toEditVariant } from "@/lib/gen-params";
import { useT, useLocale } from "@/lib/i18n";
import { STAGE_LABEL_KEYS } from "@/lib/pipeline-stages";
import { friendlyError } from "@/lib/friendly-error";
import { ProjectHeader } from "@/components/project-header";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { normalizeProductionMode, type ProductionMode } from "@/lib/production-mode";

// shot type labels (label changed to i18n key, resolved per locale at render time)
const shotTypeLabels: Record<Shot["type"], { labelKey: string; color: string }> = {
  hook: { labelKey: "shotTypeHook", color: "bg-muted text-muted-foreground" },
  pain_point: { labelKey: "shotTypePainPoint", color: "bg-muted text-muted-foreground" },
  product_reveal: { labelKey: "shotTypeProductReveal", color: "bg-muted text-muted-foreground" },
  demo: { labelKey: "shotTypeDemo", color: "bg-muted text-muted-foreground" },
  social_proof: { labelKey: "shotTypeSocialProof", color: "bg-muted text-muted-foreground" },
  cta: { labelKey: "shotTypeCta", color: "bg-muted text-muted-foreground" },
};

// script style → i18n key (resolved per locale at render time)
const styleLabelKeys: Record<string, string> = {
  pain_point: "stylePainPoint",
  scene: "styleScene",
  comparison: "styleComparison",
  story: "styleStory",
};

// structure of a script row returned from the backend scripts table
interface DbScript {
  id: string;
  title: string | null;
  styleType: string;
  totalDuration: number | null;
  shots: Shot[];
  selected: boolean | null;
}

export default function ScriptPage() {
  const t = useT("script");
  const tc = useT("common");
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [selectedScript, setSelectedScript] = useState(0);
  const [scripts, setScripts] = useState<
    { id: string; title: string; styleType: string; totalDuration: number; shots: Shot[] }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [productionMode, setProductionMode] = useState<ProductionMode>("local");
  // project metadata: reused when re-generating the script from the empty state
  const [projectMeta, setProjectMeta] = useState<{
    productName: string;
    category: string;
    description: string;
    productImages: string[];
    videoMode: string;
    contentType: string;
    topic: string;
    targetDuration: number;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const { llm } = useSettingsStore();
  // beginner/director split: simple mode swaps the 3-column editor for a read-and-go card
  const uiMode = useSettingsStore((st) => st.uiMode);
  const setUiMode = useSettingsStore((st) => st.setUiMode);
  // judge panel: four narrow judges tear the lines apart before generation money is spent
  const [judging, setJudging] = useState(false);
  const [judgeReport, setJudgeReport] = useState<JudgeReport | null>(null);
  const [judgeError, setJudgeError] = useState("");
  const [judgeApplying, setJudgeApplying] = useState(false);
  const [judgeApplied, setJudgeApplied] = useState(false);

  // fetch real scripts by projectId (stored in the scripts table)
  const loadScripts = async () => {
    setLoading(true);
    try {
      const [scriptsRes, projectRes] = await Promise.all([
        fetch(`/api/project/${id}/scripts`),
        fetch(`/api/project/${id}`),
      ]);
      const dbScripts: DbScript[] = scriptsRes.ok ? await scriptsRes.json() : [];
      if (projectRes.ok) {
        const proj = await projectRes.json();
        setProjectName(proj.name ?? proj.productName ?? "");
        const mode = normalizeProductionMode(proj.productionMode);
        setProductionMode(mode);
        setGenPref(mode === "ai" ? "ai" : "free");
        setProjectMeta({
          productName: proj.productName ?? "",
          category: proj.productCategory ?? "",
          description: proj.productDescription ?? "",
          productImages: Array.isArray(proj.productImages) ? proj.productImages : [],
          videoMode: proj.videoMode ?? "product_closeup",
          contentType: proj.contentType ?? "product",
          topic: proj.topic ?? "",
          targetDuration: proj.targetDuration ?? 15,
        });
      }
      if (Array.isArray(dbScripts) && dbScripts.length > 0) {
        setScripts(
          dbScripts.map((s) => ({
            id: s.id,
            title: s.title ?? t("untitledScript"),
            styleType: s.styleType,
            totalDuration: s.totalDuration ?? 0,
            shots: s.shots ?? [],
          }))
        );
        const selIdx = dbScripts.findIndex((s) => s.selected);
        setSelectedScript(selIdx >= 0 ? selIdx : 0);
      } else {
        // no real scripts: stay empty so the render layer shows the "generate" empty state
        // (fixes issue #3: old logic fell back to the Debao demo data, so users opening their own
        //  projects saw someone else's demo and thought "I can't find the task I created")
        setScripts([]);
      }
    } catch {
      setScripts([]);
    } finally {
      setLoading(false);
    }
  };

  // empty-state "generate script" click: topic projects use the de-commercialized script engine, commerce projects use the product script engine
  const handleGenerate = async () => {
    if (!projectMeta) return;
    if (!llm.apiKey) {
      setGenError(t("errorNoLlm"));
      return;
    }
    setIsGenerating(true);
    setGenError("");
    try {
      const isTopic = projectMeta.contentType === "topic";
      // topic projects use /api/topic/script (no product needed); otherwise use the commerce script engine
      const endpoint = isTopic ? "/api/topic/script" : "/api/llm/script";
      const payload = isTopic
        ? {
            projectId: id,
            topic: projectMeta.topic || projectName,
            targetDuration: projectMeta.targetDuration,
            llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model },
          }
        : {
            projectId: id,
            productName: projectMeta.productName,
            category: projectMeta.category,
            productDescription: projectMeta.description,
            targetDuration: projectMeta.targetDuration,
            styleType: "auto",
            videoMode: projectMeta.videoMode,
            productImages: projectMeta.productImages,
            llmConfig: {
              baseUrl: llm.baseUrl,
              apiKey: llm.apiKey,
              model: llm.model,
              visionModel: llm.visionModel,
            },
          };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || t("errorGenFailedCheckLlm"));
      }
      await loadScripts();
    } catch (err) {
      setGenError(friendlyError(err, locale));
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [scriptsRes, projectRes] = await Promise.all([
          fetch(`/api/project/${id}/scripts`),
          fetch(`/api/project/${id}`),
        ]);
        const dbScripts: DbScript[] = scriptsRes.ok ? await scriptsRes.json() : [];
        if (projectRes.ok) {
          const proj = await projectRes.json();
          if (!cancelled) {
            setProjectName(proj.name ?? proj.productName ?? "");
            const mode = normalizeProductionMode(proj.productionMode);
            setProductionMode(mode);
            setGenPref(mode === "ai" ? "ai" : "free");
            setProjectMeta({
              productName: proj.productName ?? "",
              category: proj.productCategory ?? "",
              description: proj.productDescription ?? "",
              productImages: Array.isArray(proj.productImages) ? proj.productImages : [],
              videoMode: proj.videoMode ?? "product_closeup",
              contentType: proj.contentType ?? "product",
              topic: proj.topic ?? "",
              targetDuration: proj.targetDuration ?? 15,
            });
          }
        }
        if (cancelled) return;
        if (Array.isArray(dbScripts) && dbScripts.length > 0) {
          setScripts(
            dbScripts.map((s) => ({
              id: s.id,
              title: s.title ?? t("untitledScript"),
              styleType: s.styleType,
              totalDuration: s.totalDuration ?? 0,
              shots: s.shots ?? [],
            }))
          );
          // default to the script marked as selected
          const selIdx = dbScripts.findIndex((s) => s.selected);
          setSelectedScript(selIdx >= 0 ? selIdx : 0);
        } else {
          // no real scripts: stay empty so the render layer shows the "generate" empty state
          // (fixes issue #3: old logic fell back to the Debao demo data, so users opening their own
          //  projects saw someone else's demo and thought "I can't find the task I created")
          setScripts([]);
        }
      } catch {
        if (!cancelled) setScripts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Translation lookup is intentionally read at load time; changing locale does not need to refetch project data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const currentScript = scripts[selectedScript];
  const isLocalProduction = productionMode === "local";
  const hasDurationMismatch = Boolean(
    currentScript &&
      projectMeta?.targetDuration &&
      currentScript.totalDuration !== projectMeta.targetDuration
  );
  // pre-render ad compliance scan: rule-check the current script's voiceover and text overlays; warn on risky terms (non-blocking)
  const adViolations = useMemo(
    () => (currentScript ? checkScriptCompliance(currentScript.shots as { voiceover?: string; textOverlay?: { text?: string } | null }[]) : []),
    [currentScript]
  );
  // pre-publish readiness check: inspect banned words / hook / duration / subtitles / CTA / three-act structure item by item (AIGC label is handled by the compose page, not checked here)
  const readiness = useMemo(
    () =>
      currentScript
        ? checkPublishReadiness(currentScript.shots as Shot[], currentScript.totalDuration, {
            locale,
            // commerce hard rule "product visible in the first 3s" — only for product videos (topic videos have no productName)
            productName: projectMeta?.productName || undefined,
          })
        : null,
    [currentScript, locale, projectMeta?.productName]
  );

  // template-related state
  const { addTemplate } = useTemplateStore();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  // regeneration deletes and rebuilds from scratch (the route deletes old scripts first) and is irreversible — show a confirmation dialog when scripts already exist to prevent accidental loss
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [savedTip, setSavedTip] = useState(false);

  /** click the "save as template" button */
  const handleSaveAsTemplate = () => {
    setTemplateName("");
    setShowSaveDialog(true);
  };

  /** confirm and save the template */
  const doSaveTemplate = () => {
    if (!templateName.trim() || !currentScript) return;
    addTemplate({
      id: crypto.randomUUID(),
      name: templateName.trim(),
      styleType: currentScript.styleType,
      shots: currentScript.shots as Shot[],
      totalDuration: currentScript.totalDuration,
      useCount: 0,
      createdAt: new Date(),
    });
    setShowSaveDialog(false);
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 3000);
  };

  // ---- selection persistence: switching the active variant must be written to the DB, otherwise
  // downstream steps (assets/video/export) read `selected` from the DB and use a different script ----
  const [selectionTip, setSelectionTip] = useState(false);
  const persistSelection = async (index: number) => {
    setSelectedScript(index);
    const target = scripts[index];
    if (!target) return;
    try {
      await fetch(`/api/project/${id}/scripts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedScriptId: target.id }),
      });
      setSelectionTip(true);
      setTimeout(() => setSelectionTip(false), 1500);
    } catch {
      /* selection is best-effort; the UI already reflects the choice locally */
    }
  };

  // ---- per-shot inline editing: only voiceover/description text (structure/timing untouched) ----
  const [editingShotId, setEditingShotId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ voiceover: string; description: string }>({ voiceover: "", description: "" });
  const [editStatus, setEditStatus] = useState<"" | "saving" | "saved" | "failed">("");
  const startEditShot = (shot: Shot) => {
    setEditingShotId(shot.shotId);
    setEditDraft({ voiceover: shot.voiceover ?? "", description: shot.description ?? "" });
    setEditStatus("");
  };
  const cancelEditShot = () => {
    setEditingShotId(null);
    setEditStatus("");
  };
  // ---- one-click auto-finish: script → auto-fill footage → compose → export, all keyless.
  // Mirrors the batch page's autoCompose so the single-project web flow isn't the only path that
  // can't run end-to-end automatically. Compose is polled by the exact compositionId (precise, race-free). ----
  const [autoFinishing, setAutoFinishing] = useState(false);
  const [autoFinishStage, setAutoFinishStage] = useState("");
  const [autoFinishError, setAutoFinishError] = useState("");
  // Persisted project mode is the only source of truth for the primary flow.
  // Query flags must never auto-run downstream work or override this value.
  const [genPref, setGenPref] = useState<"free" | "ai">("free");
  // presenter picked at creation time (?presenter=<id>) — resolved to their sheet for identity locking
  const [presenterParam, setPresenterParam] = useState("");
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const p = qs.get("presenter");
    if (p) setPresenterParam(p);
  }, []);
  // Judge pass — the quality bar runs in BOTH hands-off chains, not just the pro editor.
  // Four narrow judges tear the voiceover lines apart and their rewrites are applied
  // automatically BEFORE any footage matching / generation money. Beginners never operate
  // the panel — they just get the reworked lines (and the report stays visible in the
  // editor). Missing LLM config or a failed pass skips silently: quality is best-effort,
  // never a new failure mode for the chain.
  const runJudgePass = async (scriptId: string, setStage: (s: string) => void) => {
    if (!llm.baseUrl || !llm.model) return;
    try {
      setStage(t("autoJudging"));
      const res = await fetch(`/api/project/${id}/script-judge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptId,
          llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model },
        }),
      });
      if (!res.ok) return;
      const report = (await res.json()) as JudgeReport;
      setJudgeReport(report);
      // tier gate: hands-off flow auto-applies invariant/default only; taste stays display-only
      const autoRewrites = autoApplicableRewrites(report);
      const autoDescRewrites = autoApplicableDescriptionRewrites(report);
      if (!autoRewrites.length && !autoDescRewrites.length) return;
      // merge voiceover + visual-judge description rewrites into one shotTexts PATCH
      const patchByShot = new Map<number, { shotId: number; voiceover?: string; description?: string }>();
      for (const r of autoRewrites) patchByShot.set(r.shotId, { shotId: r.shotId, voiceover: r.voiceover });
      for (const r of autoDescRewrites) {
        patchByShot.set(r.shotId, { ...(patchByShot.get(r.shotId) ?? { shotId: r.shotId }), description: r.description });
      }
      const applied = await fetch(`/api/project/${id}/scripts`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId, shotTexts: Array.from(patchByShot.values()) }),
      });
      if (!applied.ok) return;
      setJudgeApplied(true);
      // local mirror so the simple card / editor show the reworked lines, not the stale ones
      setScripts((prev) =>
        prev.map((s) =>
          s.id === scriptId
            ? {
                ...s,
                shots: s.shots.map((sh) => {
                  const p = patchByShot.get(sh.shotId);
                  return p ? { ...sh, ...(p.voiceover && { voiceover: p.voiceover }), ...(p.description && { description: p.description }) } : sh;
                }),
              }
            : s
        )
      );
    } catch {
      /* best-effort quality pass — the chain continues with the original lines */
    }
  };

  // The free chain now runs SERVER-SIDE (pipeline_runs): the page only starts a run and
  // observes it, so closing/refreshing the tab no longer kills the chain — reopening the
  // project re-attaches to the live run, and a failed run offers resume-from-breakpoint.
  const [resumableRun, setResumableRun] = useState<{ id: string; stage: string; interrupted?: boolean } | null>(null);

  /** Poll the project's latest pipeline run to a terminal status, mirroring stage labels. */
  const attachPipeline = async () => {
    setAutoFinishing(true);
    setAutoFinishError("");
    setResumableRun(null);
    try {
      // 2.5s × 312 ≈ 13 min, above the server-side compose polling budget
      for (let i = 0; i < 312; i++) {
        const d = await fetch(`/api/project/${id}/pipeline`).then((x) => x.json()).catch(() => ({}));
        const run = d?.run;
        if (!run) throw new Error(t("autoFinishFailed"));
        const labelKey = STAGE_LABEL_KEYS[run.stage as keyof typeof STAGE_LABEL_KEYS];
        setAutoFinishStage(labelKey ? t(labelKey) : t("autoFinishSelecting"));
        if (run.status === "done") { router.push(`/project/${id}/export`); return; }
        if (run.status === "failed") {
          setResumableRun({ id: run.id, stage: run.stage, interrupted: run.interrupted });
          throw new Error(run.error === "interrupted" ? t("pipelineInterrupted") : run.error || t("autoFinishFailed"));
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      throw new Error(t("autoFinishFailed"));
    } catch (err) {
      setAutoFinishError(friendlyError(err, locale));
      setAutoFinishing(false);
    }
  };

  /** Start (or resume) the server-side run, then attach as an observer. */
  const startPipeline = async (resume: boolean) => {
    if (autoFinishing) return;
    if (!resume && !currentScript) return;
    setAutoFinishing(true);
    setAutoFinishError("");
    setAutoFinishStage(t("autoFinishSelecting"));
    try {
      const res = await fetch(`/api/project/${id}/pipeline`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(resume ? { resume: true } : { scriptId: currentScript!.id }),
          // LLM config opt-in: enables the judge quality pass + semantic footage rerank
          ...(llm.baseUrl && llm.model ? { llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model } } : {}),
        }),
      });
      if (!res.ok) throw new Error(t("autoFinishFailed"));
      await attachPipeline();
    } catch (err) {
      setAutoFinishError(friendlyError(err, locale));
      setAutoFinishing(false);
    }
  };

  const autoFinish = () => startPipeline(false);

  // On entry, look for a live or breakpointed run BEFORE any fresh auto start:
  // live → re-attach (the "came back after closing the tab" path);
  // failed → surface the resume/restart choice instead of silently starting over.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await fetch(`/api/project/${id}/pipeline`).then((x) => x.json()).catch(() => ({}));
      if (cancelled) return;
      const run = d?.run;
      if (run?.status === "running") {
        void attachPipeline();
      } else if (run?.status === "failed") {
        setResumableRun({ id: run.id, stage: run.stage, interrupted: run.interrupted });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount; attachPipeline is a stable page-level handler
  }, [id]);

  // ---- AI film chain (grid → one-call film): the paid path. The free script above is the
  // zero-cost "video plan" gate — money is only spent after this one explicit click, and the
  // bill goes to the user's own model platform (open-source BYOK, Mora itself is free) ----
  const { characters: presenterLib, updateCharacter } = useCharacterStore();
  const [aiFilming, setAiFilming] = useState(false);
  const [aiFilmStage, setAiFilmStage] = useState("");
  const [aiFilmError, setAiFilmError] = useState("");
  /** dryRun preview of the film pass — the paid submit needs an explicit confirm on this exact prompt */
  const [filmPreview, setFilmPreview] = useState<{
    prompt: string;
    modelId: string;
    shotCount: number;
    seconds: number;
    requestedSeconds?: number;
    durationAdjusted?: boolean;
    supportedDurations?: number[];
    requestSettings: {
      modelId: string;
      resolution: string;
      requestedResolution: string;
      aspectRatio: string;
      requestedAspectRatio: string;
      duration: number;
      requestedDuration: number;
      generateAudio: boolean;
      seed?: number;
    };
    ignoredSettings?: string[];
    referenceImages: number;
    referenceQuota?: { ok: boolean; count: number; limit?: number };
    dialogueWarnings: { index: number; seconds: number; count: number; limit: number }[];
  } | null>(null);

  /** Free dryRun call — full film prompt + counts + warnings, nothing submitted, nothing billed. */
  const fetchFilmPreview = async (scriptId: string) => {
    const presenter = presenterLib.find((c) => c.id === presenterParam);
    const settings = useSettingsStore.getState();
    const videoTarget = await resolveDefaultModelTarget(
      settings.providers,
      settings.defaultVideoModel,
      settings.customModels,
      "video",
      settings.defaultVideoProvider
    );
    if (!videoTarget) throw new Error(t("aiFilmNeedModels"));
    const res = await fetch(`/api/project/${id}/storyboard-film`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scriptId,
        dryRun: true,
        provider: videoTarget.provider,
        model: videoTarget.model,
        apiKey: videoTarget.apiKey,
        baseUrl: videoTarget.baseUrl,
        // a picked presenter WILL ride as a reference sheet (generated on demand later), so the
        // preview must count its slot now — the dryRun branch only reads truthiness
        ...(presenter && { characterSheetUrl: presenter.referenceImages?.[0] ?? "planned" }),
        options: buildVideoOptions(settings.videoParams),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t("aiFilmFailed"));
    return data as NonNullable<typeof filmPreview>;
  };

  // Phase 1 — quality + preview, all free: judge pass rewrites weak lines first, then a dryRun
  // shows the exact film prompt / duration / reference count / density warnings. Money moves
  // only after the user confirms THIS preview (text-level confirmation before any spend).
  const runAiFilm = async () => {
    if (!currentScript || aiFilming || autoFinishing) return;
    setAiFilming(true);
    setAiFilmError("");
    setFilmPreview(null);
    try {
      // make sure the picked variant is the one the pipeline uses
      await fetch(`/api/project/${id}/scripts`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedScriptId: currentScript.id }),
      }).catch(() => {});
      // judge pass BEFORE the preview, so the confirm shows the final (reworked) lines
      await runJudgePass(currentScript.id, setAiFilmStage);
      setAiFilmStage(t("aiFilmPreviewing"));
      setFilmPreview(await fetchFilmPreview(currentScript.id));
      setAiFilming(false); // hand over to the preview card; nothing has been billed yet
    } catch (err) {
      setAiFilmError(friendlyError(err, locale));
      setAiFilming(false);
    }
  };

  // Phase 2 — the confirmed spend. The confirmation is bound to the previewed prompt: a fresh
  // dryRun must return the identical prompt (script edited in between → abort and re-preview).
  const confirmAiFilm = async () => {
    if (!currentScript || !filmPreview || aiFilming) return;
    setAiFilming(true);
    setAiFilmError("");
    try {
      setAiFilmStage(t("aiFilmVerifying"));
      const fresh = await fetchFilmPreview(currentScript.id);
      if (
        fresh.prompt !== filmPreview.prompt ||
        fresh.modelId !== filmPreview.modelId ||
        JSON.stringify(fresh.requestSettings) !== JSON.stringify(filmPreview.requestSettings)
      ) {
        // stale confirmation: show the new preview instead of submitting outdated content
        setFilmPreview(fresh);
        setAiFilming(false);
        setAiFilmError(t("aiFilmPreviewChanged"));
        return;
      }
      // resolve the configured default image + video models to their providers
      setAiFilmStage(t("aiFilmResolve"));
      const s = useSettingsStore.getState();
      const [imgTarget, vidTarget] = await Promise.all([
        resolveDefaultModelTarget(s.providers, s.defaultImageModel, s.customModels, "image"),
        resolveDefaultModelTarget(s.providers, s.defaultVideoModel, s.customModels, "video", s.defaultVideoProvider),
      ]);
      if (!imgTarget || !vidTarget) throw new Error(t("aiFilmNeedModels"));
      // identity/product anchors: presenter sheet (picked at creation) + first product photo
      const presenter = presenterLib.find((c) => c.id === presenterParam);
      let sheet = presenter?.referenceImages?.[0];
      // multi-view sheet on demand: a presenter picked at creation but never "sheeted" gets their
      // 2x2 four-view reference generated right here (one square generation, physically the same
      // person) and saved back to the library — identity stays locked across this film AND future
      // ones. Needs an appearance description; failure just falls back to today's no-sheet path.
      if (presenter && !sheet && presenter.appearance?.trim()) {
        setAiFilmStage(t("aiFilmSheet"));
        try {
          const sheetRes = await fetch("/api/characters/sheet", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              appearance: presenter.appearance,
              name: presenter.name,
              provider: imgTarget.provider,
              model: imgTarget.model,
              apiKey: imgTarget.apiKey,
              baseUrl: imgTarget.baseUrl,
              options: buildImageOptions(s.imageParams ? { ...s.imageParams, aspectRatio: "1:1", count: 1 } : undefined),
            }),
          });
          const sheetData = await sheetRes.json().catch(() => ({}));
          if (sheetRes.ok && sheetData.url) {
            sheet = sheetData.url as string;
            updateCharacter(presenter.id, { referenceImages: [sheet, ...(presenter.referenceImages ?? []).slice(1)] });
          }
        } catch {
          /* sheet is an upgrade, not a dependency — the grid still locks identity within this film */
        }
      }
      const productRef = projectMeta?.productImages?.[0];
      // 1) storyboard grid: ONE image generation renders every shot as a keyframe (identity locked)
      setAiFilmStage(t("aiFilmGrid"));
      const gridRes = await fetch(`/api/project/${id}/storyboard-grid`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptId: currentScript.id,
          provider: imgTarget.provider,
          model: sheet || productRef ? toEditVariant(imgTarget.model) : imgTarget.model,
          apiKey: imgTarget.apiKey,
          baseUrl: imgTarget.baseUrl,
          ...(sheet && { characterSheetUrl: sheet }),
          ...(productRef && { productImageUrl: productRef }),
          options: buildImageOptions(s.imageParams ? { ...s.imageParams, aspectRatio: s.videoParams.aspectRatio, count: 1 } : undefined),
        }),
      });
      const gridData = await gridRes.json().catch(() => ({}));
      if (!gridRes.ok) throw new Error(gridData.error || t("aiFilmFailed"));
      // 2) film pass: all keyframes ride one reference-to-video call — native cuts + spoken lines
      setAiFilmStage(t("aiFilmRender"));
      const filmRes = await fetch(`/api/project/${id}/storyboard-film`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptId: currentScript.id,
          provider: vidTarget.provider,
          model: vidTarget.model,
          apiKey: vidTarget.apiKey,
          baseUrl: vidTarget.baseUrl,
          ...(sheet && { characterSheetUrl: sheet }),
          options: buildVideoOptions(s.videoParams),
        }),
      });
      const filmData = await filmRes.json().catch(() => ({}));
      if (!filmRes.ok) throw new Error(filmData.error || t("aiFilmFailed"));
      notifyTaskSubmitted();
      // 3) the film landed in compositions — the export page shows it
      setFilmPreview(null);
      router.push(`/project/${id}/export`);
    } catch (err) {
      // keep the preview card open: retrying confirm re-verifies via a fresh dryRun
      setAiFilmError(friendlyError(err, locale));
      setAiFilming(false);
    }
  };

  // switching scripts invalidates the report — it was ruled on another script's lines
  useEffect(() => {
    setJudgeReport(null);
    setJudgeError("");
    setJudgeApplied(false);
  }, [selectedScript]);

  // run the judge panel on the current script's voiceover lines (one LLM call, four judges)
  const runJudge = async () => {
    if (!currentScript || judging) return;
    setJudging(true);
    setJudgeError("");
    setJudgeReport(null);
    setJudgeApplied(false);
    try {
      const res = await fetch(`/api/project/${id}/script-judge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptId: currentScript.id,
          llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("judgeFailed"));
      setJudgeReport(data as JudgeReport);
    } catch (e) {
      setJudgeError(e instanceof Error ? e.message : t("judgeFailed"));
    } finally {
      setJudging(false);
    }
  };

  // apply the judges' rewrites through the existing shotTexts PATCH channel (+ optimistic update)
  const applyJudgeRewrites = async () => {
    if (!currentScript || !judgeReport || judgeApplying) return;
    // tier gate applies to the button too: taste-tier rewrites stay suggestions in the list
    const autoRewrites = autoApplicableRewrites(judgeReport);
    const autoDescRewrites = autoApplicableDescriptionRewrites(judgeReport);
    if (autoRewrites.length === 0 && autoDescRewrites.length === 0) return;
    const patchByShot = new Map<number, { shotId: number; voiceover?: string; description?: string }>();
    for (const r of autoRewrites) patchByShot.set(r.shotId, { shotId: r.shotId, voiceover: r.voiceover });
    for (const r of autoDescRewrites) {
      patchByShot.set(r.shotId, { ...(patchByShot.get(r.shotId) ?? { shotId: r.shotId }), description: r.description });
    }
    setJudgeApplying(true);
    setScripts((prev) =>
      prev.map((s) =>
        s.id === currentScript.id
          ? {
              ...s,
              shots: s.shots.map((sh) => {
                const p = patchByShot.get(sh.shotId);
                return p ? { ...sh, ...(p.voiceover && { voiceover: p.voiceover }), ...(p.description && { description: p.description }) } : sh;
              }),
            }
          : s
      )
    );
    try {
      const res = await fetch(`/api/project/${id}/scripts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: currentScript.id, shotTexts: Array.from(patchByShot.values()) }),
      });
      if (!res.ok) throw new Error("apply failed");
      setJudgeApplied(true);
    } catch {
      setJudgeError(t("judgeApplyFailed"));
    } finally {
      setJudgeApplying(false);
    }
  };

  const saveEditShot = async (shotId: number) => {
    if (!currentScript) return;
    setEditStatus("saving");
    // optimistic local update so the timeline reflects the edit immediately
    setScripts((prev) =>
      prev.map((s) =>
        s.id === currentScript.id
          ? { ...s, shots: s.shots.map((sh) => (sh.shotId === shotId ? { ...sh, voiceover: editDraft.voiceover.trim(), description: editDraft.description.trim() } : sh)) }
          : s
      )
    );
    try {
      const res = await fetch(`/api/project/${id}/scripts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: currentScript.id, shotTexts: [{ shotId, voiceover: editDraft.voiceover, description: editDraft.description }] }),
      });
      if (!res.ok) throw new Error("save failed");
      setEditStatus("saved");
      setEditingShotId(null);
      setTimeout(() => setEditStatus(""), 1500);
    } catch {
      setEditStatus("failed");
    }
  };

  // slim context strip (shared by loading, empty and normal states); global chrome lives in AppShell
  const headerBar = <ProjectHeader projectName={projectName || t("defaultProjectName")} productionMode={productionMode} />;

  // loading: skeleton screen (mimics the script card layout; feels faster than a spinner and reduces perceived wait)
  if (loading) {
    return (
      <div className="min-h-screen grid-bg legacy-studio-page">
        {headerBar}
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-4" aria-busy="true" aria-label={t("loadingScripts")}>
          {[0, 1, 2].map((i) => (
            <Card key={i} className="glass-card animate-pulse">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-40 rounded bg-muted/60" />
                  <div className="h-4 w-16 rounded bg-muted/40" />
                </div>
                <div className="h-2 w-full rounded bg-muted/40" />
                <div className="flex gap-2">
                  <div className="h-6 w-20 rounded bg-muted/40" />
                  <div className="h-6 w-20 rounded bg-muted/40" />
                  <div className="h-6 w-24 rounded bg-muted/30" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // empty state: this project has no real scripts yet (fixes #3: no longer shows the Debao demo; provides a recoverable "generate script" entry point)
  if (scripts.length === 0) {
    return (
      <div className="min-h-screen grid-bg legacy-studio-page">
        {headerBar}
        <div className="mx-auto max-w-md flex flex-col items-center justify-center py-28 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 mb-5">
            <Wand className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-2">{t("emptyTitle")}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {t("emptyDesc", { name: projectName || t("emptyDescThisProject") })}
          </p>
          {genError && (
            <div className="mb-4 flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">{genError}</p>
              {/* most generation errors are LLM-config related — offer a direct jump to Settings */}
              <Link href="/settings?tab=llm" className="text-xs text-primary underline underline-offset-2 hover:text-primary/80">
                {t("goToSettings")}
              </Link>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} disabled={isGenerating} className="brand-gradient text-white">
              {isGenerating ? (
                <>
                  <LoaderCircle className="w-4 h-4 mr-2 animate-spin" />
                  {tc("generating")}
                </>
              ) : (
                <>
                  <Wand className="w-4 h-4 mr-2" />
                  {t("generateScript")}
                </>
              )}
            </Button>
            <Link href="/projects">
              <Button variant="outline">{t("backToProjects")}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Hands-off takeover: while the auto chain (free) or the AI film chain (paid) runs,
  // beginners see one progress card, not the editor
  // dryRun preview card: the paid film call waits for an explicit confirm on this exact prompt
  if (filmPreview && !aiFilming) {
    const overQuota = filmPreview.referenceQuota && !filmPreview.referenceQuota.ok;
    return (
      <div className="min-h-screen grid-bg legacy-studio-page">
        {headerBar}
        <main className="mx-auto max-w-2xl px-6 py-12">
          <Card className="glass-card">
            <CardContent className="space-y-4 p-6">
              <h2 className="text-lg font-bold">{t("aiFilmPreviewTitle")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("aiFilmPreviewMeta", { shots: filmPreview.shotCount, seconds: filmPreview.seconds, refs: filmPreview.referenceImages })}
              </p>
              <p className="break-all rounded-lg border border-border/60 bg-muted/20 px-3 py-2 font-mono text-xs text-foreground">
                {t("aiFilmModel")}: {filmPreview.modelId}
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs sm:grid-cols-4">
                <span>{t("aiFilmResolution")}: <b>{filmPreview.requestSettings.resolution}</b></span>
                <span>{t("aiFilmAspectRatio")}: <b>{filmPreview.requestSettings.aspectRatio}</b></span>
                <span>{t("aiFilmDuration")}: <b>{filmPreview.requestSettings.duration}s</b></span>
                <span>{t("aiFilmSeed")}: <b>{filmPreview.requestSettings.seed ?? t("aiFilmRandom")}</b></span>
              </div>
              {!!filmPreview.ignoredSettings?.length && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-500">
                  {t("aiFilmIgnoredSettings", { settings: filmPreview.ignoredSettings.join(", ") })}
                </div>
              )}
              {filmPreview.durationAdjusted && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-500">
                  {t("aiFilmDurationAdjusted", {
                    requested: filmPreview.requestedSeconds ?? filmPreview.seconds,
                    effective: filmPreview.seconds,
                  })}
                </div>
              )}
              {overQuota && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-destructive">
                  {t("aiFilmQuotaWarn", { count: filmPreview.referenceQuota!.count, limit: filmPreview.referenceQuota!.limit ?? 0 })}
                </div>
              )}
              {filmPreview.dialogueWarnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-500">
                  {t("aiFilmDensityWarn", { shots: filmPreview.dialogueWarnings.map((w) => `#${w.index + 1}`).join("、") })}
                </div>
              )}
              {aiFilmError && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-destructive">
                  <span>{aiFilmError}</span>
                  <Link href="/settings?tab=video" className="inline-flex min-h-8 shrink-0 items-center rounded-lg bg-primary px-3 font-semibold text-primary-foreground shadow-sm transition-transform active:scale-[.97]">
                    {t("configureVideoModels")}
                  </Link>
                </div>
              )}
              <details className="rounded-lg border border-border/60 p-3 text-xs">
                <summary className="cursor-pointer font-medium">{t("aiFilmPromptToggle")}</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-muted-foreground">{filmPreview.prompt}</pre>
              </details>
              <div className="flex flex-wrap items-center gap-2">
                <Button className="brand-gradient text-white" disabled={overQuota} onClick={confirmAiFilm}>
                  {t("aiFilmConfirm")}
                </Button>
                <Button variant="outline" onClick={() => { setFilmPreview(null); setAiFilmError(""); }}>
                  {t("aiFilmBackToEdit")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/80">{t("aiFilmCostNote")}</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (aiFilming) {
    return (
      <div className="min-h-screen grid-bg legacy-studio-page">
        {headerBar}
        <main className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl brand-gradient">
            <LoaderCircle className="size-6 animate-spin text-white motion-reduce:animate-none" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold">{t("autoModeTitle")}</h2>
          <p className="mt-2 text-sm text-primary">
            {aiFilming ? (aiFilmStage || t("aiFilmRender")) : (autoFinishStage || t("autoFinishSelecting"))}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {aiFilming ? t("aiFilmHint") : t("autoModeHint")}
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid-bg legacy-studio-page">
      {headerBar}

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* breakpoint choice: a failed/interrupted server-side run offers resume (default) or a
            clean restart — the beginner never loses a half-finished chain to a closed tab again */}
        {resumableRun && !autoFinishing && !aiFilming && (
          <div className="mx-auto mb-5 max-w-2xl rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-medium text-amber-500">
              {resumableRun.interrupted ? t("pipelineInterruptedTitle") : t("pipelineFailedTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("pipelineResumeDesc", {
                stage: STAGE_LABEL_KEYS[resumableRun.stage as keyof typeof STAGE_LABEL_KEYS]
                  ? t(STAGE_LABEL_KEYS[resumableRun.stage as keyof typeof STAGE_LABEL_KEYS])
                  : resumableRun.stage,
              })}
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" className="brand-gradient text-white" onClick={() => startPipeline(true)}>
                {t("pipelineResume")}
              </Button>
              <Button size="sm" variant="outline" disabled={!currentScript} onClick={() => startPipeline(false)}>
                {t("pipelineRestart")}
              </Button>
            </div>
          </div>
        )}
        {hasDurationMismatch && currentScript && projectMeta && (
          <div className="mx-auto mb-5 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  {t("durationMismatchTitle")}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t("durationMismatchDesc", {
                    script: currentScript.totalDuration,
                    target: projectMeta.targetDuration,
                  })}
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" disabled={isGenerating} onClick={() => setRegenConfirmOpen(true)}>
              {t("durationMismatchAction", { target: projectMeta.targetDuration })}
            </Button>
          </div>
        )}
        {uiMode === "simple" ? (
          /* Beginner view: script text + one big button. No storyboard, no panels. */
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold">{t("simpleTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("simpleSubtitle")}</p>
            </div>
            <Card className="glass-card">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="min-w-0 truncate text-sm font-semibold">{currentScript?.title}</h3>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {currentScript ? `${currentScript.totalDuration}s` : ""}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {currentScript?.shots.map((sh) => sh.voiceover).filter(Boolean).join("\n\n")}
                </p>
              </CardContent>
            </Card>
            {(autoFinishError || aiFilmError) && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-destructive">
                <span>{autoFinishError || aiFilmError}</span>
                {aiFilmError && <Link href="/settings?tab=video" className="inline-flex min-h-8 shrink-0 items-center rounded-lg bg-primary px-3 font-semibold text-primary-foreground shadow-sm transition-transform active:scale-[.97]">{t("configureVideoModels")}</Link>}
              </div>
            )}
            <div className="flex flex-col items-center gap-3">
              {/* Primary navigation advances exactly one stage in the persisted project mode.
                  One-click completion is explicitly secondary and never starts on page load. */}
              <Link
                href={hasDurationMismatch ? "#" : `/project/${id}/assets`}
                aria-disabled={hasDurationMismatch}
                onClick={(event) => {
                  if (hasDurationMismatch) event.preventDefault();
                }}
                className="w-full"
              >
                <Button
                  size="lg"
                  className="w-full brand-gradient text-white"
                  disabled={autoFinishing || aiFilming || !currentScript || hasDurationMismatch}
                >
                  {t(genPref === "ai" ? "nextAiAssets" : "nextLocalAssets")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
              {genPref === "ai" ? (
                <Button size="sm" variant="outline" disabled={!currentScript || hasDurationMismatch} onClick={runAiFilm}>
                  {t("aiFilmShortcut")}
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled={!currentScript || hasDurationMismatch} onClick={autoFinish}>
                  {autoFinishing ? (autoFinishStage || t("autoFinish")) : t("autoFinish")}
                </Button>
              )}
              <p className="text-center text-xs text-muted-foreground">
                {t(genPref === "ai" ? "aiFlowHint" : "localFlowHint")}
              </p>
              {/* quality reassurance: both paths run the judge panel automatically — Easy mode
                  hides the operation, never the quality features */}
              <p className="text-center text-xs text-muted-foreground/80">{t("autoJudgeNote")}</p>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" className="text-xs" disabled={isGenerating} onClick={() => setRegenConfirmOpen(true)}>
                  {t("regenerate")}
                </Button>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setUiMode("pro")}>
                  {t("simpleGoPro")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* left panel: script option selection */}
          <div className="lg:col-span-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">{t("scriptOptions")}</h2>
              <div className="flex items-center gap-2">
                {selectionTip && (
                  <span className="text-xs text-green-400 animate-in fade-in">{t("selectionSaved")}</span>
                )}
                {savedTip && (
                  <span className="text-xs text-green-400 animate-in fade-in">{t("savedAsTemplate")}</span>
                )}
                <Button variant="outline" size="sm" className="text-xs" onClick={handleSaveAsTemplate}>
                  <BookmarkPlus className="w-3.5 h-3.5 mr-1" />
                  {t("saveAsTemplate")}
                </Button>
                <Button variant="outline" size="sm" disabled={isGenerating} className="text-xs" onClick={() => setRegenConfirmOpen(true)}>
                  <Wand className="w-3.5 h-3.5 mr-1" />
                  {t("regenerate")}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {scripts.map((script, index) => (
                <Card
                  key={script.id}
                  className={`cursor-pointer transition-[transform,background-color,border-color,color,box-shadow,opacity] ${selectedScript === index ? "ring-2 ring-primary neon-glow" : "glass-card card-hover"}`}
                  onClick={() => persistSelection(index)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-sm">{script.title}</h3>
                      {!isLocalProduction && (
                        <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                          {styleLabelKeys[script.styleType] ? t(styleLabelKeys[script.styleType]) : script.styleType}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{t("shotCount", { n: script.shots.length })}</span>
                      <span>{script.totalDuration}s</span>
                    </div>
                    {/* shot type preview bar */}
                    <div className="mt-3 flex gap-0.5 h-1.5 rounded-full overflow-hidden">
                      {script.shots.map((shot) => {
                        const colors: Record<string, string> = {
                          hook: "bg-red-500", pain_point: "bg-orange-500",
                          product_reveal: "bg-blue-500", demo: "bg-green-500",
                          social_proof: "bg-sky-500", cta: "bg-amber-500",
                        };
                        return (
                          <div
                            key={shot.shotId}
                            className={`${colors[shot.type]} opacity-70`}
                            style={{ flex: shot.duration }}
                          />
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* right panel: shot detail editing */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="timeline" className="w-full">
              <div className="flex items-center justify-between mb-4">
                <TabsList>
                  <TabsTrigger value="timeline">{t("tabTimeline")}</TabsTrigger>
                  <TabsTrigger value="text">{t("tabText")}</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="text-sm"
                    disabled={judging}
                    onClick={runJudge}
                    title={t("judgeHint")}
                  >
                    {judging ? (
                      <>
                        <LoaderCircle className="w-4 h-4 mr-1 animate-spin" />
                        {t("judging")}
                      </>
                    ) : (
                      <>{t("judgeButton")}</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="text-sm"
                    disabled={autoFinishing || hasDurationMismatch}
                    onClick={autoFinish}
                    title={t("autoFinishHint")}
                  >
                    {autoFinishing ? (
                      <>
                        <LoaderCircle className="w-4 h-4 mr-1 animate-spin" />
                        {autoFinishStage || t("autoFinish")}
                      </>
                    ) : (
                      <>
                        <Wand className="w-4 h-4 mr-1" />
                        {t(genPref === "ai" ? "localQuickCut" : "autoFinish")}
                      </>
                    )}
                  </Button>
                  <Link
                    href={hasDurationMismatch ? "#" : `/project/${id}/assets`}
                    aria-disabled={hasDurationMismatch}
                    onClick={(event) => {
                      if (hasDurationMismatch) event.preventDefault();
                    }}
                  >
                    <Button className="brand-gradient text-white text-sm" disabled={autoFinishing || hasDurationMismatch}>
                      {t(isLocalProduction ? "nextLocalAssets" : "nextAiAssets")}
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Link>
                </div>
              </div>

              {/* judge-panel report: per-judge issues + before/after rewrites + one-click apply */}
              {judgeError && (
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-xs text-red-400">{judgeError}</div>
              )}
              {judgeReport && (
                <Card className="glass-card mb-4">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{t("judgeReportTitle")}</span>
                      <div className="flex items-center gap-2">
                        {judgeApplied ? (
                          <span className="text-xs text-green-400">{t("judgeAppliedTip")}</span>
                        ) : autoApplicableRewrites(judgeReport).length + autoApplicableDescriptionRewrites(judgeReport).length > 0 ? (
                          <Button size="sm" className="h-7 text-xs brand-gradient text-white" disabled={judgeApplying} onClick={applyJudgeRewrites}>
                            {judgeApplying ? t("judgeApplying") : t("judgeApply", { n: autoApplicableRewrites(judgeReport).length + autoApplicableDescriptionRewrites(judgeReport).length })}
                          </Button>
                        ) : (
                          <span className="text-xs text-green-400">{t("judgeAllPass")}</span>
                        )}
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setJudgeReport(null)}>{tc("cancel")}</Button>
                      </div>
                    </div>
                    {judgeReport.summary && <p className="text-xs text-muted-foreground">{judgeReport.summary}</p>}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {judgeReport.verdicts.map((v) => (
                        <div key={v.judge} className="rounded-lg border border-border/60 p-2.5">
                          <div className="text-xs font-medium mb-1">
                            {locale === "zh" ? JUDGE_META[v.judge].zh : JUDGE_META[v.judge].en}
                            {v.issues.length === 0 && <span className="ml-2 text-green-400">✓</span>}
                          </div>
                          {v.issues.length > 0 && (
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {v.issues.map((iss, i) => (
                                <li key={i}>
                                  {typeof iss.shotId === "number" && <span className="text-primary mr-1">#{iss.shotId}</span>}
                                  <span className={`mr-1 rounded px-1 text-[10px] ${iss.tier === "invariant" ? "bg-red-500/15 text-red-400" : iss.tier === "default" ? "bg-amber-500/15 text-amber-500" : "bg-muted text-muted-foreground"}`}>
                                    {t(`judgeTier_${iss.tier}`)}
                                  </span>
                                  {iss.issue}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                    {(judgeReport.rewrites.length > 0 || judgeReport.descriptionRewrites.length > 0) && !judgeApplied && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium">{t("judgeRewrites")}</div>
                        {judgeReport.rewrites.map((rw) => {
                          const orig = currentScript?.shots.find((s) => s.shotId === rw.shotId)?.voiceover ?? "";
                          return (
                            <div key={rw.shotId} className="rounded-lg border border-border/60 p-2.5 text-xs space-y-1">
                              <div className="text-muted-foreground line-through decoration-red-400/60">#{rw.shotId} {orig}</div>
                              <div>
                                #{rw.shotId} {rw.voiceover}
                                {rw.tier === "taste" && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">{t("judgeTasteOnly")}</span>}
                              </div>
                            </div>
                          );
                        })}
                        {judgeReport.descriptionRewrites.map((rw) => {
                          const orig = currentScript?.shots.find((s) => s.shotId === rw.shotId)?.description ?? "";
                          return (
                            <div key={`d${rw.shotId}`} className="rounded-lg border border-border/60 p-2.5 text-xs space-y-1">
                              <div className="text-[10px] text-muted-foreground">{t("judgeDescRewrite")}</div>
                              <div className="text-muted-foreground line-through decoration-red-400/60">#{rw.shotId} {orig}</div>
                              <div>
                                #{rw.shotId} {rw.description}
                                {rw.tier === "taste" && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">{t("judgeTasteOnly")}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {autoFinishError && (
                <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-2.5 text-xs text-red-400">
                  {autoFinishError}
                </div>
              )}
              {/* regenerate errors (e.g. missing LLM key) used to fail silently in this view —
                  render them here with a direct jump to Settings */}
              {genError && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-2.5 text-xs text-red-400">
                  <span>{genError}</span>
                  <Link href="/settings?tab=llm" className="shrink-0 text-primary underline underline-offset-2 hover:text-primary/80">
                    {t("goToSettings")}
                  </Link>
                </div>
              )}
              <TabsContent value="timeline" className="mt-0">
                <div className="space-y-3">
                  {readiness && (
                    <Card
                      className={
                        readiness.overall === "ready"
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : readiness.overall === "needsWork"
                          ? "border-red-500/40 bg-red-500/5"
                          : "border-amber-500/40 bg-amber-500/5"
                      }
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2.5">
                          <span className="text-sm font-semibold">{t("readinessTitle")}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              readiness.overall === "ready"
                                ? "bg-emerald-500/15 text-emerald-500"
                                : readiness.overall === "needsWork"
                                ? "bg-red-500/15 text-red-500"
                                : "bg-amber-500/15 text-amber-500"
                            }`}
                          >
                            {t(
                              readiness.overall === "ready"
                                ? "readinessReady"
                                : readiness.overall === "needsWork"
                                ? "readinessNeedsWork"
                                : "readinessRisky"
                            )}
                          </span>
                        </div>
                        <ul className="space-y-1.5">
                          {readiness.items.map((it) => (
                            <li key={it.key} className="flex items-start gap-2 text-xs">
                              {it.status === "pass" ? (
                                <CircleCheck className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                              ) : it.status === "fail" ? (
                                <CircleX className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                              ) : (
                                <TriangleAlert className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                              )}
                              <span
                                className={
                                  it.status === "pass"
                                    ? "text-muted-foreground"
                                    : it.status === "fail"
                                    ? "text-red-400"
                                    : "text-amber-400"
                                }
                              >
                                {it.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                  {adViolations.length > 0 && (
                    <Card className="border-amber-500/40 bg-amber-500/5">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <TriangleAlert className="w-4 h-4 text-amber-500" />
                          <span className="text-sm font-semibold">{t("adComplianceTitle", { n: adViolations.length })}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2.5">{t("adComplianceHint")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {adViolations.map((v) => (
                            <span
                              key={v.term}
                              title={v.suggestion}
                              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs cursor-help"
                            >
                              「{v.term}」· {v.category}
                            </span>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {currentScript?.shots.map((shot, index) => {
                    const typeInfo = shotTypeLabels[shot.type];
                    return (
                      <Card key={shot.shotId} className="glass-card overflow-hidden">
                        <CardContent className="p-0">
                          <div className="flex">
                            {/* left-side index and type */}
                            <div className="flex flex-col items-center justify-center w-16 py-4 border-r border-border/50 shrink-0">
                              <span className="text-lg font-bold text-muted-foreground/50">{String(index + 1).padStart(2, "0")}</span>
                              {!isLocalProduction && (
                                <Badge className={`${typeInfo.color} border-0 text-[10px] mt-1`}>{t(typeInfo.labelKey)}</Badge>
                              )}
                              <span className="text-[10px] text-muted-foreground mt-1">{shot.duration}s</span>
                            </div>
                            {/* right-side content */}
                            <div className="flex-1 p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  {isLocalProduction ? (
                                    <div className="mb-2">
                                      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t("localEditAction")}</p>
                                      <p className="mt-1 text-sm leading-relaxed">{shot.camera}</p>
                                    </div>
                                  ) : (
                                    <p className="text-sm leading-relaxed mb-2">{shot.description}</p>
                                  )}
                                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    {!isLocalProduction && (
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {shot.camera}
                                      </span>
                                    )}
                                    <span className="flex items-center gap-1">
                                      {isLocalProduction
                                        ? projectMeta?.productImages?.[0]
                                          ? t("localSourceProduct")
                                          : t("localSourcePending")
                                        : shot.visualSource === "product_image"
                                          ? t("visualProductImage")
                                          : shot.visualSource === "ai_generate"
                                            ? t("visualAiGenerate")
                                            : t("visualUserUpload")}
                                    </span>
                                    {editingShotId !== shot.shotId && (
                                      <button
                                        type="button"
                                        className="flex items-center gap-1 text-primary hover:underline"
                                        onClick={() => startEditShot(shot)}
                                      >
                                        <Pencil className="w-3 h-3" />
                                        {t("editShot")}
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {/* visual preview: product image shots show the uploaded product photo immediately so users see a visual right away; AI shots have no image yet at this stage */}
                                <div className="w-20 h-14 bg-muted/30 rounded-md shrink-0 overflow-hidden flex items-center justify-center border border-border/30 relative">
                                  {(isLocalProduction || shot.visualSource === "product_image") && projectMeta?.productImages?.[0] ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={projectMeta.productImages[0]}
                                      alt=""
                                      className="absolute inset-0 w-full h-full object-cover"
                                    />
                                  ) : (isLocalProduction || shot.visualSource === "product_image") ? (
                                    <span className="text-[10px] text-muted-foreground">{t("productImageShort")}</span>
                                  ) : (
                                    <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
                                  )}
                                </div>
                              </div>
                              {/* voiceover copy — inline editable */}
                              {editingShotId === shot.shotId ? (
                                <div className="mt-3 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2.5">
                                  <div>
                                    <label className="text-[10px] text-muted-foreground">{t("editVoiceoverLabel")}</label>
                                    <Textarea
                                      className="mt-1 min-h-[64px] bg-background/50 text-xs leading-relaxed"
                                      value={editDraft.voiceover}
                                      onChange={(e) => setEditDraft((d) => ({ ...d, voiceover: e.target.value }))}
                                    />
                                  </div>
                                  {!isLocalProduction && (
                                    <div>
                                      <label className="text-[10px] text-muted-foreground">{t("editDescriptionLabel")}</label>
                                      <Textarea
                                        className="mt-1 min-h-[48px] bg-background/50 text-xs leading-relaxed"
                                        value={editDraft.description}
                                        onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                                      />
                                    </div>
                                  )}
                                  <div className="flex items-center justify-end gap-2">
                                    {editStatus === "failed" && <span className="text-[10px] text-red-400 mr-auto">{t("editSaveFailed")}</span>}
                                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={cancelEditShot}>{tc("cancel")}</Button>
                                    <Button size="sm" className="h-7 text-xs brand-gradient text-white" disabled={editStatus === "saving"} onClick={() => saveEditShot(shot.shotId)}>{tc("save")}</Button>
                                  </div>
                                </div>
                              ) : (
                                shot.voiceover && (
                                  <div className="mt-3 p-2.5 bg-muted/30 rounded-md">
                                    {isLocalProduction && (
                                      <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t("localVoiceover")}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                      {shot.voiceover}
                                    </p>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="text" className="mt-0">
                <Card className="glass-card">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="font-medium text-sm mb-2">{t("fullVoiceover")}</h3>
                    {/* read-only preview: per-shot editing happens in the timeline tab (avoids the old
                        silent-discard where typing here was never saved) */}
                    <Textarea
                      readOnly
                      className="min-h-[300px] bg-background/50 text-sm leading-relaxed cursor-default"
                      value={currentScript?.shots.map((s) => s.voiceover).filter(Boolean).join("\n\n") ?? ""}
                    />
                    <p className="text-[11px] text-muted-foreground">{t("textReadOnlyHint")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("statsChars", { n: currentScript?.shots.reduce((sum, s) => sum + (s.voiceover?.length || 0), 0) ?? 0 })} ·
                      {t("statsDuration", { n: currentScript?.totalDuration ?? 0 })} ·
                      {t("statsSpeed", { n: Math.round((currentScript?.shots.reduce((sum, s) => sum + (s.voiceover?.length || 0), 0) || 0) / (currentScript?.totalDuration || 1) * 10) / 10 })}
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
        )}
      </main>

      {/* save template dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("saveTemplateTitle")}</DialogTitle>
            <DialogDescription>{t("saveTemplateDesc")}</DialogDescription>
          </DialogHeader>
              <Input
                placeholder={t("templateNamePlaceholder")}
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                name="template-name"
                autoComplete="off"
              />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowSaveDialog(false)}>{tc("cancel")}</Button>
            <Button size="sm" onClick={doSaveTemplate} disabled={!templateName.trim()}>{tc("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* regeneration confirmation dialog: deleting old scripts is irreversible, guard against accidental clicks */}
      <Dialog open={regenConfirmOpen} onOpenChange={setRegenConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
                <TriangleAlert className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
                {t("regenConfirmTitle")}
            </DialogTitle>
            <DialogDescription>{t("regenConfirmDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRegenConfirmOpen(false)}>{t("regenConfirmCancel")}</Button>
            <Button variant="destructive" size="sm" onClick={() => { setRegenConfirmOpen(false); handleGenerate(); }}>
              {t("regenConfirmOk")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
