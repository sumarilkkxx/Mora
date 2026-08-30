import { eq } from "drizzle-orm";
import { join } from "path";
import { getDb } from "@/lib/db";
import { compositions, guidedEditPlans, projects, type mediaSources } from "@/lib/db/schema";
import { getOutputDir } from "@/lib/paths";
import { renderGuidedEdit } from "@/lib/guided-edit-render";
import type { GuidedEditPlanDocument } from "@/lib/guided-edit";
import { probeMedia } from "@/lib/media-probe";
import { extractFirstFrame } from "@/lib/video-composer/frame-extract";

type MediaSourceRow = typeof mediaSources.$inferSelect;
const activeGuidedRenders = new Set<string>();

export function isGuidedRenderActive(planId: string): boolean {
  return activeGuidedRenders.has(planId);
}

export function startGuidedEditRender(input: {
  planId: string;
  compositionId: string;
  revision: number;
  source: MediaSourceRow;
  document: GuidedEditPlanDocument;
}): void {
  if (activeGuidedRenders.has(input.planId)) return;
  activeGuidedRenders.add(input.planId);
  const db = getDb();
  void (async () => {
    const outputPath = join(getOutputDir(), input.source.projectId, `guided-edit-r${input.revision}-${Date.now()}.mp4`);
    try {
      await renderGuidedEdit({
        projectId: input.source.projectId,
        sourcePath: input.source.filePath,
        sourceWidth: input.source.width,
        sourceHeight: input.source.height,
        sourceHasAudio: input.source.hasAudio,
        document: input.document,
        outputPath,
      });
      const [thumbnailPath, outputMetadata] = await Promise.all([
        extractFirstFrame(outputPath),
        probeMedia(outputPath),
      ]);
      await Promise.all([
        db.update(compositions).set({
          outputPath,
          status: "done",
          ...(outputMetadata.duration > 0 && { duration: Math.round(outputMetadata.duration * 1000) }),
          ...(thumbnailPath && { thumbnailPath }),
        }).where(eq(compositions.id, input.compositionId)),
        db.update(guidedEditPlans).set({ status: "done", error: null, updatedAt: new Date() }).where(eq(guidedEditPlans.id, input.planId)),
        db.update(projects).set({ status: "done", productionMode: "local", updatedAt: new Date() }).where(eq(projects.id, input.source.projectId)),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "自动剪辑失败";
      console.error("Guided edit render failed:", error);
      await Promise.all([
        db.update(compositions).set({ status: "failed" }).where(eq(compositions.id, input.compositionId)).catch(() => {}),
        db.update(guidedEditPlans).set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() }).where(eq(guidedEditPlans.id, input.planId)).catch(() => {}),
        db.update(projects).set({ status: "video", updatedAt: new Date() }).where(eq(projects.id, input.source.projectId)).catch(() => {}),
      ]);
    } finally {
      activeGuidedRenders.delete(input.planId);
    }
  })();
}
