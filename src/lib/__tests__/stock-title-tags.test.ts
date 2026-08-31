import { describe, it, expect } from "vitest";
import { toOpenverseImageCandidate } from "@/lib/providers/openverse";
import { toPixabayImageCandidate } from "@/lib/providers/pixabay";
import { pexelsSlugTitle } from "@/lib/providers/pexels";

// Providers previously dropped title/tags when normalizing hits, so keyword-overlap scoring
// (and semantic rerank) had no text to match against. These tests pin the mappings.
describe("stock candidate title/tags mapping", () => {
  it("openverse keeps the hit title", () => {
    const c = toOpenverseImageCandidate({
      id: "x1",
      title: "Pour over coffee at home",
      url: "https://img/x1.jpg",
      license: "by",
      license_version: "2.0",
    });
    expect(c?.title).toBe("Pour over coffee at home");
  });

  it("pixabay splits the comma-separated tag string into a list", () => {
    const c = toPixabayImageCandidate({
      id: 5,
      pageURL: "https://pixabay.com/photos/coffee-5/",
      user: "u",
      user_id: 1,
      tags: "coffee, cup , morning",
      largeImageURL: "https://img/5.jpg",
      webformatURL: "https://img/5w.jpg",
      previewURL: "https://img/5p.jpg",
      imageWidth: 1080,
      imageHeight: 1920,
    } as Parameters<typeof toPixabayImageCandidate>[0]);
    expect(c.tags).toEqual(["coffee", "cup", "morning"]);
  });

  it("pexels video title derives from the detail-page slug (id stripped)", () => {
    expect(pexelsSlugTitle("https://www.pexels.com/video/woman-pouring-coffee-853789/")).toBe("woman pouring coffee");
    expect(pexelsSlugTitle("https://www.pexels.com/video/853789/")).toBeUndefined();
    expect(pexelsSlugTitle(undefined)).toBeUndefined();
  });
});
