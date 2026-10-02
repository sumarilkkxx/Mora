import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { choice, nonempty, record, type HumanEvaluation } from "../core/contracts";
import { bounded } from "./selection";
import { atomicJson, SessionStore } from "./store";
import { ComparisonService } from "./comparison";
export interface SavedReview extends Omit<HumanEvaluation, "attemptId"> { sessionId: string; scope: "session" | "attempt"; attemptId?: string; referenceSessionId?: string; referenceSelectedAt?: string }
interface Reviews { current: SavedReview[]; history: SavedReview[] }
const FIELDS = new Set(["scope", "attemptId", "verdict", "labels", "severity", "atSeconds", "note"]);
export class ReviewStore {
  constructor(readonly store: SessionStore) {}
  private read(id: string): Reviews { const session = this.store.get(id); if (session.schemaVersion !== 2 || !Array.isArray(session.attempts)) return { current: [], history: [] }; const path = join(this.store.directory(id), "human-reviews.json"); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { current: [], history: [] }; }
  list(id: string) { return structuredClone(this.read(id).current); }
  history(id: string) { return structuredClone(this.read(id).history); }
  attemptReviews(id: string): HumanEvaluation[] {
    try { return this.list(id).filter((review): review is SavedReview & { attemptId: string } => review.scope === "attempt" && typeof review.attemptId === "string"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  save(id: string, value: unknown) {
    const session = this.store.get(id), input = record(value, "review");
    if (session.schemaVersion !== 2 || !Array.isArray(session.attempts)) throw new Error("Legacy attempt identity not recorded");
    if (Object.keys(input).some(key => !FIELDS.has(key))) throw new Error("Review accepts only whitelisted fields; credentials are not accepted");
    const scope = choice(input.scope ?? "attempt", ["session", "attempt"], "review scope");
    const attemptId = scope === "attempt" ? nonempty(input.attemptId, "attemptId") : undefined;
    const attempt = attemptId ? session.attempts.find(a => a.attemptId === attemptId) : undefined;
    if (attemptId && !attempt) throw new Error("Attempt does not belong to this session");
    if (scope === "session" && input.attemptId !== undefined) throw new Error("Session review cannot carry an attempt ID");
    const reference = new ComparisonService(this.store).reference(id).current;
    const verdict = choice(input.verdict, reference ? ["better", "same", "worse", "unknown"] as const : ["usable", "needs_changes", "unusable", "unknown"] as const, "review verdict");
    if (!Array.isArray(input.labels)) throw new Error("Review labels must be an array");
    const labels = [...new Set(input.labels.map(value => choice(value, ["requirements", "facts", "editing_audio", "captions_copy"] as const, "issue label")))];
    if (["worse", "needs_changes", "unusable"].includes(verdict) && !labels.length) throw new Error("Negative review requires at least one issue label");
    const severity = input.severity === undefined ? undefined : choice(input.severity, ["blocking", "improvement"], "severity");
    if (severity && !labels.length) throw new Error("Severity requires an issue label");
    const atSeconds = input.atSeconds === undefined ? undefined : bounded(input.atSeconds, 0, 3600, "atSeconds");
    if (atSeconds !== undefined && scope === "session") throw new Error("Time point requires an attempt");
    const evidence = attempt?.result?.evidence;
    const media = evidence && typeof evidence === "object" ? evidence as { duration?: number; output?: { duration?: number } } : undefined;
    const duration = media?.output?.duration ?? media?.duration;
    if (atSeconds !== undefined && typeof duration === "number" && atSeconds > duration) throw new Error("Time point exceeds observed output duration");
    let note: string | undefined;
    if (input.note !== undefined) {
      if (typeof input.note !== "string" || input.note.length > 2000) throw new Error("Review note must be at most 2000 characters");
      if (/\bsk-(?:or-)?[a-z0-9_-]{8,}|\bBearer\s+\S+|(?:api.?key|password|authorization)\s*[:=]\s*\S+/i.test(input.note)) throw new Error("Review note must not contain credentials");
      note = input.note.trim() || undefined;
    }
    const review: SavedReview = { sessionId: id, scope, verdict, labels, updatedAt: new Date().toISOString(), ...(attemptId ? { attemptId } : {}), ...(reference ? { referenceSessionId: reference.referenceSessionId, referenceSelectedAt: reference.selectedAt } : {}), ...(severity ? { severity } : {}), ...(atSeconds === undefined ? {} : { atSeconds }), ...(note ? { note } : {}) };
    const data = this.read(id);
    const current = data.current.filter(r => !(r.scope === scope && r.attemptId === attemptId));
    current.push(review);
    atomicJson(join(this.store.directory(id), "human-reviews.json"), { current, history: [...data.history, review] });
    return review;
  }
}
