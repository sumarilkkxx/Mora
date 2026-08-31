import { describe, expect, it } from "vitest";
import { withAiTaskFinalizationLock } from "@/lib/ai-task-finalization";

describe("withAiTaskFinalizationLock", () => {
  it("coalesces concurrent finalization for the same provider task", async () => {
    let calls = 0;
    const finalize = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "saved";
    };

    const results = await Promise.all([
      withAiTaskFinalizationLock("openrouter", "task-1", finalize),
      withAiTaskFinalizationLock("openrouter", "task-1", finalize),
    ]);

    expect(results).toEqual(["saved", "saved"]);
    expect(calls).toBe(1);
  });

  it("clears a rejected lock so a later retry can finalize", async () => {
    await expect(withAiTaskFinalizationLock("openrouter", "task-2", async () => {
      throw new Error("download failed");
    })).rejects.toThrow("download failed");

    await expect(withAiTaskFinalizationLock("openrouter", "task-2", async () => "retried")).resolves.toBe("retried");
  });
});
