import { describe, it, expect } from "vitest";
import { buildCardVf, resolveCardTheme, CARD_THEMES } from "@/lib/video-composer/carousel";

describe("resolveCardTheme", () => {
  it("known theme → its palette sequence; unknown/empty → xiaohongshu fallback", () => {
    expect(resolveCardTheme("xiaohongshu")).toBe(CARD_THEMES.xiaohongshu);
    expect(resolveCardTheme("SHORTVIDEO")).toBe(CARD_THEMES.shortvideo); // case-insensitive
    expect(resolveCardTheme("nope")).toBe(CARD_THEMES.xiaohongshu);
    expect(resolveCardTheme(undefined)).toBe(CARD_THEMES.xiaohongshu);
  });
  it("every theme has a 2-stop gradient + font color", () => {
    for (const theme of Object.values(CARD_THEMES)) {
      expect(theme.length).toBeGreaterThan(0);
      for (const palette of theme) {
        expect(palette.gradient).toHaveLength(2);
        expect(typeof palette.fontColor).toBe("string");
      }
    }
  });
});

describe("buildCardVf", () => {
  it("long text wraps to multiple per-line centered drawtexts", () => {
    const vf = buildCardVf({ text: "这是一段比较长的卡片正文用于测试自动换行效果是否正常显示在卡片上的每一行", width: 1080 });
    const lines = (vf.match(/drawtext=/g) || []).length;
    expect(lines).toBeGreaterThan(1); // wrapped → one centered drawtext per line
    expect(vf).toContain("expansion=none");
    expect(vf).toContain("x=(w-text_w)/2"); // each line centered horizontally
    expect(vf).toContain("(h-"); // vertically-centered block expression
  });
  it("short text → a single centered drawtext", () => {
    const vf = buildCardVf({ text: "短", width: 1080 });
    expect((vf.match(/drawtext=/g) || []).length).toBe(1);
  });
  it("explicit fontSize/color flow through", () => {
    const vf = buildCardVf({ text: "x", width: 1080, fontSize: 90, fontColor: "yellow" });
    expect(vf).toContain("fontsize=90");
    expect(vf).toContain("fontcolor=yellow");
  });
});
