import { describe, it, expect } from "vitest";
import { buildGifVf } from "@/lib/video-composer/gif-preview";

describe("buildGifVf", () => {
  it("fps + lanczos downscale + palettegen/paletteuse (quality GIF)", () => {
    const vf = buildGifVf(360, 12);
    expect(vf).toContain("fps=12");
    expect(vf).toContain("scale=360:-1:flags=lanczos");
    expect(vf).toContain("palettegen=max_colors=128");
    expect(vf).toContain("paletteuse=dither=bayer");
  });
  it("width/fps flow through", () => {
    expect(buildGifVf(480, 15)).toContain("scale=480:-1");
    expect(buildGifVf(480, 15)).toContain("fps=15");
  });
});
