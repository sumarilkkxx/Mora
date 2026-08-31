import { describe, expect, it } from "vitest";
import { insufficientBalanceDetails } from "./provider-billing-error";

describe("insufficientBalanceDetails", () => {
  it("classifies an HTTP 402 as an OpenRouter top-up error", () => {
    expect(insufficientBalanceDetails({ statusCode: 402, provider: "openrouter" }, "")).toEqual({
      provider: "openrouter",
      providerLabel: "OpenRouter",
      rechargeUrl: "https://openrouter.ai/settings/credits",
      statusCode: 402,
      taskSubmitted: false,
    });
  });

  it("recognizes providers that wrap insufficient balance in HTTP 400", () => {
    expect(insufficientBalanceDetails({
      statusCode: 400,
      message: "Bad Request: insufficient_balance",
      provider: "atlas-cloud",
    }, "")?.providerLabel).toBe("Atlas Cloud");
  });

  it("does not misclassify an ordinary bad request", () => {
    expect(insufficientBalanceDetails({
      statusCode: 400,
      message: "Bad Request: unsupported duration",
    }, "openrouter")).toBeNull();
  });

  it("preserves whether the provider already returned a task id", () => {
    expect(insufficientBalanceDetails({
      statusCode: 402,
      provider: "openrouter",
      taskId: "job-123",
    }, "")?.taskSubmitted).toBe(true);
  });
});
