import { describe, expect, it } from "vitest";
import {
  isOpenRouterPolicyRejection,
  openRouterPolicyFallbackConfig,
} from "@/lib/openrouter-llm-fallback";

const config = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "test",
  model: "primary-text",
  visionModel: "primary-vision",
  fallbackModel: "regional-text",
  fallbackVisionModel: "regional-vision",
};

describe("OpenRouter request-scoped fallback", () => {
  it("keeps primary settings and changes only the requested capability", () => {
    const text = openRouterPolicyFallbackConfig(config, "text");
    const vision = openRouterPolicyFallbackConfig(config, "vision");
    expect(text).toMatchObject({ model: "regional-text", visionModel: "primary-vision" });
    expect(vision).toMatchObject({ model: "primary-text", visionModel: "regional-vision" });
    expect(config).toMatchObject({ model: "primary-text", visionModel: "primary-vision" });
  });

  it("does not invent a hard-coded fallback", () => {
    expect(openRouterPolicyFallbackConfig({ ...config, fallbackModel: "" }, "text")).toBeNull();
    expect(openRouterPolicyFallbackConfig({ ...config, fallbackVisionModel: "", fallbackModel: "" }, "vision")).toBeNull();
  });

  it("only classifies an OpenRouter provider-policy 403", () => {
    expect(isOpenRouterPolicyRejection(Object.assign(new Error("request is prohibited due to provider Terms Of Service"), { status: 403 }), config.baseUrl)).toBe(true);
    expect(isOpenRouterPolicyRejection(Object.assign(new Error("invalid key"), { status: 403 }), config.baseUrl)).toBe(false);
    expect(isOpenRouterPolicyRejection(Object.assign(new Error("Terms Of Service"), { status: 403 }), "https://example.com/v1")).toBe(false);
  });
});
