"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";
import type { ProductionOverviewModel } from "@/lib/production-overview";

export function ProductionOverviewStages({ overview }: { overview: ProductionOverviewModel }) {
  const t = useT("production");

  return <>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {overview.stages.map((stage) => <div key={stage.id} data-stage={stage.id} data-state={stage.state} className={`min-h-24 rounded-xl border p-3 ${["done", "ready"].includes(stage.state) ? "border-emerald-500/25 bg-emerald-500/[.06]" : ["failed", "attention"].includes(stage.state) ? "border-amber-500/25 bg-amber-500/[.06]" : stage.state === "running" ? "border-primary/30 bg-primary/8" : "border-border/50 bg-background/25"}`}>
        <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{t(`overviewStage_${stage.id}`)}</span><span className={`h-2 w-2 rounded-full ${["done", "ready"].includes(stage.state) ? "bg-emerald-500" : ["failed", "attention"].includes(stage.state) ? "bg-amber-500" : stage.state === "running" ? "bg-primary" : "bg-muted-foreground/40"}`} /></span>
        <span className="mt-2 block text-xs text-muted-foreground">{t(`stageState_${stage.state}`)}</span>
        {stage.total > 1 && <span className="mt-1 block text-[10px] text-muted-foreground">{stage.current}/{stage.total}</span>}
        {stage.detail && <span className="mt-1 block truncate text-[10px] text-muted-foreground">{stage.detail}</span>}
        {!stage.action.enabled && stage.action.reason && <span data-action-reason={stage.action.reason} className="mt-1 block text-[10px] text-muted-foreground">{t(`actionReason_${stage.action.reason}`)}</span>}
      </div>)}
    </div>
    {overview.summary.nextAction.href && <Link href={overview.summary.nextAction.href} data-next-action={overview.summary.nextAction.id} className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary">{t(`next_${overview.summary.nextAction.id}`)}</Link>}
    {overview.legacyWorkflowIgnored && <p data-legacy-workflow="ignored" className="mt-3 text-xs text-muted-foreground">{t("legacyWorkflowIgnored")}</p>}
  </>;
}
