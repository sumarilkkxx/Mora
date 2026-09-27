import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/llm-models", () => ({
  isOllama: () => false,
  listModelsDetailed: async () => ({ models: ["openai/gpt-5"], code: null }),
}));

import { POST } from "@/app/api/llm/models/route";

describe("LLM model capability route", () => {
  it("returns text and vision choices with the shared contract", async () => {
    const response = await POST(new NextRequest("http://localhost/api/llm/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "fixture", capability: "vision" }),
    }));
    expect(await response.json()).toMatchObject({
      ok: true,
      models: [{
        id: "openai/gpt-5",
        name: "openai/gpt-5",
        capability: { version: 1, capability: "vision", provider: "openrouter", input: { mediaTypes: ["text", "image"] } },
      }],
    });
  });
});
