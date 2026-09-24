import { describe, it, expect } from "vitest";
import { buildComposeInvocation, SPEEDFIT_MAX_RATIO, SPEEDFIT_MIN_RATIO, type ComposeConfig } from "@/lib/video-composer/composer";
import { buildAssetRows, nextChainKeyframe } from "@/lib/assets-view";
import { modelSupportsLastFrame } from "@/lib/video-composer/transitions";
import { buildMotionPrompt } from "@/lib/motion-prompt";
import type { Shot } from "@/lib/domain/script";

/** Minimal compose config with a single video clip; overrides tweak the clip under test. */
function cfg(clip: Partial<ComposeConfig["clips"][number]>): ComposeConfig {
  return {
    projectId: "test-speedfit",
    clips: [
      {
        type: "video",
        filePath: "/tmp/clip.mp4",
        duration: 4,
        transition: "ai_start_end",
        ...clip,
      },
    ],
    output: { resolution: "720p", aspectRatio: "9:16" },
  };
}

describe("composer 变速压槽（保住链式尾帧）", () => {
  it("静音视频略长于槽位 → setpts 变速压入（保住首尾两端）", () => {
    const inv = buildComposeInvocation(cfg({ sourceDuration: 5 }));
    expect(inv.filterComplex).toContain("setpts=PTS/1.2500");
  });

  it("超过限幅比例 → 退回裁切，不做快进感变速", () => {
    const inv = buildComposeInvocation(cfg({ sourceDuration: 4 * SPEEDFIT_MAX_RATIO * 1.2 }));
    expect(inv.filterComplex).not.toContain("setpts=PTS/");
  });

  it("原生音轨视频永不变速（避免音画不同步）", () => {
    const inv = buildComposeInvocation(cfg({ sourceDuration: 5, hasAudio: true }));
    expect(inv.filterComplex).not.toContain("setpts=PTS/");
  });

  it("源略短于槽位（≥70%）→ setpts 慢放补齐，消灭冻帧尾巴", () => {
    // 3s source in a 4s slot: ratio 0.75 → setpts=PTS/0.7500 stretches real motion across the slot
    const inv = buildComposeInvocation(cfg({ sourceDuration: 3 }));
    expect(inv.filterComplex).toContain("setpts=PTS/0.7500");
  });

  it("源远短于槽位（<70%）→ 退回冻帧补齐，不做糖浆感慢放", () => {
    const inv = buildComposeInvocation(cfg({ sourceDuration: 4 * SPEEDFIT_MIN_RATIO * 0.8 }));
    expect(inv.filterComplex).not.toContain("setpts=PTS/");
    expect(inv.filterComplex).toContain("tpad=stop_mode=clone");
  });

  it("源短但带原生音轨 → 不慢放（避免音画不同步）", () => {
    const inv = buildComposeInvocation(cfg({ sourceDuration: 3, hasAudio: true }));
    expect(inv.filterComplex).not.toContain("setpts=PTS/");
  });

  it("未提供 sourceDuration（旧素材/探测失败）→ 行为与原先一致", () => {
    const inv = buildComposeInvocation(cfg({}));
    expect(inv.filterComplex).not.toContain("setpts=PTS/");
  });
});

describe("链式首尾帧辅助函数", () => {
  const shot = (shotId: number, over: Partial<Shot> = {}): Shot =>
    ({
      shotId,
      type: "demo",
      duration: 4,
      description: `镜头${shotId}`,
      camera: "",
      visualSource: "ai_generate",
      transition: "ai_start_end",
      voiceover: "",
      ...over,
    }) as Shot;

  it("nextChainKeyframe：下一镜为已完成静态图 → 返回其图 URL", () => {
    const rows = buildAssetRows(
      [shot(1), shot(2)],
      [
        { shotId: 1, filePath: "/api/files/p/a1.png", status: "done" },
        { shotId: 2, filePath: "/api/files/p/a2.png", status: "done" },
      ],
      []
    );
    expect(nextChainKeyframe(rows, 1)).toBe("/api/files/p/a2.png");
  });

  it("nextChainKeyframe：下一镜是无关键帧记录的视频/未完成/不存在 → undefined", () => {
    const rows = buildAssetRows(
      [shot(1), shot(2), shot(3)],
      [
        { shotId: 1, filePath: "/api/files/p/a1.png", status: "done" },
        { shotId: 2, filePath: "/api/files/p/a2.mp4", status: "done" },
      ],
      []
    );
    expect(nextChainKeyframe(rows, 1)).toBeUndefined(); // next is a video without a recorded keyframe
    expect(nextChainKeyframe(rows, 2)).toBeUndefined(); // next is pending
    expect(nextChainKeyframe(rows, 3)).toBeUndefined(); // last shot
  });

  it("nextChainKeyframe：下一镜已是视频但落库过来源关键帧 → 用关键帧接力链式（重跑不掉链）", () => {
    const rows = buildAssetRows(
      [shot(1), shot(2)],
      [
        { shotId: 1, filePath: "/api/files/p/a1.png", status: "done" },
        { shotId: 2, filePath: "/api/files/p/a2.mp4", status: "done", thumbnailPath: "/api/files/p/kf2.png" },
      ],
      []
    );
    expect(rows[1].keyframeUrl).toBe("/api/files/p/kf2.png");
    expect(nextChainKeyframe(rows, 1)).toBe("/api/files/p/kf2.png");
  });

  it("modelSupportsLastFrame：Seedance 2.0/2.5 家族与 ai_start_end 白名单支持，其他不支持", () => {
    expect(modelSupportsLastFrame("bytedance/seedance-2.0-fast/image-to-video")).toBe(true);
    expect(modelSupportsLastFrame("bytedance/seedance-2.0/image-to-video")).toBe(true);
    // Seedance 2.5 schema exposes last_image too (verified against the official schema, 2026-08)
    expect(modelSupportsLastFrame("bytedance/seedance-2.5/image-to-video")).toBe(true);
    expect(modelSupportsLastFrame("vidu/q3-pro/start-end-to-video")).toBe(true);
    // v0.8.76 new families with a pinned-last-frame param per published schema
    expect(modelSupportsLastFrame("minimax/h3/image-to-video")).toBe(true);
    expect(modelSupportsLastFrame("kwaivgi/kling-video-o3-std/image-to-video")).toBe(true);
    expect(modelSupportsLastFrame("google/veo3.1/image-to-video")).toBe(true);
    expect(modelSupportsLastFrame("alibaba/wan-2.7/image-to-video")).toBe(true);
    expect(modelSupportsLastFrame("bytedance/seedance-2.0-mini/image-to-video")).toBe(true);
    expect(modelSupportsLastFrame("bytedance/seedance-2.0-mini")).toBe(true); // OpenRouter family endpoint
    expect(modelSupportsLastFrame("bytedance/seedance-2.0-mini/reference-to-video")).toBe(false);
    expect(modelSupportsLastFrame("bytedance/seedance-2.5/text-to-video")).toBe(false);
    // Hailuo 2.3 has no last-frame param; Kling v3.0 never did
    expect(modelSupportsLastFrame("minimax/hailuo-2.3/i2v-standard")).toBe(false);
    expect(modelSupportsLastFrame("kwaivgi/kling-v3.0-std/image-to-video")).toBe(false);
    expect(modelSupportsLastFrame("")).toBe(false);
  });

  it("chainToNext 提示词：加入首尾帧过渡引导（中英）", () => {
    const zh = buildMotionPrompt({ shotType: "demo", description: "使用演示", chainToNext: true });
    expect(zh).toContain("过渡到指定的尾帧画面");
    const en = buildMotionPrompt({ shotType: "demo", description: "a hands-on demo", chainToNext: true });
    expect(en).toContain("into the specified last frame");
    expect(buildMotionPrompt({ shotType: "demo", description: "使用演示" })).not.toContain("尾帧");
  });
});
