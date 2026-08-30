import { describe, expect, it } from "vitest";
import { contentPolicyError, isContentPolicyRejection } from "@/lib/content-policy-error";

describe("content policy errors", () => {
  it("recognizes Meta/OpenRouter policy filtering", () => {
    expect(isContentPolicyRejection(new Error("The response was filtered due to the prompt triggering our content management policy."))).toBe(true);
    expect(isContentPolicyRejection(new Error("400 unsupported duration"))).toBe(false);
  });

  it("returns an actionable stage-specific message", () => {
    expect(contentPolicyError("zh", "image")).toMatch(/参考图/);
    expect(contentPolicyError("en", "video")).toMatch(/dialogue/);
  });
});
