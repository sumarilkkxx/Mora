import { and, eq } from "drizzle-orm";
import { join } from "path";
import { rm } from "fs/promises";
import { getDb } from "@/lib/db";
import { compositions, guidedEditPlans, projects, type mediaSources } from "@/lib/db/schema";
import { getOutputDir } from "@/lib/paths";
import { renderGuidedEdit } from "@/lib/guided-edit-render";
import type { GuidedEditPlanDocument } from "@/lib/guided-edit";
import { probeMedia } from "@/lib/media-probe";
import { MediaRuntimeError } from "@/lib/media-runtime";
import { extractFirstFrame } from "@/lib/video-composer/frame-extract";

type MediaSourceRow = typeof mediaSources.$inferSelect;
type GuidedRenderRuntime = {
  controllers: Map<string, AbortController>;
  completions: Map<string, Promise<void>>;
};
const processState = globalThis as typeof globalThis & { moraGuidedRender?: GuidedRenderRuntime };
const runtime: GuidedRenderRuntime = processState.moraGuidedRender ??= { controllers: new Map(), completions: new Map() };
runtime.completions ??= new Map();

export function isGuidedRenderActive(planId: string): boolean {
  return runtime.controllers.has(planId);
}

export async function cancelGuidedEditRender(planId: string, projectId: string): Promise<boolean> {
  const db = getDb();
  const plan = db.select().from(guidedEditPlans).where(and(eq(guidedEditPlans.id, planId), eq(guidedEditPlans.projectId, projectId))).get();
  if (!plan || plan.status !== "rendering") return false;
  runtime.controllers.get(planId)?.abort(new Error("cancelled"));
  await Promise.all([
    db.update(guidedEditPlans).set({ status: "cancelled", error: null, updatedAt: new Date() }).where(and(eq(guidedEditPlans.id, planId), eq(guidedEditPlans.status, "rendering"))),
    plan.compositionId ? db.update(compositions).set({ status: "failed", renderOwner: null, renderHeartbeat: null }).where(eq(compositions.id, plan.compositionId)) : Promise.resolve(),
    db.update(projects).set({ status: "video", updatedAt: new Date() }).where(eq(projects.id, projectId)),
  ]);
  await runtime.completions.get(planId);
  return true;
}

export function startGuidedEditRender(input: {
  planId: string;
  compositionId: string;
  revision: number;
  source: MediaSourceRow;
  document: GuidedEditPlanDocument;
}): void {
  if (runtime.controllers.has(input.planId)) return;
  const controller = new AbortController();
  runtime.controllers.set(input.planId, controller);
  const db = getDb();
  const completion = (async () => {
    const outputPath = join(getOutputDir(), input.source.projectId, `guided-edit-r${input.revision}-${Date.now()}.mp4`);
    const heartbeat = setInterval(() => {
      void db.update(compositions).set({ renderHeartbeat: Math.floor(Date.now() / 1000) })
        .where(and(eq(compositions.id, input.compositionId), eq(compositions.status, "composing")))
        .catch(() => controller.abort());
    }, 5_000);
    try {
      await renderGuidedEdit({
        projectId: input.source.projectId,
        sourcePath: input.source.filePath,
        sourceWidth: input.source.width,
        sourceHeight: input.source.height,
        sourceHasAudio: input.source.hasAudio,
        document: input.document,
        outputPath,
        signal: controller.signal,
      });
      const [thumbnailPath, outputMetadata] = await Promise.all([
        extractFirstFrame(outputPath),
        probeMedia(outputPath, { signal: controller.signal }),
      ]);
      controller.signal.throwIfAborted();
      await Promise.all([
        db.update(compositions).set({
          outputPath,
          status: "done",
          completedAt: new Date(),
          renderOwner: null,
          renderHeartbeat: null,
          ...(outputMetadata.duration > 0 && { duration: Math.round(outputMetadata.duration * 1000) }),
          ...(thumbnailPath && { thumbnailPath }),
        }).where(eq(compositions.id, input.compositionId)),
        db.update(guidedEditPlans).set({ status: "done", error: null, updatedAt: new Date() }).where(and(eq(guidedEditPlans.id, input.planId), eq(guidedEditPlans.status, "rendering"))),
        db.update(projects).set({ status: "done", productionMode: "local", updatedAt: new Date() }).where(eq(projects.id, input.source.projectId)),
      ]);
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof MediaRuntimeError && error.code === "cancelled");
      const message = error instanceof Error ? error.message : "自动剪辑失败";
      if (!cancelled) console.error("Guided edit render failed:", error);
      if (cancelled) await rm(outputPath, { force: true }).catch(() => {});
      await Promise.all([
        db.update(compositions).set({ status: "failed", renderOwner: null, renderHeartbeat: null }).where(eq(compositions.id, input.compositionId)).catch(() => {}),
        db.update(guidedEditPlans).set({ status: cancelled ? "cancelled" : "failed", error: cancelled ? null : message.slice(0, 500), updatedAt: new Date() }).where(eq(guidedEditPlans.id, input.planId)).catch(() => {}),
        db.update(projects).set({ status: "video", updatedAt: new Date() }).where(eq(projects.id, input.source.projectId)).catch(() => {}),
      ]);
    } finally {
      clearInterval(heartbeat);
      runtime.controllers.delete(input.planId);
    }
  })();
  runtime.completions.set(input.planId, completion);
  void completion.catch(() => {}).finally(() => runtime.completions.delete(input.planId));
}
