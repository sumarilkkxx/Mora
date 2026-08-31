import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_VIDEO_FAMILIES,
  atlasVideoFamilyId,
  atlasVideoModeForOptions,
  resolveAtlasVideoModelId,
} from "./atlas-video-models";
import { AtlasCloudProvider } from "./providers/atlas-cloud";

const base = {
  modelId: "bytedance/seedance-2.5",
  prompt: "test",
} as const;

describe("Atlas automatic video endpoint routing", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("exposes one selectable entry per model family", () => {
    expect(ATLAS_VIDEO_FAMILIES.map((model) => model.id)).toEqual([
      "bytedance/seedance-2.0-mini",
      "bytedance/seedance-2.0-fast",
      "bytedance/seedance-2.0",
      "bytedance/seedance-2.5",
      "minimax/h3",
      "minimax/h3-developer",
    ]);
  });

  it("routes a shot keyframe to image-to-video", () => {
    const mode = atlasVideoModeForOptions({ ...base, workflow: "shot-motion", mode: "image-to-video", firstFrameUrl: "image" });
    expect(resolveAtlasVideoModelId(base.modelId, mode)).toBe("bytedance/seedance-2.5/image-to-video");
  });

  it("routes multi-reference and video-to-video work to reference-to-video", () => {
    const mode = atlasVideoModeForOptions({ ...base, workflow: "storyboard-film", mode: "video-to-video", referenceImageUrls: ["image-1", "image-2"] });
    expect(resolveAtlasVideoModelId(base.modelId, mode)).toBe("bytedance/seedance-2.5/reference-to-video");
  });

  it("routes prompt-only work to text-to-video", () => {
    const mode = atlasVideoModeForOptions({ ...base, workflow: "prompt-video", mode: "text-to-video" });
    expect(resolveAtlasVideoModelId(base.modelId, mode)).toBe("bytedance/seedance-2.5/text-to-video");
  });

  it("migrates exact endpoint IDs back to their family without changing the tier", () => {
    expect(atlasVideoFamilyId("bytedance/seedance-2.0-fast/reference-to-video"))
      .toBe("bytedance/seedance-2.0-fast");
  });

  it("lets an explicit workflow override ambiguous legacy inputs", () => {
    expect(atlasVideoModeForOptions({
      ...base,
      workflow: "reference-replication",
      mode: "image-to-video",
      firstFrameUrl: "image",
    })).toBe("reference-to-video");
  });

  it("submits MiniMax H3 image and reference requests with their own field contract", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: { id: "prediction-h3" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AtlasCloudProvider({ name: "atlas-cloud", apiKey: "test-key", baseUrl: "https://api.atlascloud.ai/api/v1" });

    await provider.submitVideoTask({
      modelId: "minimax/h3",
      workflow: "shot-motion",
      mode: "image-to-video",
      prompt: "animate",
      firstFrameUrl: "https://example.com/start.png",
      lastFrameUrl: "https://example.com/end.png",
      duration: 8,
    });
    await provider.submitVideoTask({
      modelId: "minimax/h3",
      workflow: "storyboard-film",
      mode: "video-to-video",
      prompt: "replicate",
      referenceImageUrls: ["https://example.com/ref.png"],
      referenceVideoUrl: "https://example.com/ref.mp4",
      duration: 8,
    });

    const imageBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    const referenceBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(imageBody).toMatchObject({
      model: "minimax/h3/image-to-video",
      image: "https://example.com/start.png",
      end_image: "https://example.com/end.png",
      resolution: "768P",
    });
    expect(referenceBody.model).toBe("minimax/h3/reference-to-video");
    expect(referenceBody.refers).toEqual([
      { url: "https://example.com/ref.png" },
      { url: "https://example.com/ref.mp4" },
    ]);
    expect(referenceBody).not.toHaveProperty("reference_images");
  });

  it.each([
    {
      name: "shot keyframe",
      options: { ...base, workflow: "shot-motion" as const, mode: "image-to-video" as const, firstFrameUrl: "https://example.com/frame.png", width: 720, height: 1280 },
      expectedModel: "bytedance/seedance-2.5/image-to-video",
      expectedField: "image",
    },
    {
      name: "multi-reference film",
      options: { ...base, workflow: "storyboard-film" as const, mode: "video-to-video" as const, referenceImageUrls: ["https://example.com/shot-1.png"] },
      expectedModel: "bytedance/seedance-2.5/reference-to-video",
      expectedField: "reference_images",
    },
    {
      name: "prompt-only generation",
      options: { ...base, workflow: "prompt-video" as const, mode: "text-to-video" as const },
      expectedModel: "bytedance/seedance-2.5/text-to-video",
      expectedField: "prompt",
    },
  ])("submits the exact endpoint for $name", async ({ options, expectedModel, expectedField }) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "prediction-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AtlasCloudProvider({ name: "atlas-cloud", apiKey: "test-key", baseUrl: "https://api.atlascloud.ai/api/v1" });

    const result = await provider.submitVideoTask(options);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;

    expect(result.modelId).toBe(expectedModel);
    expect(body.model).toBe(expectedModel);
    expect(body).toHaveProperty(expectedField);
    if (expectedModel.endsWith("/image-to-video")) expect(body.ratio).toBe("adaptive");
  });
});
