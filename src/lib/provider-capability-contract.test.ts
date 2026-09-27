import { describe, expect, it } from "vitest";
import {
  PROVIDER_CAPABILITY_CONTRACT_VERSION,
  preflightCapabilityRequest,
  resolveCapabilityContract,
  withModelCapability,
} from "@/lib/provider-capability-contract";

describe("versioned provider capability contract", () => {
  it("describes text, vision, image, video and TTS through one interface", () => {
    const fixtures = [
      { capability: "text" as const, provider: "openrouter", modelId: "openai/gpt-5", expectedOutput: "text" },
      { capability: "vision" as const, provider: "openrouter", modelId: "openai/gpt-5", expectedOutput: "text" },
      { capability: "image" as const, provider: "openai", modelId: "openai/gpt-image-2", expectedOutput: "image" },
      { capability: "video" as const, provider: "atlas-cloud", modelId: "bytedance/seedance-2.5", expectedOutput: "video" },
      { capability: "tts" as const, provider: "openai", modelId: "gpt-4o-mini-tts", expectedOutput: "audio" },
    ];

    expect(PROVIDER_CAPABILITY_CONTRACT_VERSION).toBe(1);
    for (const fixture of fixtures) {
      expect(resolveCapabilityContract(fixture)).toMatchObject({
        version: 1,
        capability: fixture.capability,
        provider: fixture.provider,
        modelId: fixture.modelId,
        output: { mediaType: fixture.expectedOutput },
      });
    }
  });

  it("uses one Atlas video contract for options, recovery and billing semantics", () => {
    const contract = resolveCapabilityContract({
      capability: "video",
      provider: "atlas-cloud",
      modelId: "bytedance/seedance-2.0-mini",
      modes: ["text-to-video", "image-to-video", "video-to-video"],
      supportsAudio: true,
      extra: { estimatedPricePerUnit: 0.039, priceUnit: "second" },
    });

    expect(contract).toMatchObject({
      confidence: "known",
      parameters: {
        modes: ["text-to-video", "image-to-video", "video-to-video"],
        durations: expect.arrayContaining([4, 15]),
        resolutions: ["480p", "720p"],
      },
      references: { maxImages: 9, maxVideos: 3, maxAudios: 3 },
      audio: { output: "native" },
      task: { submission: "two-phase", recovery: "durable" },
      billing: { unit: "second", estimate: 0.039 },
    });

    expect(preflightCapabilityRequest(contract, {
      mode: "video-to-video",
      duration: 30,
      resolution: "1080p",
      aspectRatio: "9:16",
      referenceImageCount: 10,
      referenceVideoCount: 4,
      audioEnabled: true,
    })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "unsupported-duration", field: "duration" }),
        expect.objectContaining({ code: "unsupported-resolution", field: "resolution" }),
        expect.objectContaining({ code: "too-many-reference-images", field: "referenceImages" }),
        expect.objectContaining({ code: "too-many-reference-videos", field: "referenceVideos" }),
      ]),
    });
  });

  it("keeps custom models selectable without claiming durable recovery", () => {
    const contract = resolveCapabilityContract({
      capability: "video",
      provider: "replicate",
      modelId: "owner/custom-video",
      modes: ["text-to-video"],
    });
    expect(contract).toMatchObject({
      confidence: "declared",
      task: { submission: "single-phase", recovery: "best-effort" },
    });
    expect(preflightCapabilityRequest(contract, {
      mode: "text-to-video",
      duration: 11,
      resolution: "1080p",
      aspectRatio: "1:1",
    })).toMatchObject({ ok: true, issues: [] });
  });

  it("enriches discovered models with the same contract returned to selectors", () => {
    const model = withModelCapability({
      id: "vendor/video",
      name: "Vendor Video",
      provider: "openrouter",
      mediaType: "video",
      modes: ["text-to-video"],
      supportsAudio: false,
      extra: {
        durationValues: [5, 10],
        supportedResolutions: ["720p"],
        supportedAspectRatios: ["16:9"],
      },
    });
    expect(model.capability).toMatchObject({
      version: 1,
      parameters: {
        modes: ["text-to-video"], durations: [5, 10], resolutions: ["720p"], aspectRatios: ["16:9"],
      },
      audio: { output: "none" },
      task: { recovery: "durable" },
    });
  });

  it("keeps built-in model truth in the contract even when live discovery is unavailable", () => {
    expect(resolveCapabilityContract({
      capability: "video",
      provider: "openrouter",
      modelId: "google/veo3.1/image-to-video",
      supportsAudio: true,
    })).toMatchObject({
      confidence: "known",
      parameters: {
        modes: ["image-to-video"],
        durations: [4, 6, 8],
        resolutions: ["720p", "1080p"],
        aspectRatios: ["16:9", "9:16"],
      },
      references: { lastFrame: true },
    });
  });

  it("preflights TTS parameters through the same contract", () => {
    const contract = resolveCapabilityContract({ capability: "tts", provider: "minimax", modelId: "speech-2.6-hd" });
    expect(contract.parameters).toMatchObject({ speedRange: { min: 0.5, max: 2 }, features: ["emotion"] });
    expect(preflightCapabilityRequest(contract, { speed: 3 })).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "unsupported-speed", field: "speed" })],
    });
  });

  it("keeps model capability portable across providers without assigning the capability to one platform", () => {
    const contract = resolveCapabilityContract({
      capability: "video",
      provider: "openrouter",
      modelId: "bytedance/seedance-2.5",
      modes: ["text-to-video", "image-to-video"],
      supportsAudio: true,
    });
    expect(contract.parameters.modes).toEqual(["text-to-video", "image-to-video", "video-to-video"]);
    expect(contract.references.maxImages).toBe(50);
    expect(contract.task.recovery).toBe("durable");
  });
});
