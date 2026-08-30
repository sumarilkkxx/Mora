import { describe, it, expect } from "vitest";

describe("TTS 表现力（情绪透传 + [pause] 气口）", () => {
  it("stripPauseMarks：去标记、并拢英文双空格、中文无缝", async () => {
    const { stripPauseMarks, hasPauseMarks } = await import("@/lib/voice-markup");
    expect(stripPauseMarks("真的，[pause]你试试")).toBe("真的，你试试");
    expect(stripPauseMarks("really [pause] try it")).toBe("really try it");
    expect(stripPauseMarks("[PAUSE]开头也能剥")).toBe("开头也能剥");
    expect(stripPauseMarks("没有标记")).toBe("没有标记");
    expect(hasPauseMarks("有[pause]标记")).toBe(true);
    expect(hasPauseMarks("没有")).toBe(false);
  });

  it("EMOTION_TTS：六种情绪都映射到 MiniMax 官方枚举", async () => {
    const { EMOTION_TTS } = await import("@/lib/emotion-acting");
    const official = new Set(["happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral"]);
    for (const v of Object.values(EMOTION_TTS)) {
      expect(official.has(v.minimax)).toBe(true);
      expect(v.instruction.length).toBeGreaterThan(0);
    }
  });

  it("shotEmotion：六种镜头类型全覆盖，未知类型 undefined", async () => {
    const { shotEmotion } = await import("@/lib/emotion-acting");
    for (const t of ["hook", "pain_point", "product_reveal", "demo", "social_proof", "cta"]) {
      expect(shotEmotion(t)).toBeTruthy();
    }
    expect(shotEmotion("nope")).toBeUndefined();
  });
});
