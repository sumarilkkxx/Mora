import { createHash, randomUUID } from "node:crypto";
import { openSync, closeSync, fsyncSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentEvaluationCase, EvaluationTrace, ModelPrice } from "../core/types";
import type { AttemptRecord } from "../core/contracts";
import type { PersistentBudget } from "../core/cost-ledger";
import type { CaseProtocol } from "../regression-dataset";
import type { RunConfiguration, Selection } from "./selection";
export interface AttemptResult { automatic: AttemptRecord["automatic"]; trace?: EvaluationTrace; scores?: Array<{ name: string; score: number | null; detail?: string }>; evidence?: unknown; outputPath?: string; reason?: string }
export interface StoredAttempt extends AttemptRecord { item: AgentEvaluationCase; protocol: CaseProtocol; result?: AttemptResult; startedAt?: string; completedAt?: string }
export interface Session {
  schemaVersion: 2; sessionId: string; owner: string; startedAt: string; completedAt?: string;
  state: "created" | "running" | "cancel_requested" | "completed" | "cancelled" | "budget_stopped" | "interrupted" | "preflight_failed";
  selection: Selection; configuration: RunConfiguration; datasetVersion: string; protocolVersion: string;
  code: { head: string; dirty: boolean; fingerprint: string }; evaluator: string;
  prices: Record<string, ModelPrice>; attempts: StoredAttempt[]; previousSessionId?: string; reason?: string;
}
export function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  const file = openSync(temporary, "r"); try { fsyncSync(file); } finally { closeSync(file); }
  renameSync(temporary, path);
  const parent = openSync(dirname(path), "r"); try { fsyncSync(parent); } finally { closeSync(parent); }
}
export class SessionStore {
  constructor(readonly root: string) { mkdirSync(root, { recursive: true }); }
  directory(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid session ID"); return join(this.root, id); }
  get(id: string): Session { return JSON.parse(readFileSync(join(this.directory(id), "session.json"), "utf8")); }
  save(session: Session) { const dir = this.directory(session.sessionId); mkdirSync(dir, { recursive: true }); atomicJson(join(dir, "session.json"), session); }
  list(): Session[] { return readdirSync(this.root).filter(id => /^[a-f0-9-]{36}$/.test(id) && existsSync(join(this.root, id, "session.json"))).map(id => this.get(id)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  budget(id: string): PersistentBudget { const path = join(this.directory(id), "budget.json"); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { spentUsd: 0, reservations: {}, uncertain: {} }; }
  saveBudget(id: string, budget: PersistentBudget) { atomicJson(join(this.directory(id), "budget.json"), budget); }
  owns(session: Session) { return this.get(session.sessionId).owner === session.owner; }
}
