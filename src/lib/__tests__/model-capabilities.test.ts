import { describe, expect, it } from "vitest";
import { resolveModelResolution } from "@/lib/model-capabilities";

describe("model-driven video resolution", () => {
  it("keeps an exact supported preference", () => {
    expect(resolveModelResolution("1080p", ["720p", "1080p"])).toEqual({
      preferred: "1080p", effective: "1080p", adjusted: false,
    });
  });

  it("maps a stable preference to the nearest provider tier", () => {
    expect(resolveModelResolution("720p", ["768P", "2K"]).effective).toBe("768P");
    expect(resolveModelResolution("1080p", ["768P", "2K"]).effective).toBe("2K");
  });
});
