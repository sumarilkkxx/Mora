import { desc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, autoEditRuns, compositions, guidedEditPlans, mediaEdits, pipelineRuns, scripts } from "@/lib/db/schema";
import type { ProjectContinuationInput } from "@/lib/project-continuation";

export type ProjectContinuationEvidence = Pick<
  ProjectContinuationInput,
  "hasScript" | "hasAssets" | "latestAutoEditRun" | "latestGuidedPlan" | "latestMediaEdit" | "latestPipelineRun" | "latestComposition"
>;

function latestByProject<T extends { projectId: string }>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) if (!result.has(row.projectId)) result.set(row.projectId, row);
  return result;
}

export async function loadProjectContinuationEvidence(projectIds: string[]): Promise<Map<string, ProjectContinuationEvidence>> {
  const evidence = new Map<string, ProjectContinuationEvidence>();
  if (projectIds.length === 0) return evidence;
  const db = getDb();
  const [autoRows, guidedRows, editRows, pipelineRows, compositionRows, scriptRows, assetRows] = await Promise.all([
    db.select({ projectId: autoEditRuns.projectId, id: autoEditRuns.id, status: autoEditRuns.status, stage: autoEditRuns.stage }).from(autoEditRuns).where(inArray(autoEditRuns.projectId, projectIds)).orderBy(desc(autoEditRuns.createdAt)),
    db.select({ projectId: guidedEditPlans.projectId, id: guidedEditPlans.id, status: guidedEditPlans.status }).from(guidedEditPlans).where(inArray(guidedEditPlans.projectId, projectIds)).orderBy(desc(guidedEditPlans.createdAt)),
    db.select({ projectId: mediaEdits.projectId, id: mediaEdits.id, status: mediaEdits.status }).from(mediaEdits).where(inArray(mediaEdits.projectId, projectIds)).orderBy(desc(mediaEdits.createdAt)),
    db.select({ projectId: pipelineRuns.projectId, id: pipelineRuns.id, status: pipelineRuns.status, stage: pipelineRuns.stage }).from(pipelineRuns).where(inArray(pipelineRuns.projectId, projectIds)).orderBy(desc(pipelineRuns.createdAt)),
    db.select({ projectId: compositions.projectId, id: compositions.id, status: compositions.status, videoOrigin: compositions.videoOrigin }).from(compositions).where(inArray(compositions.projectId, projectIds)).orderBy(desc(compositions.createdAt)),
    db.select({ projectId: scripts.projectId }).from(scripts).where(inArray(scripts.projectId, projectIds)),
    db.select({ projectId: assets.projectId, status: assets.status }).from(assets).where(inArray(assets.projectId, projectIds)),
  ]);

  const latestAuto = latestByProject(autoRows);
  const latestGuided = latestByProject(guidedRows);
  const latestEdit = latestByProject(editRows);
  const latestPipeline = latestByProject(pipelineRows);
  const latestComposition = latestByProject(compositionRows);
  const projectsWithScripts = new Set(scriptRows.map(row => row.projectId));
  const assetStates = new Map<string, string[]>();
  for (const row of assetRows) assetStates.set(row.projectId, [...(assetStates.get(row.projectId) ?? []), row.status]);

  for (const projectId of projectIds) {
    const states = assetStates.get(projectId) ?? [];
    evidence.set(projectId, {
      hasScript: projectsWithScripts.has(projectId),
      hasAssets: states.length > 0 && states.every(status => status === "done"),
      latestAutoEditRun: latestAuto.get(projectId),
      latestGuidedPlan: latestGuided.get(projectId),
      latestMediaEdit: latestEdit.get(projectId),
      latestPipelineRun: latestPipeline.get(projectId),
      latestComposition: latestComposition.get(projectId),
    });
  }
  return evidence;
}
