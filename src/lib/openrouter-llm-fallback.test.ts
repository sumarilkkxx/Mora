import { describe, expect, it } from "vitest";
import {
  isOpenRouterPolicyRejection,
  openRouterPolicyFallbackConfig,
} from "./openrouter-llm-fallback";

describe("OpenRouter LLM policy fallback", () => {
  it("recognizes the provider Terms of Service 403", () => {
    const error = Object.assign(
      new Error("The request is prohibited due to a violation of provider Terms Of Service"),
      { status: 403 },
    );
    expect(isOpenRouterPolicyRejection(error, "https://openrouter.ai/api/v1")).toBe(true);
  });

  it("does not treat unrelated 403s or other endpoints as policy refusals", () => {
    expect(isOpenRouterPolicyRejection(Object.assign(new Error("Forbidden"), { status: 403 }), "https://openrouter.ai/api/v1")).toBe(false);
    expect(isOpenRouterPolicyRejection(Object.assign(new Error("provider Terms Of Service"), { status: 403 }), "https://api.openai.com/v1")).toBe(false);
  });

  it("uses only the user-configured request fallback and cannot recurse", () => {
    const config = {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "secret",
      model: "openai/gpt-5.6-luna",
      visionModel: "openai/gpt-5.6-luna",
      fallbackModel: "deepseek/deepseek-v3",
      fallbackVisionModel: "qwen/qwen-vl-max",
    };
    expect(openRouterPolicyFallbackConfig(config, "text")).toMatchObject({ model: "deepseek/deepseek-v3", visionModel: "openai/gpt-5.6-luna" });
    expect(openRouterPolicyFallbackConfig(config, "vision")).toMatchObject({ model: "openai/gpt-5.6-luna", visionModel: "qwen/qwen-vl-max" });
    expect(openRouterPolicyFallbackConfig({ ...config, model: config.fallbackModel }, "text")).toBeNull();
  });
});
