"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Clapperboard, Gauge, Scale, Zap } from "lucide-react";
import { useT } from "@/lib/i18n";
import { PRODUCTION_PROFILE_IDS, PRODUCTION_PROFILES, type ProductionProfileId } from "@/lib/production-profiles";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { TARGET_VIDEO_DURATIONS } from "@/lib/target-video-duration";

const ICONS = {
  rapid: Zap,
  balanced: Scale,
  cinematic: Clapperboard,
} satisfies Record<ProductionProfileId, typeof Zap>;

export function ProductionProfilePicker() {
  const t = useT("start");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const {
    activeProductionProfile,
    applyProductionProfile,
    targetVideoDuration,
    setTargetVideoDuration,
    llm,
    defaultImageModel,
    defaultVideoModel,
  } = useSettingsStore();
  const pipeline = [
    { key: "profileStageScript", value: llm.model || t("profileAutoModel") },
    { key: "profileStageFrame", value: defaultImageModel || t("profileNeedsSetup") },
    { key: "profileStageMotion", value: defaultVideoModel || t("profileNeedsSetup") },
    { key: "profileStageCompose", value: t("profileLocalCompose") },
  ];
  const incomplete = !defaultImageModel || !defaultVideoModel;
  const activeProfile = PRODUCTION_PROFILES[activeProductionProfile];
  const selectedDurationIndex = Math.max(0, TARGET_VIDEO_DURATIONS.indexOf(targetVideoDuration));

  const selectAdjacentDuration = (currentIndex: number, direction: -1 | 1) => {
    const nextIndex = Math.min(
      TARGET_VIDEO_DURATIONS.length - 1,
      Math.max(0, currentIndex + direction)
    );
    setTargetVideoDuration(TARGET_VIDEO_DURATIONS[nextIndex]);
  };

  return (
    <section className="mt-5 overflow-hidden rounded-[22px] border border-border/65 bg-card shadow-[0_18px_44px_rgba(45,76,110,.07)]" aria-labelledby="production-profile-title">
      <div className="flex items-start justify-between gap-5 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/[.09] text-primary">
            <Gauge className="size-4" aria-hidden="true" />
          </span>
          <div>
            <div id="production-profile-title" className="text-sm font-semibold text-foreground">{t("profileTitle")}</div>
            <p className="mt-1 max-w-md text-[11px] leading-5 text-muted-foreground">{t("profileDescription")}</p>
          </div>
        </div>
        <Link href="/settings?tab=video" className="inline-flex min-h-8 shrink-0 items-center rounded-lg px-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/[.07]">
          {t("profileFineTune")}
        </Link>
      </div>

      <div className="mx-5 mb-4 flex flex-col gap-3 rounded-xl border border-border/55 bg-transparent px-4 py-3 sm:mx-6 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <div className="shrink-0 text-xs font-semibold tracking-[-0.01em] text-foreground">{t("targetDurationLabel")}</div>
          <p className="mt-0.5 truncate text-[10px] leading-4 text-muted-foreground">{t("targetDurationHint")}</p>
        </div>

        <div className="relative w-full shrink-0 sm:w-[280px]" role="radiogroup" aria-label={t("targetDurationLabel")}>
          <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-[9px] h-px bg-border/80" aria-hidden="true">
            <span
              className="block h-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: `${(selectedDurationIndex / (TARGET_VIDEO_DURATIONS.length - 1)) * 100}%` }}
            />
          </div>
          <div className="relative grid grid-cols-4">
          {TARGET_VIDEO_DURATIONS.map((duration) => {
            const selected = targetVideoDuration === duration;
            const index = TARGET_VIDEO_DURATIONS.indexOf(duration);
            const completed = index < selectedDurationIndex;
            return (
              <button
                key={duration}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTargetVideoDuration(duration)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                    event.preventDefault();
                    selectAdjacentDuration(index, -1);
                  }
                  if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                    event.preventDefault();
                    selectAdjacentDuration(index, 1);
                  }
                }}
                className="group relative z-10 flex min-h-9 flex-col items-center gap-1 rounded-lg px-1 text-[10px] font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                <span
                  className={`grid size-[19px] place-items-center rounded-full border transition-[border-color,background-color,box-shadow,transform] duration-200 motion-reduce:transition-none ${
                    selected
                      ? "scale-110 border-primary bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/.10),0_2px_6px_hsl(var(--primary)/.22)]"
                      : completed
                        ? "border-primary/70 bg-primary/15 group-hover:bg-primary/25"
                        : "border-border bg-card shadow-[0_1px_2px_hsl(var(--foreground)/.06)] group-hover:border-primary/45"
                  }`}
                  aria-hidden="true"
                >
                  <span className={`rounded-full transition-colors ${selected ? "size-1.5 bg-primary-foreground" : completed ? "size-1 bg-primary" : "size-1 bg-muted-foreground/35 group-hover:bg-primary/60"}`} />
                </span>
                <span className={`px-1 transition-colors ${selected ? "text-primary" : completed ? "text-foreground/80" : "text-muted-foreground group-hover:text-foreground"}`}>
                  {duration}s
                </span>
              </button>
            );
          })}
          </div>
        </div>
      </div>

      <div className="grid gap-2.5 px-5 pb-5 sm:grid-cols-3 sm:px-6" role="radiogroup" aria-label={t("profileTitle")}>
        {PRODUCTION_PROFILE_IDS.map((id) => {
          const profile = PRODUCTION_PROFILES[id];
          const Icon = ICONS[id];
          const selected = activeProductionProfile === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => applyProductionProfile(id)}
              className={`relative min-w-0 rounded-xl border px-3.5 py-3.5 text-left outline-none transition-[border-color,background-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-primary/30 active:scale-[.985] ${selected ? "border-primary/45 bg-primary/[.055] shadow-[0_8px_20px_rgba(0,113,227,.08)]" : "border-border/65 bg-card hover:border-primary/25 hover:bg-primary/[.018]"}`}
            >
              <span className="flex items-start gap-2.5">
                <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border/70 bg-card text-muted-foreground"}`}>
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-foreground">{t(`profile_${id}_name`)}</span>
                  <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{profile.resolution} · {t("profileShotDuration", { seconds: profile.duration })}</span>
                </span>
                {selected ? <Check className="mt-1 size-3.5 shrink-0 text-primary" strokeWidth={2.8} aria-hidden="true" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mx-5 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-primary/[.045] px-3.5 py-2.5 text-[11px] sm:mx-6">
        <span className="inline-flex items-center gap-1.5 font-medium text-primary" aria-live="polite"><Check className="size-3" />{t("profileApplied")}</span>
        <span className="text-muted-foreground">{t(`profile_${activeProductionProfile}_name`)} ·
          {activeProfile.resolution} · {t("profileDurationCompact", { seconds: activeProfile.duration })} · {t(`profileMotion_${activeProfile.motionIntensity}`)} · {t(`profileChain_${activeProfile.chainMode}`)}
        </span>
      </div>

      <button
        type="button"
        aria-expanded={workflowOpen}
        onClick={() => setWorkflowOpen((open) => !open)}
        className="flex w-full items-center gap-2 border-t border-border/50 px-5 py-3 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 sm:px-6"
      >
        <span className="font-medium text-foreground">{t("profilePipelineLabel")}</span>
        <span>{t("profileStageCount", { n: pipeline.length })}</span>
        <ChevronDown className={`ml-auto size-3.5 transition-transform ${workflowOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {workflowOpen ? (
        <div className="grid gap-x-6 gap-y-2 border-t border-border/45 px-5 py-4 sm:grid-cols-2 sm:px-6" aria-label={t("profilePipelineLabel")}>
            {pipeline.map((stage, index) => (
              <div key={stage.key} className="flex min-w-0 items-center gap-2 text-[10px]">
                <span className="grid size-4 shrink-0 place-items-center rounded-full border border-border/70 text-[9px] text-muted-foreground">{index + 1}</span>
                <span className="shrink-0 text-muted-foreground">{t(stage.key)}</span>
                <span className="min-w-0 flex-1 truncate text-right font-medium text-foreground" title={stage.value}>{stage.value}</span>
              </div>
            ))}
        </div>
      ) : null}

      {incomplete && (
        <p className="border-t border-border/60 bg-[var(--warning)]/[.045] px-4 py-2.5 text-[11px] text-[var(--warning)]">
          {t("profileModelWarning")} <Link href="/settings?tab=providers" className="inline-flex min-h-6 items-center font-medium underline underline-offset-2">{t("profileConfigure")}</Link>
        </p>
      )}
    </section>
  );
}
