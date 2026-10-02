import type { FaultConfiguration } from "./core/contracts";

export class InjectedFaultError extends Error {
  constructor(readonly code: string, readonly effect: FaultConfiguration["effect"]) {
    super(`Injected ${effect}: ${code}`);
  }
}
/** Tool-side adapter. It wraps operations; it never creates execution receipts or verdicts. */
export class FaultAdapter {
  private counts = new Map<FaultConfiguration["point"], number>();
  readonly triggered: Array<FaultConfiguration & { invocation: number }> = [];
  constructor(private readonly faults: readonly FaultConfiguration[]) {}
  async invoke<T>(point: FaultConfiguration["point"], operation: () => Promise<T>, invalidResult?: () => Promise<T>): Promise<T> {
    const invocation = (this.counts.get(point) ?? 0) + 1;
    this.counts.set(point, invocation);
    const fault = this.faults.find(f => f.point === point && f.occurrence === invocation);
    if (!fault) return operation();
    this.triggered.push({ ...fault, invocation });
    if (fault.effect === "invalid_result") {
      if (!invalidResult) throw new Error(`Missing invalid-result implementation at ${point}`);
      return invalidResult();
    }
    throw new InjectedFaultError(fault.code, fault.effect);
  }
  assertTriggered() {
    if (this.triggered.length !== this.faults.length) throw new Error("Some configured faults never reached their actual boundary");
  }
}
