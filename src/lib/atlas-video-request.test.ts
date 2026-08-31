import { describe, expect, it } from "vitest";
import { buildAtlasSchemaRequest } from "./atlas-video-request";

describe("Atlas schema-driven video requests", () => {
  it("maps Mora image input to a model-specific image_url schema", () => {
    const body = buildAtlasSchemaRequest("vendor/model/image-to-video", "image-to-video", {
      modelId: "vendor/model",
      mode: "image-to-video",
      prompt: "animate",
      firstFrameUrl: "https://example.com/frame.png",
      duration: 7,
      width: 720,
      height: 1280,
    }, {
      properties: {
        model: { type: "string" },
        prompt: { type: "string" },
        image_url: { type: "string" },
        duration: { type: "number", enum: [5, 10] },
        resolution: { type: "string", enum: ["portrait_9_16", "landscape_16_9"] },
      },
      required: ["model", "prompt", "image_url"],
    });
    expect(body).toMatchObject({
      image_url: "https://example.com/frame.png",
      duration: 5,
      resolution: "portrait_9_16",
    });
  });

  it("fails before paid submission when a specialist schema needs unavailable inputs", () => {
    expect(() => buildAtlasSchemaRequest("atlascloud/studio/ugc-ad", "image-to-video", {
      modelId: "atlascloud/studio/ugc-ad",
      mode: "image-to-video",
      prompt: "ad",
    }, {
      properties: { model: {}, user_prompt: {}, product_image: {} },
      required: ["model", "user_prompt", "product_image"],
    })).toThrow(/product_image/);
  });
});
