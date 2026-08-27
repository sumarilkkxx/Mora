import { eq } from "drizzle-orm";
import { join } from "path";
import { getDb } from "@/lib/db";
import { compositions, mediaEdits, projects, type mediaSources } from "@/lib/db/schema";
import { getOutputDir } from "@/lib/paths";
import { renderTranscriptEdit } from "@/lib/transcript-render";
import type { TimeRange, TranscriptDocument, TranscriptEditPlan } from "@/lib/transcript-editor";
import { extractFirstFrame } from "@/lib/video-composer/frame-extract";

type MediaSourceRow = typeof mediaSources.$inferSelect;
const activeRenders = new Set<string>();

export function isTranscriptRenderActive(editId: string): boolean {
  return activeRenders.has(editId);
}

export function startTranscriptRender(input: {
  editId: string;
  compositionId: string;
  revision: number;
  source: MediaSourceRow;
  transcript: TranscriptDocument;
  plan: TranscriptEditPlan;
  keepRanges: TimeRange[];
}): void {
  if (activeRenders.has(input.editId)) return;
  activeRenders.add(input.editId);
  const db = getDb();
  void (async () => {
    const outputPath = join(getOutputDir(), input.source.projectId, `text-edit-r${input.revision}-${Date.now()}.mp4`);
    try {
      await renderTranscriptEdit({
        projectId: input.source.projectId,
        sourcePath: input.source.filePath,
        sourceWidth: input.source.width,
        sourceHeight: input.source.height,
        hasAudio: input.source.hasAudio,
        transcript: input.transcript,
        plan: input.plan,
        keepRanges: input.keepRanges,
        outputPath,
      });
      const thumbnailPath = await extractFirstFrame(outputPath);
      await db.update(compositions).set({ outputPath, status: "done", ...(thumbnailPath && { thumbnailPath }) }).where(eq(compositions.id, input.compositionId));
      await db.update(mediaEdits).set({ status: "done", error: null, updatedAt: new Date() }).where(eq(mediaEdits.id, input.editId));
      await db.update(projects).set({ status: "done", updatedAt: new Date() }).where(eq(projects.id, input.source.projectId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "文字剪辑失败";
      console.error("Transcript render failed:", error);
      await Promise.all([
        db.update(compositions).set({ status: "failed" }).where(eq(compositions.id, input.compositionId)).catch(() => {}),
        db.update(mediaEdits).set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() }).where(eq(mediaEdits.id, input.editId)).catch(() => {}),
      ]);
    } finally {
      activeRenders.delete(input.editId);
    }
  })();
}
