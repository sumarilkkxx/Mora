export interface ModelUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
}

export interface ModelCallReservation {
  id: string;
  maxOutputTokens: number;
}

export interface AutoEditObserver {
  recordOutcome?(input: { state: string; reasonCode: string; reason?: string }): void;
  beginToolExecution?(input: ToolExecutionInput): string;
  completeToolExecution?(id: string, result: unknown): void;
  failToolExecution?(id: string, error: unknown): void;
  beginModelCall(input: {
    stage: string;
    model: string;
    vision: boolean;
    allowedTools?: readonly string[];
    estimatedInputTokens: number;
    requestedMaxOutputTokens: number;
  }): ModelCallReservation;
  completeModelCall(id: string, usage: ModelUsage | null | undefined): void;
  failModelCall(id: string, error: unknown): void;
  recordToolDecision(modelCallId: string, input: { stage: string; tool: string; allowed: boolean; arguments: unknown }): void;
}

export interface ToolExecutionInput {
  stage: string;
  tool: string;
  arguments: unknown;
  origin?: "agent" | "runtime";
}

/** Optional execution receipts; the operation also works without an observer. */
export async function observeToolExecution<T>(observer: AutoEditObserver | undefined, input: ToolExecutionInput, operation: () => Promise<T>): Promise<T> {
  const id = observer?.beginToolExecution?.(input);
  try {
    const result = await operation();
    if (id) observer?.completeToolExecution?.(id, result);
    return result;
  } catch (error) {
    if (id) observer?.failToolExecution?.(id, error);
    throw error;
  }
}
