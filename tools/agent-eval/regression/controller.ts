import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CostLedger, EvaluationBudgetError } from "../core/cost-ledger";
import { caseFingerprints } from "../core/contracts";
import { redactEvaluationValue } from "../core/trace";
import type { ModelPrice } from "../core/types";
import { loadRegressionDataset } from "../regression-dataset";
import { parseRunConfiguration, selectRegressionCases, type RegressionData, type RunConfiguration } from "./selection";
import { SessionStore, type AttemptResult, type Session, type StoredAttempt } from "./store";
export interface Runtime { baseUrl: string; prices: Record<string, ModelPrice> }
export interface ExecutionContext { session: Session; attempt: StoredAttempt; directory: string; ledger: CostLedger; signal: AbortSignal; apiKey: string; runtime: Runtime }
export interface ControllerDependencies {
  load?: () => Promise<RegressionData>;
  identity: () => Promise<{ code: Session["code"]; evaluator: string }>;
  preflight: (config: RunConfiguration, apiKey: string) => Promise<Runtime>;
  execute: (context: ExecutionContext) => Promise<AttemptResult>;
}
const unfinished = (a: StoredAttempt) => a.state !== "completed";
const now = () => new Date().toISOString();
export class RegressionController {
  private active = new Map<string, { session: Session; abort: AbortController; ledger: CostLedger; done: Promise<void> }>();
  constructor(readonly store: SessionStore, private readonly deps: ControllerDependencies) { this.recover(); }
  recover() {
    for (const session of this.store.list()) if (["created", "running", "cancel_requested"].includes(session.state)) {
      session.owner = randomUUID(); session.state = "interrupted"; session.reason = "Service restarted; explicit continuation required"; session.completedAt = now();
      for (const a of session.attempts) if (unfinished(a)) { a.state = "interrupted"; a.automatic = "not_evaluated"; a.reason = session.reason; a.completedAt = now(); }
      this.store.save(session);
      const ledger = new CostLedger(session.configuration.stopLimitUsd, session.configuration.stopLimitUsd, { initial: this.store.budget(session.sessionId) });
      for (const id of Object.keys(ledger.persistentSnapshot().reservations)) ledger.markUnknown(id, "Interrupted request has unknown billing");
      this.store.saveBudget(session.sessionId, ledger.persistentSnapshot());
    }
  }
  historicalFailures() { return [...new Set(this.store.list().flatMap(s => s.attempts.filter(a => a.automatic === "failed").map(a => a.caseId)))]; }
  async preview(selection: unknown) {
    const data = await (this.deps.load ?? loadRegressionDataset)();
    const selected = selectRegressionCases(data, selection, this.historicalFailures());
    return { ...selected, caseCount: selected.caseIds.length, attemptCount: Object.values(selected.repetitions).reduce((a, b) => a + b, 0), cases: selected.caseIds.map(id => { const c = data.dataset.cases.find(c => c.caseId === id)!; return { caseId: id, category: c.category, tags: c.tags, expectedBehavior: c.expected.behavior, evidenceMode: c.evidenceMode, protocol: data.protocols.cases.find(p => p.caseId === id) }; }) };
  }
  status(id: string) {
    const session = this.store.get(id), ledger = new CostLedger(session.configuration.stopLimitUsd, session.configuration.stopLimitUsd, { initial: this.store.budget(id) });
    return { ...session, complete: !["created", "running", "cancel_requested"].includes(session.state), budget: ledger.snapshot() };
  }
  async start(selection: unknown, configuration: unknown, apiKey = "", previousSessionId?: string): Promise<ReturnType<RegressionController["status"]>> {
    const config = parseRunConfiguration(configuration), data = await (this.deps.load ?? loadRegressionDataset)();
    const selected = selectRegressionCases(data, selection, this.historicalFailures());
    const versions = await this.deps.identity();
    const previous = previousSessionId ? this.store.get(previousSessionId) : undefined;
    if (previous && ["created", "running", "cancel_requested"].includes(previous.state)) throw new Error("Cancel or finish the previous run before continuation");
    const pending = previous?.attempts.filter(unfinished);
    if (pending && !pending.length) throw new Error("No unfinished attempts to continue");
    const sessionId = randomUUID();
    const attempts: StoredAttempt[] = selected.caseIds.flatMap(caseId => {
      const item = data.dataset.cases.find(c => c.caseId === caseId)!, protocol = data.protocols.cases.find(p => p.caseId === caseId)!;
      const identity = caseFingerprints(item, { agent: versions.code.fingerprint, evaluator: versions.evaluator });
      const originals = pending?.filter(a => a.caseId === caseId);
      if (originals?.some(a => a.identity.case !== identity.case || a.identity.media !== identity.media || JSON.stringify(a.protocol) !== JSON.stringify(protocol))) throw new Error("Continuation case/media/protocol changed; start a new targeted run");
      const indices = originals?.map(a => a.repetition) ?? Array.from({ length: selected.repetitions[caseId] }, (_, i) => i + 1);
      return indices.map(repetition => ({ schemaVersion: 2, sessionId, attemptId: randomUUID(), caseId, repetition, state: "not_started", automatic: "not_evaluated", evidenceMode: item.evidenceMode!, identity, item: structuredClone(item), protocol: structuredClone(protocol), ...(originals ? { previousAttemptId: originals.find(a => a.repetition === repetition)!.attemptId } : {}) }));
    });
    const session: Session = { schemaVersion: 2, sessionId, owner: randomUUID(), state: "created", startedAt: now(), selection: selected, configuration: config, datasetVersion: data.dataset.version, protocolVersion: data.protocols.version, ...versions, prices: {}, attempts, ...(previousSessionId ? { previousSessionId } : {}) };
    this.store.save(session);
    const ledger = new CostLedger(config.stopLimitUsd, config.stopLimitUsd, { onChange: budget => { if (this.store.owns(session)) this.store.saveBudget(sessionId, budget); } });
    this.store.saveBudget(sessionId, ledger.persistentSnapshot());
    const abort = new AbortController();
    const done = this.run(session, ledger, abort, apiKey);
    this.active.set(sessionId, { session, ledger, abort, done });
    void done.then(() => this.active.delete(sessionId), () => this.active.delete(sessionId));
    return this.status(sessionId);
  }
  continue(id: string, configuration: unknown, apiKey = "") {
    const s = this.store.get(id), pending = s.attempts.filter(unfinished);
    return this.start({ mode: "targeted", caseIds: [...new Set(pending.map(a => a.caseId))], seed: s.selection.seed, repetitions: Object.fromEntries([...new Set(pending.map(a => a.caseId))].map(id => [id, pending.filter(a => a.caseId === id).length])) }, configuration, apiKey, id);
  }
  cancel(id: string) {
    const running = this.active.get(id);
    if (running) { running.session.state = "cancel_requested"; running.abort.abort(new Error("Cancelled by user")); this.persist(running.session); }
    return this.status(id);
  }
  async wait(id: string) { await this.active.get(id)?.done; return this.status(id); }
  private persist(session: Session) { if (this.store.owns(session)) this.store.save(session); }
  private async run(session: Session, ledger: CostLedger, abort: AbortController, apiKey: string) {
    try {
      const needsModel = session.attempts.some(a => a.evidenceMode === "real_model");
      let preflightTimer: ReturnType<typeof setTimeout> | undefined;
      const stopped = needsModel ? new Promise<never>((_, reject) => {
        abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true });
        preflightTimer = setTimeout(() => abort.abort(new Error("Preflight timed out")), Math.min(session.configuration.timeoutMs, 30000));
      }) : undefined;
      let runtime: Runtime;
      try { runtime = needsModel ? await Promise.race([this.deps.preflight(session.configuration, apiKey), stopped!]) : { baseUrl: "", prices: {} }; }
      finally { clearTimeout(preflightTimer); }

      if (!this.store.owns(session)) return;
      session.prices = runtime.prices;
      if (!abort.signal.aborted) { session.state = "running"; this.persist(session); }
      let cursor = 0;
      const worker = async () => {
        while (!abort.signal.aborted && !ledger.snapshot().locked && this.store.owns(session)) {
          const a = session.attempts[cursor++]; if (!a) return;
          a.state = "running"; a.startedAt = now(); this.persist(session);
          const directory = join(this.store.directory(session.sessionId), a.attemptId); mkdirSync(directory, { recursive: true });
          const attemptAbort = new AbortController();
          const stop = () => attemptAbort.abort(abort.signal.reason);
          abort.signal.addEventListener("abort", stop, { once: true });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const stopped = new Promise<never>((_, reject) => {
              attemptAbort.signal.addEventListener("abort", () => reject(attemptAbort.signal.reason), { once: true });
              timer = setTimeout(() => attemptAbort.abort(new Error("Attempt timed out; explicit continuation required")), session.configuration.timeoutMs);
            });
            const result = await Promise.race([this.deps.execute({ session, attempt: a, directory, ledger, signal: attemptAbort.signal, apiKey, runtime }), stopped]);
            a.result = redactEvaluationValue(result, [apiKey]) as AttemptResult;
            const expectedBudgetStop = a.item.expected.behavior === "stop" && a.item.expected.reasonCodes?.includes("budget_exhausted");
            if (result.trace?.outcome?.reasonCode === "budget_exhausted" && !expectedBudgetStop) {
              a.result.automatic = "not_evaluated";
              throw new EvaluationBudgetError("Actual runner stopped at the request/invocation budget; explicit continuation required");
            }
            if (["cancelled", "interrupted"].includes(result.trace?.outcome?.state ?? "")) {
              a.result.automatic = "not_evaluated";
              throw new Error("Actual runner was interrupted; explicit continuation required");
            }
            a.automatic = result.automatic; a.state = "completed";
          } catch (error) {
            a.reason = String(redactEvaluationValue(error instanceof Error ? error.message : String(error), [apiKey]));
            if (session.state !== "cancel_requested" && (error instanceof EvaluationBudgetError || ledger.snapshot().locked)) { session.state = "budget_stopped"; ledger.lock(a.reason); abort.abort(error); }
            a.state = session.state === "budget_stopped" ? "budget_stopped" : abort.signal.aborted ? "cancelled" : "interrupted";
            a.automatic = "not_evaluated";
          } finally { clearTimeout(timer); abort.signal.removeEventListener("abort", stop); a.completedAt = now(); this.persist(session); }
          if (ledger.snapshot().locked && !abort.signal.aborted) { session.state = "budget_stopped"; abort.abort(new EvaluationBudgetError("Budget locked")); }
        }
      };
      await Promise.all(Array.from({ length: session.configuration.concurrency }, worker));
      if (session.state === "running") session.state = session.attempts.some(a => a.state === "interrupted") ? "interrupted" : "completed";
    } catch (error) {
      if (session.state !== "cancel_requested") session.state = "preflight_failed";
      session.reason = String(redactEvaluationValue(error instanceof Error ? error.message : String(error), [apiKey]));
    } finally {
      if (!this.store.owns(session)) return;
      if (session.state === "cancel_requested") session.state = "cancelled";
      for (const id of Object.keys(ledger.persistentSnapshot().reservations)) ledger.markUnknown(id, "Unsettled request at terminal session");
      for (const a of session.attempts) if (["not_started", "running"].includes(a.state)) { a.state = session.state === "cancelled" ? "cancelled" : session.state === "budget_stopped" ? "budget_stopped" : "interrupted"; a.automatic = "not_evaluated"; a.completedAt = now(); a.reason = session.reason ?? session.state; }
      session.completedAt = now(); this.persist(session);
    }
  }
}
