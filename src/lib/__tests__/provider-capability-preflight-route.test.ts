import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const providerMocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  generateVideo: vi.fn(),
  listModels: vi.fn(),
}));

vi.mock("@/lib/providers", () => ({ createProvider: () => providerMocks }));

import { POST as createImage } from "@/app/api/ai/image/route";
import { POST as createVideo } from "@/app/api/ai/video/route";
import { POST as createSpeech } from "@/app/api/tts/route";

beforeEach(() => {
  providerMocks.generateImage.mockReset();
  providerMocks.generateVideo.mockReset();
  providerMocks.listModels.mockReset();
});

describe("provider request preflight", () => {
  it("blocks unsupported video parameters before a billable call", async () => {
    providerMocks.listModels.mockResolvedValue([{ id: "vendor/video", name: "Video", provider: "openrouter", mediaType: "video", modes: ["text-to-video"], supportsAudio: false, extra: { durationValues: [5], supportedResolutions: ["720p"], supportedAspectRatios: ["16:9"] } }]);
    providerMocks.generateVideo.mockRejectedValue(new Error("billable call must not run"));

    const response = await createVideo(new NextRequest("http://localhost/api/ai/video", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openrouter", apiKey: "fixture", model: "vendor/video", mode: "image-to-video", prompt: "demo",
        options: { width: 1080, height: 1920, duration: 8, audioEnabled: true },
      }),
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "CAPABILITY_MISMATCH",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "unsupported-mode" }),
        expect.objectContaining({ code: "unsupported-duration" }),
        expect.objectContaining({ code: "unsupported-resolution" }),
        expect.objectContaining({ code: "unsupported-aspect-ratio" }),
        expect.objectContaining({ code: "native-audio-unavailable" }),
      ]),
    });
    expect(providerMocks.generateVideo).not.toHaveBeenCalled();
  });

  it("blocks an unsupported image edit mode before generation", async () => {
    providerMocks.listModels.mockResolvedValue([{ id: "vendor/text-image", name: "Text Image", provider: "replicate", mediaType: "image", modes: ["text-to-image"] }]);
    const response = await createImage(new NextRequest("http://localhost/api/ai/image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "replicate", apiKey: "fixture", model: "vendor/text-image", mode: "image-to-image", prompt: "demo", imageUrl: "data:image/png;base64,AA==" }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "CAPABILITY_MISMATCH", issues: [expect.objectContaining({ code: "unsupported-mode" })] });
    expect(providerMocks.generateImage).not.toHaveBeenCalled();
  });

  it("blocks unsupported TTS speed before the provider request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await createSpeech(new NextRequest("http://localhost/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "测试", ttsConfig: { provider: "minimax", baseUrl: "https://api.minimax.chat/v1", apiKey: "fixture", model: "speech-2.6-hd", voice: "female-tianmei", speed: 3 } }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "CAPABILITY_MISMATCH", issues: [expect.objectContaining({ code: "unsupported-speed" })] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
