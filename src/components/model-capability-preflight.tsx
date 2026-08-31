"use client";

import { useMemo } from "react";
import { LuCheck, LuCircleHelp, LuSlidersHorizontal, LuTriangleAlert } from "react-icons/lu";
import type { GenAspectRatio, GenResolution } from "@/lib/gen-params";
import { preflightVideoGeneration } from "@/lib/model-capabilities";
import { useT } from "@/lib/i18n";

export function ModelCapabilityPreflight(props: {
  modelId: string;
  supportsAudio?: boolean;
  duration?: number;
  resolution: GenResolution;
  aspectRatio: GenAspectRatio;
  chainMode: "pin" | "tail" | "off";
}) {
  const t = useT("assets");
  const result = useMemo(() => preflightVideoGeneration(props), [props]);
  const caps = result.capabilities;
  const badges = [
    ["imageToVideo", caps.imageToVideo],
    ["lastFrame", caps.lastFrame],
    ["referenceVideo", caps.referenceVideo],
    ["nativeAudio", caps.nativeAudio],
  ] as const;

  return (
    <div className="mb-6 rounded-xl border border-border/60 bg-muted/10 px-3 py-3 sm:px-4" aria-label={t("preflightTitle")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <LuSlidersHorizontal className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {t("preflightTitle")}
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${caps.confidence === "known" ? "bg-emerald-500/12 text-emerald-400" : "bg-amber-500/12 text-amber-300"}`}>
              {t(`preflightConfidence_${caps.confidence}`)}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground" title={props.modelId}>{props.modelId}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {badges.map(([key, supported]) => (
            <span key={key} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${supported === true ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-300" : supported === false ? "border-border/50 text-muted-foreground/60" : "border-amber-500/20 text-amber-300"}`}>
              {supported === true ? <LuCheck className="h-3 w-3" aria-hidden="true" /> : supported === null ? <LuCircleHelp className="h-3 w-3" aria-hidden="true" /> : null}
              {t(`cap_${key}`)}
            </span>
          ))}
        </div>
      </div>

      {result.adjustments.length === 0 && result.warnings.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400"><LuCheck className="h-3.5 w-3.5" aria-hidden="true" />{t("preflightReady")}</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {result.adjustments.map((item) => (
            <div key={`${item.field}-${item.code}`} className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-amber-300"><LuTriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />{t(`preflightField_${item.field}`)}</div>
              <p className="mt-1 text-muted-foreground">{String(item.requested)} → <span className="text-foreground">{String(item.effective)}</span> · {t(`preflightCode_${item.code}`)}</p>
            </div>
          ))}
          {result.warnings.map((warning) => (
            <div key={warning} className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs text-amber-200">
              {t(`preflightWarning_${warning}`)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
