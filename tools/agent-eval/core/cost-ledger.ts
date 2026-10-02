import type { ModelPrice, ModelTokenUsage } from "./types";

const roundUsd = (value: number) => Math.round(value * 1_000_000_000) / 1_000_000_000;

export const DEFAULT_EVALUATION_STOP_LIMIT_USD = 6;
export const DEFAULT_EVALUATION_ABSOLUTE_LIMIT_USD = 7;

function nonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
  return value;
}

export class EvaluationBudgetError extends Error {
  readonly code = "budget_exhausted";
  constructor(message: string) {
    super(message);
    this.name = "EvaluationBudgetError";
  }
}

export function calculateModelCost(usage: ModelTokenUsage, price: ModelPrice) {
  const cached = Math.min(nonNegative(usage.cachedPromptTokens, "cachedPromptTokens"), nonNegative(usage.promptTokens, "promptTokens"));
  const uncached = usage.promptTokens - cached;
  const cachedRate = price.cachedInputUsdPerMillionTokens ?? price.inputUsdPerMillionTokens;
  return roundUsd((uncached * price.inputUsdPerMillionTokens + cached * cachedRate + nonNegative(usage.completionTokens, "completionTokens") * price.outputUsdPerMillionTokens) / 1_000_000);
}

export interface PersistentBudget { spentUsd: number; reservations: Record<string, number>; uncertain: Record<string, number>; lockReason?: string }

export class CostLedger {
  private spentUsd = 0;
  private readonly reservations = new Map<string, number>();
  private lockReason?: string;
  private readonly uncertain = new Map<string, number>();

  constructor(readonly stopLimitUsd = DEFAULT_EVALUATION_STOP_LIMIT_USD, readonly absoluteLimitUsd = DEFAULT_EVALUATION_ABSOLUTE_LIMIT_USD, private readonly options: { initial?: PersistentBudget; onChange?: (budget: PersistentBudget) => void } = {}) {
    nonNegative(stopLimitUsd, "stopLimitUsd");
    nonNegative(absoluteLimitUsd, "absoluteLimitUsd");
    if (stopLimitUsd > absoluteLimitUsd) throw new Error("stopLimitUsd must not exceed absoluteLimitUsd");
    if (options.initial) {
      this.spentUsd = nonNegative(options.initial.spentUsd, "spentUsd");
      for (const [id, cost] of Object.entries(options.initial.reservations)) this.reservations.set(id, nonNegative(cost, "reservation"));
      for (const [id, cost] of Object.entries(options.initial.uncertain)) this.uncertain.set(id, nonNegative(cost, "uncertain"));
      this.lockReason = options.initial.lockReason;
    }
  }

  assertCanStart(reservedCostUsd: number) {
    nonNegative(reservedCostUsd, "reservedCostUsd");
    if (this.lockReason) throw new EvaluationBudgetError(`Agent evaluation budget is locked: ${this.lockReason}`);
    if (this.spentUsd + this.reservedUsd() + this.uncertainUsd() + reservedCostUsd > this.stopLimitUsd) {
      throw new EvaluationBudgetError(`Agent evaluation request would exceed the $${this.stopLimitUsd.toFixed(2)} stop limit`);
    }
  }

  reserve(id: string, reservedCostUsd: number) {
    if (!id || this.reservations.has(id)) throw new Error("budget reservation ID must be unique");
    this.assertCanStart(reservedCostUsd);
    this.reservations.set(id, nonNegative(reservedCostUsd, "reservedCostUsd"));
    this.changed();
  }

  release(id: string) {
    this.reservations.delete(id);
    this.changed();
  }

  record(costUsd: number, reservationId?: string) {
    if (reservationId) { this.reservations.delete(reservationId); this.uncertain.delete(reservationId); }
    this.spentUsd = roundUsd(this.spentUsd + nonNegative(costUsd, "costUsd"));
    if (this.spentUsd > this.absoluteLimitUsd) this.lock(`recorded cost exceeded the $${this.absoluteLimitUsd.toFixed(2)} absolute limit`);
    else if (this.spentUsd >= this.stopLimitUsd) this.lock(`recorded cost reached the $${this.stopLimitUsd.toFixed(2)} stop limit`);
    this.changed();
    return this.spentUsd;
  }

  lock(reason: string) {
    this.lockReason ??= reason.trim() || "unknown cost state";
    this.changed();
  }

  snapshot() {
    return {
      stopLimitUsd: this.stopLimitUsd,
      absoluteLimitUsd: this.absoluteLimitUsd,
      spentUsd: this.spentUsd,
      reservedUsd: this.reservedUsd(),
      uncertainUsd: this.uncertainUsd(),
      locked: Boolean(this.lockReason),
      ...(this.lockReason ? { lockReason: this.lockReason } : {}),
    };
  }

  markUnknown(id: string, reason: string) {
    const reserved = this.reservations.get(id);
    if (reserved !== undefined) this.uncertain.set(id, reserved);
    this.reservations.delete(id);
    this.lock(reason);
  }

  persistentSnapshot(): PersistentBudget {
    return { spentUsd: this.spentUsd, reservations: Object.fromEntries(this.reservations), uncertain: Object.fromEntries(this.uncertain), ...(this.lockReason ? { lockReason: this.lockReason } : {}) };
  }
  private changed() { this.options.onChange?.(this.persistentSnapshot()); }
  private uncertainUsd() { return roundUsd([...this.uncertain.values()].reduce((a, b) => a + b, 0)); }
  private reservedUsd() {
    return roundUsd([...this.reservations.values()].reduce((sum, value) => sum + value, 0));
  }
}
