import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson, digest, SessionStore, type Session, type StoredAttempt } from "./store";
import type { HumanEvaluation } from "../core/contracts";
function isSession(value: unknown): value is Session { return Boolean(value && typeof value === "object" && (value as Session).schemaVersion === 2 && Array.isArray((value as Session).attempts) && (value as Session).configuration && (value as Session).code); }
function counts(attempts: StoredAttempt[]) {
  const passed = attempts.filter(a => a.state === "completed" && a.automatic === "passed").length;
  const failed = attempts.filter(a => a.state === "completed" && a.automatic === "failed").length;
  return { attempts: attempts.length, passed, failed, evaluated: passed + failed, unevaluated: attempts.length - passed - failed, completed: attempts.filter(a => a.state === "completed").length, unknown: attempts.filter(a => a.state === "completed" && a.automatic === "unknown").length, notEvaluated: attempts.filter(a => a.state !== "completed" || a.automatic === "not_evaluated").length };
}
export function summarizeSession(value: unknown, human: HumanEvaluation[] = []) {
  if (!isSession(value)) return { available: false as const, reason: "not recorded", planned: 0, evaluated: 0, unevaluated: 0, failed: 0, completed: 0, human: { reviewed: 0, planned: 0 }, groups: [] };
  const session = value, c = counts(session.attempts);
  const reviewed = new Set(human.filter(h => session.attempts.some(a => a.attemptId === h.attemptId)).map(h => h.attemptId));
  const groups = [...new Set(session.attempts.map(a => `${a.item.expected.behavior ?? "complete"}/${a.evidenceMode}`))].map(key => {
    const [expectedBehavior, evidenceMode] = key.split("/"); const attempts = session.attempts.filter(a => `${a.item.expected.behavior ?? "complete"}/${a.evidenceMode}` === key);
    const metrics = [...new Set(attempts.flatMap(a => a.result?.scores?.map(s => s.name) ?? []))].map(name => {
      const observed = attempts.filter(a => a.state === "completed").flatMap(a => a.result?.scores?.filter(s => s.name === name && s.score !== null) ?? []);
      return { name, passed: observed.filter(s => s.score === 1).length, evaluated: observed.length, planned: attempts.length };
    });
    return { expectedBehavior, evidenceMode, ...counts(attempts), metrics };
  });
  return { available: true as const, planned: c.attempts, ...c, unfinished: session.attempts.filter(a => a.state !== "completed").length, uniqueCases: new Set(session.attempts.map(a => a.caseId)).size, uniqueSources: new Set(session.attempts.map(a => a.item.source.sha256 ?? a.item.source.id)).size, sourceGroups: new Set(session.attempts.map(a => a.item.lineage?.sourceFamily ?? a.item.source.group)).size, human: { reviewed: reviewed.size, planned: c.attempts, unknown: human.filter(h => reviewed.has(h.attemptId) && h.verdict === "unknown").length }, groups };
}
export function compareSessions(currentValue: unknown, referenceValue: unknown) {
  const empty = { available: false, reason: "not recorded", warnings: ["Legacy protocol/attempt identity not recorded"], commonCases: [] as string[], newCases: [] as string[], missingCases: [] as string[], cases: [] as ComparisonCase[] };
  if (!isSession(currentValue) || !isSession(referenceValue)) return empty;
  const current = currentValue, reference = referenceValue;
  const ids = [...new Set(current.attempts.map(a => a.caseId))], refs = [...new Set(reference.attempts.map(a => a.caseId))];
  const commonCases = ids.filter(id => refs.includes(id));
  const warnings: string[] = [];
  for (const field of ["provider", "textModel", "visionModel", "stopLimitUsd", "maxRequestCostUsd", "concurrency", "timeoutMs"] as const) if (current.configuration[field] !== reference.configuration[field]) warnings.push(`Different ${field}: ${reference.configuration[field]} -> ${current.configuration[field]}`);
  if (digest(current.prices) !== digest(reference.prices)) warnings.push("Different price snapshots; costs depend on pricing conditions");
  if (current.selection.seed !== reference.selection.seed) warnings.push("Different execution order seed");
  const cases: ComparisonCase[] = commonCases.map(caseId => {
    const a = current.attempts.filter(a => a.caseId === caseId), b = reference.attempts.filter(a => a.caseId === caseId);
    const ca = counts(a), cb = counts(b), reasons: string[] = [];
    const signature = (attempt: StoredAttempt) => digest({ case: attempt.identity?.case, media: attempt.identity?.media, evaluator: attempt.identity?.evaluator, protocol: attempt.protocol, evidenceMode: attempt.evidenceMode });
    if ([...a, ...b].some(v => !v.identity?.case || !v.identity?.media || !v.identity?.evaluator || !v.protocol || !v.evidenceMode)) reasons.push("not recorded");
    if (new Set([...a, ...b].map(signature)).size !== 1) reasons.push("case/media/evaluator/protocol/evidence mode changed");
    if (current.evaluator !== reference.evaluator) reasons.push("session evaluator changed");
    let classification: ComparisonCase["classification"] = reasons.length ? "not_comparable" : "unchanged";
    if (!reasons.length) {
      if (!ca.evaluated || !cb.evaluated) classification = "unavailable";
      else if (ca.failed && cb.failed) classification = "persistent_failure";
      else if (ca.failed && !cb.failed) classification = cb.unevaluated ? "unavailable" : "new_failure";
      else if (!ca.failed && cb.failed) classification = ca.unevaluated ? "unavailable" : "recovered";
    }
    return { caseId, compatible: !reasons.length, reasons, classification, current: ca, reference: cb, currentAttemptIds: a.map(a => a.attemptId), referenceAttemptIds: b.map(a => a.attemptId) };
  });
  return { available: true, warnings, commonCases, newCases: ids.filter(id => !refs.includes(id)), missingCases: refs.filter(id => !ids.includes(id)), cases, agentCodeChanged: current.code.fingerprint !== reference.code.fingerprint, interpretation: "Observed attempts only. Repetitions are retained; a new failure is not a claim of stable degradation." };
}
interface ComparisonCase { caseId: string; compatible: boolean; reasons: string[]; classification: "new_failure" | "recovered" | "persistent_failure" | "unchanged" | "unavailable" | "not_comparable"; current: ReturnType<typeof counts>; reference: ReturnType<typeof counts>; currentAttemptIds: string[]; referenceAttemptIds: string[] }
export function protocolSnapshot(value: unknown) {
  if (!isSession(value)) return { available: false as const, reason: "not recorded" };
  return { available: true as const, sessionId: value.sessionId, selection: structuredClone(value.selection), configuration: structuredClone(value.configuration), prices: structuredClone(value.prices), datasetVersion: value.datasetVersion, protocolVersion: value.protocolVersion, code: structuredClone(value.code), evaluator: value.evaluator, cases: value.attempts.map(a => ({ caseId: a.caseId, repetition: a.repetition, attemptId: a.attemptId, identity: structuredClone(a.identity), protocol: structuredClone(a.protocol), evidenceMode: a.evidenceMode })) };
}
interface ReferenceChoice { selectedAt: string; referenceSessionId: string; current: ReturnType<typeof protocolSnapshot>; reference: ReturnType<typeof protocolSnapshot> }
export class ComparisonService {
  constructor(readonly store: SessionStore, private readonly legacy?: (id: string) => Promise<unknown>) {}
  private async read(id: string): Promise<unknown> { try { return this.store.get(id); } catch (error) { if (!this.legacy || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return this.legacy(id); } }
  reference(id: string): { current?: ReferenceChoice; history: ReferenceChoice[] } { const path = join(this.store.directory(id), "reference.json"); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { history: [] }; }
  async choose(id: string, referenceSessionId: string) {
    if (id === referenceSessionId) throw new Error("A session cannot reference itself");
    this.store.directory(referenceSessionId);
    const [current, reference] = await Promise.all([this.read(id), this.read(referenceSessionId)]);
    const choice: ReferenceChoice = { selectedAt: new Date().toISOString(), referenceSessionId, current: protocolSnapshot(current), reference: protocolSnapshot(reference) };
    const existing = this.reference(id), history = [...existing.history, choice];
    mkdirSync(this.store.directory(id), { recursive: true });
    atomicJson(join(this.store.directory(id), "reference.json"), { current: choice, history });
    return choice;
  }
  async report(id: string, human: HumanEvaluation[] = [], sessionReviews: unknown[] = []) {
    const current = await this.read(id), choice = this.reference(id).current;
    const reference = choice ? await this.read(choice.referenceSessionId) : undefined;
    const legacy = !isSession(current);
    const applicableHuman = human.filter(h => h.referenceSessionId === choice?.referenceSessionId);
    const reviewContext = human.map(h => ({ attemptId: h.attemptId, referenceSessionId: h.referenceSessionId ?? null, applicableToSelectedReference: h.referenceSessionId === choice?.referenceSessionId }));
    const budget = legacy ? { available: false, reason: "not recorded" } : this.store.budget(id);
    const session = legacy ? undefined : current;
    const cost = session?.attempts.map(a => ({ attemptId: a.attemptId, recordedUsd: a.result?.trace?.modelCalls.reduce((total, call) => total + (call.costUsd ?? 0), 0) ?? null, unavailableUsageCalls: a.result?.trace?.modelCalls.filter(call => call.costStatus !== "recorded").length ?? null, elapsedMs: a.startedAt && a.completedAt ? Math.max(0, Date.parse(a.completedAt) - Date.parse(a.startedAt)) : null }));
    const report = { schemaVersion: 2, sessionId: id, generatedAt: new Date().toISOString(), overview: summarizeSession(current, applicableHuman), protocol: protocolSnapshot(current), reference: choice ?? null, comparison: choice ? compareSessions(current, reference) : null, budget, costsAndTime: cost ?? "not recorded", sessionElapsedMs: session?.completedAt ? Math.max(0, Date.parse(session.completedAt) - Date.parse(session.startedAt)) : null, attempts: session?.attempts ?? "not recorded", human, sessionReviews, reviewContext, limitations: ["Development observations; related cases are not independent generalization samples", "Human judgements are optional and independent of automatic facts", "fixed_response: runner logic with controlled boundaries; unverified media remains unknown", "real_media: controlled renderer/media constraints; synthetic voice is not TTS/model ability", "real_model: configured model transport; current remote pricing adapter supports only OpenRouter", "No combined technical/content/cost score"] };
    const directory = join(this.store.directory(id), "reports"); mkdirSync(directory, { recursive: true });
    atomicJson(join(directory, `${randomUUID()}.json`), report);
    return report;
  }
}
