import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/providers", () => ({
  createProvider: () => ({
    listModels: async () => [{
      id: "vendor/video",
      name: "Vendor Video",
      provider: "openrouter",
      mediaType: "video",
      modes: ["text-to-video"],
      supportsAudio: false,
      extra: { durationValues: [5], supportedResolutions: ["720p"] },
    }],
  }),
}));

import { POST } from "@/app/api/ai/models/route";

describe("provider model contract route", () => {
  it("returns selector models with their executable capability contract", async () => {
    const response = await POST(new NextRequest("http://localhost/api/ai/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providers: [{ name: "openrouter", apiKey: "fixture" }], mediaType: "video" }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).models[0]).toMatchObject({
      id: "vendor/video",
      capability: {
        version: 1,
        parameters: { modes: ["text-to-video"], durations: [5], resolutions: ["720p"] },
        task: { recovery: "durable" },
      },
    });
  });
});
