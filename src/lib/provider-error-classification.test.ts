import { describe, expect, it } from "vitest";
import { ProviderError } from "@/lib/providers/base";
import { classifyProviderError } from "@/lib/provider-error-classification";

describe("provider error classification", () => {
  it.each([
    [new ProviderError("unauthorized", "API_ERROR", "openrouter", 401), "authentication", false],
    [new ProviderError("insufficient_balance", "API_ERROR", "atlas-cloud", 402), "billing", false],
    [new ProviderError("too many requests", "API_ERROR", "openrouter", 429), "rate_limit", true],
    [new ProviderError("unsupported duration", "UNSUPPORTED_DURATION", "atlas-cloud", 400), "capability_mismatch", false],
    [new ProviderError("content policy rejected", "TASK_FAILED", "openrouter", 400), "content_policy", false],
    [Object.assign(new ProviderError("poll timed out", "POLL_TIMEOUT", "openrouter"), { taskId: "job-1" }), "queue_timeout", true],
    [new ProviderError("socket reset", "NETWORK_ERROR", "replicate"), "network_retryable", true],
  ])("classifies %s as %s", (error, category, retryable) => {
    expect(classifyProviderError(error, "fallback")).toMatchObject({ category, retryable });
  });

  it("marks an already-submitted task as resumable", () => {
    const error = Object.assign(new ProviderError("status unknown", "STATUS_UNKNOWN", "openrouter"), { taskId: "job-2" });
    expect(classifyProviderError(error, "openrouter")).toMatchObject({
      category: "queue_timeout",
      taskId: "job-2",
      recoverableTask: true,
    });
  });
});
