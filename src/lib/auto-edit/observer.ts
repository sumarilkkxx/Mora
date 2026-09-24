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
