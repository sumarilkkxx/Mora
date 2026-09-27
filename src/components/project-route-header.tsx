"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { ProjectHeader } from "@/components/project-header";
import { useLocale, useT } from "@/lib/i18n";
import type { ProductionMode } from "@/lib/production-mode";
import type { ProjectWorkflowMode } from "@/lib/project-continuation";

interface ProjectContext {
  name: string;
  productionMode: ProductionMode;
  workflowMode?: ProjectWorkflowMode | null;
  continuation?: { mode?: ProjectWorkflowMode };
}

export function ProjectRouteHeader() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useT("common");
  const [project, setProject] = useState<ProjectContext | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/project/${id}`, { signal: controller.signal, headers: { "Accept-Language": locale } })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data) setProject(data as ProjectContext); })
      .catch(error => { if (error instanceof Error && error.name !== "AbortError") setProject(null); });
    return () => controller.abort();
  }, [id, locale]);

  const suffix = pathname?.split("/").filter(Boolean).at(-1) ?? "";
  const inferredEditMode = suffix === "auto-edit" ? "auto_edit"
    : suffix === "edit" ? "guided_edit"
      : suffix === "transcript" ? "transcript_edit" : null;
  const mode = inferredEditMode ?? project?.continuation?.mode ?? project?.workflowMode;
  const productionMode = project?.productionMode ?? (mode === "cloud_generate" ? "ai" : "local");
  const auxiliaryAi = suffix === "assets" && productionMode === "local" && searchParams.get("workspace") === "ai";
  const auxiliaryCompose = suffix === "video" && (productionMode === "ai" || searchParams.get("entry") === "ai");
  const fromTasks = searchParams.get("from") === "tasks";
  const editLabel = mode === "auto_edit"
    ? (locale === "en" ? "AI smart edit" : "AI 智能成片")
    : mode === "guided_edit"
      ? (locale === "en" ? "Guided editor" : "引导式剪辑")
      : mode === "transcript_edit"
        ? (locale === "en" ? "Transcript editor" : "文字剪辑") : undefined;
  const centerLabel = auxiliaryAi
    ? (locale === "en" ? "AI video helper" : "AI 视频辅助")
    : auxiliaryCompose
      ? (locale === "en" ? "Local compositor" : "本地合成器")
      : suffix === "production"
        ? (locale === "en" ? "Production overview" : "制作概览")
        : editLabel;
  const showStepper = !centerLabel && suffix !== "production";
  const backHref = auxiliaryAi || auxiliaryCompose ? `/project/${id}/assets` : fromTasks ? "/tasks" : "/projects";
  const backLabel = auxiliaryAi || auxiliaryCompose
    ? (locale === "en" ? "Back to assets" : "返回素材")
    : fromTasks ? (locale === "en" ? "Tasks" : "任务") : t("navProjects");

  return <ProjectHeader
    projectName={project?.name ?? ""}
    productionMode={productionMode}
    showStepper={showStepper}
    centerLabel={centerLabel}
    backHref={backHref}
    backLabel={backLabel}
  />;
}
