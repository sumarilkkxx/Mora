import type { ModelPrice, ModelTokenUsage } from "./types";

const roundUsd = (value: number) => Math.round(value * 1_000_000_000) / 1_000_000_000;

export const DEFAULT_EVALUATION_STOP_LIMIT_USD = 6;
export const DEFAULT_EVALUATION_ABSOLUTE_LIMIT_USD = 7;

function nonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
  return value;
}

export class EvaluationBudgetError extends Error {
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

export class CostLedger {
  private spentUsd = 0;
  private readonly reservations = new Map<string, number>();
  private lockReason?: string;

  constructor(readonly stopLimitUsd = DEFAULT_EVALUATION_STOP_LIMIT_USD, readonly absoluteLimitUsd = DEFAULT_EVALUATION_ABSOLUTE_LIMIT_USD) {
    nonNegative(stopLimitUsd, "stopLimitUsd");
    nonNegative(absoluteLimitUsd, "absoluteLimitUsd");
    if (stopLimitUsd > absoluteLimitUsd) throw new Error("stopLimitUsd must not exceed absoluteLimitUsd");
  }

  assertCanStart(reservedCostUsd: number) {
    nonNegative(reservedCostUsd, "reservedCostUsd");
    if (this.lockReason) throw new EvaluationBudgetError(`Agent evaluation budget is locked: ${this.lockReason}`);
    if (this.spentUsd + this.reservedUsd() + reservedCostUsd > this.stopLimitUsd) {
      throw new EvaluationBudgetError(`Agent evaluation request would exceed the $${this.stopLimitUsd.toFixed(2)} stop limit`);
    }
  }

  reserve(id: string, reservedCostUsd: number) {
    if (!id || this.reservations.has(id)) throw new Error("budget reservation ID must be unique");
    this.assertCanStart(reservedCostUsd);
    this.reservations.set(id, nonNegative(reservedCostUsd, "reservedCostUsd"));
  }

  release(id: string) {
    this.reservations.delete(id);
  }

  record(costUsd: number, reservationId?: string) {
    if (reservationId) this.release(reservationId);
    this.spentUsd = roundUsd(this.spentUsd + nonNegative(costUsd, "costUsd"));
    if (this.spentUsd > this.absoluteLimitUsd) this.lock(`recorded cost exceeded the $${this.absoluteLimitUsd.toFixed(2)} absolute limit`);
    else if (this.spentUsd >= this.stopLimitUsd) this.lock(`recorded cost reached the $${this.stopLimitUsd.toFixed(2)} stop limit`);
    return this.spentUsd;
  }

  lock(reason: string) {
    this.lockReason ??= reason.trim() || "unknown cost state";
  }

  snapshot() {
    return {
      stopLimitUsd: this.stopLimitUsd,
      absoluteLimitUsd: this.absoluteLimitUsd,
      spentUsd: this.spentUsd,
      reservedUsd: this.reservedUsd(),
      locked: Boolean(this.lockReason),
      ...(this.lockReason ? { lockReason: this.lockReason } : {}),
    };
  }

  private reservedUsd() {
    return roundUsd([...this.reservations.values()].reduce((sum, value) => sum + value, 0));
  }
}
