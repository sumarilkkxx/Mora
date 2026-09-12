import { describe, expect, it } from "vitest";
import { buildAtlasSchemaRequest } from "@/lib/atlas-video-request";

const schema = {
  required: ["prompt", "resolution"],
  properties: {
    prompt: { type: "string" },
    resolution: { type: "string", enum: ["768P", "2K"] },
  },
};

describe("Atlas schema request mapping", () => {
  it("uses the user's quality preference instead of the schema's first enum", () => {
    expect(buildAtlasSchemaRequest("minimax/h3/text-to-video", "text-to-video", {
      modelId: "minimax/h3/text-to-video",
      mode: "text-to-video",
      prompt: "demo",
      width: 1920,
      height: 1080,
    }, schema).resolution).toBe("2K");
    expect(buildAtlasSchemaRequest("minimax/h3/text-to-video", "text-to-video", {
      modelId: "minimax/h3/text-to-video",
      mode: "text-to-video",
      prompt: "demo",
      width: 1280,
      height: 720,
    }, schema).resolution).toBe("768P");
  });

  it("never upgrades a native preference into a separately billed SR tier", () => {
    const enhancedSchema = {
      required: ["prompt", "resolution"],
      properties: {
        prompt: { type: "string" },
        resolution: { type: "string", enum: ["480p", "720p", "720p-sr", "1080p-sr", "1440p-esr"] },
      },
    };
    expect(buildAtlasSchemaRequest("vendor/model", "text-to-video", {
      modelId: "vendor/model",
      mode: "text-to-video",
      prompt: "demo",
      width: 1920,
      height: 1080,
    }, enhancedSchema).resolution).toBe("720p");
    expect(buildAtlasSchemaRequest("vendor/model", "text-to-video", {
      modelId: "vendor/model",
      mode: "text-to-video",
      prompt: "demo",
      width: 1920,
      height: 1080,
      extra: { resolution: "1080p-sr" },
    }, enhancedSchema).resolution).toBe("1080p-sr");
  });
});
