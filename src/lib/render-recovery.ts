import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const state = globalThis as typeof globalThis & { moraRenderOwner?: string; moraRenderTimers?: Map<string, ReturnType<typeof setInterval>> };
export const renderOwner = state.moraRenderOwner ??= `${process.pid}:${randomUUID()}`;

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

/** Recover only abandoned executors, regardless of when the render was submitted. */
export function recoverRenders(sqlite: Database.Database, now = Math.floor(Date.now() / 1000), alive = processAlive): number {
  return sqlite.transaction(() => {
    const rows = sqlite.prepare("SELECT id, project_id, render_owner, render_heartbeat FROM compositions WHERE status IN ('composing', 'pending')").all() as Array<{ id: string; project_id: string; render_owner: string | null; render_heartbeat: number | null }>;
    let recovered = 0;
    for (const row of rows) {
      const pid = Number(row.render_owner?.split(":")[0]);
      const abandoned = !row.render_owner || !Number.isInteger(pid) || pid <= 0 ||
        (pid === process.pid && row.render_owner !== renderOwner) || !alive(pid) ||
        (row.render_heartbeat ?? 0) < now - 60;
      if (!abandoned) continue;
      const message = "应用在渲染过程中退出，请重新开始渲染";
      for (const table of ["guided_edit_plans", "media_edits"]) {
        sqlite.prepare(`UPDATE ${table} SET status = 'failed', error = COALESCE(error, ?), updated_at = ? WHERE status = 'rendering' AND composition_id = ?`).run(message, now, row.id);
      }
      recovered += sqlite.prepare("UPDATE compositions SET status = 'failed' WHERE id = ? AND status IN ('composing', 'pending')").run(row.id).changes;
      sqlite.prepare(`UPDATE projects SET status = 'video', updated_at = ? WHERE id = ? AND status = 'composing'
        AND NOT EXISTS (SELECT 1 FROM compositions WHERE project_id = ? AND status IN ('composing', 'pending'))`).run(now, row.project_id, row.project_id);
    }
    return recovered;
  })();
}

export function startRenderRecovery(sqlite: Database.Database, dbPath: string) {
  recoverRenders(sqlite);
  const timers = state.moraRenderTimers ??= new Map();
  const oldTimer = timers.get(dbPath);
  if (oldTimer) clearInterval(oldTimer);
  const timer = setInterval(() => {
    try {
      // Refresh this process first: a delayed event loop must not invalidate its own work.
      sqlite.prepare("UPDATE compositions SET render_heartbeat = unixepoch() WHERE render_owner = ? AND status IN ('composing', 'pending')").run(renderOwner);
      recoverRenders(sqlite);
    } catch (error) { console.warn("Render recovery failed:", error); }
  }, 10000);
  timer.unref();
  timers.set(dbPath, timer);
}
