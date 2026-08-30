import { describe, it, expect } from "vitest";
import { VOICE_GROUND_CHAIN, roomToneSource } from "../video-composer/voice-ground";
import { buildComposeCommand, type ComposeConfig } from "../video-composer/composer";

/**
 * Voice grounding contract: TTS narration passes the de-broadcast chain and a room-tone bed
 * runs under the whole timeline; native model audio (Seedance 2.x own voice) is NEVER touched;
 * voiceGround:false restores the legacy graph byte-for-byte.
 */

const cfg = (over: Partial<ComposeConfig["output"]> = {}, clips?: ComposeConfig["clips"]): ComposeConfig => ({
  projectId: "t",
  clips: clips ?? [
    { type: "image", filePath: "/tmp/a.jpg", duration: 3, transition: "direct_concat", motion: "static", audioPath: "/tmp/tts-1.mp3" },
    { type: "video", filePath: "/tmp/b.mp4", duration: 4, transition: "direct_concat", motion: "static", hasAudio: true },
  ],
  output: { resolution: "720p", aspectRatio: "9:16", ...over },
});

describe("voice grounding（TTS 人声落地）", () => {
  it("有 TTS 轨时默认开启：TTS 流过去播音腔链 + 全片房间底噪垫底", () => {
    const cmd = buildComposeCommand(cfg());
    expect(cmd).toContain(VOICE_GROUND_CHAIN);
    expect(cmd).toContain("anoisesrc=colour=brown");
    expect(cmd).toContain("[voice_grounded]");
  });

  it("原生音轨永不过链：链只出现一次（挂在 TTS 输入流上）", () => {
    const cmd = buildComposeCommand(cfg());
    // 一条 TTS + 一条原生音轨 → 去播音腔链恰好一次
    expect(cmd.split("aexciter").length - 1).toBe(1);
  });

  it("voiceGround:false 完全退回旧图（字节级一致）", () => {
    const off = buildComposeCommand(cfg({ voiceGround: false }));
    expect(off).not.toContain("aexciter");
    expect(off).not.toContain("anoisesrc");
  });

  it("纯原生人声轨：不过去播音腔链，但垫更轻的底噪统一空间感（0.004），切点带 20ms 边缘淡化", () => {
    const cmd = buildComposeCommand(
      cfg({}, [
        { type: "video", filePath: "/tmp/b.mp4", duration: 4, transition: "direct_concat", motion: "static", hasAudio: true },
        { type: "video", filePath: "/tmp/c.mp4", duration: 4, transition: "direct_concat", motion: "static", hasAudio: true },
      ])
    );
    expect(cmd).not.toContain("aexciter"); // 原生人声永不过链
    expect(cmd).toContain("amplitude=0.004"); // 更轻的底噪垫（TTS 轨才是 0.008）
    // 相邻原生切点用逐段 20ms 边缘淡化平滑底噪跳变（不用 acrossfade——那会逐接缝吃掉音轨时长造成音画漂移）
    expect(cmd).toContain("afade=t=in:st=0:d=0.02");
    expect(cmd).toContain("afade=t=out:st=3.980:d=0.02");
    expect(cmd).not.toContain("acrossfade");
  });

  it("底噪源是 lavfi 合成（零素材依赖），限幅在察觉不到的量级并锁定 44100/立体声", () => {
    const src = roomToneSource();
    expect(src).toContain("amplitude=0.008");
    expect(src).toContain("lowpass=f=400");
    expect(src).toContain("channel_layouts=stereo");
  });
});
