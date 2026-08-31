import { describe, it, expect } from "vitest";
import {
  buildStoryboardFilmPrompt,
  dialogueDensityWarnings,
  filmTotalSeconds,
  filmRequestSeconds,
  FILM_MAX_SECONDS,
} from "@/lib/storyboard-film";
import type { Shot, ScriptCharacter } from "@/lib/db/schema";

/**
 * Grid-to-film prompt contract (v0.8.84). The exact shape was field-proven on a
 * real product (2026-08): timecoded segments + @ImageN citations + per-segment
 * dialogue produced native 4-shot cutting with verbatim speech on Seedance 2.5
 * reference-to-video. These tests pin that shape.
 */

function mkShot(partial: Partial<Shot> & { shotId: number }): Shot {
  return {
    type: "hook",
    duration: 3,
    description: "画面",
    camera: "固定",
    visualSource: "ai_generate",
    transition: "direct_concat",
    voiceover: "",
    ...partial,
  } as Shot;
}

const zhShots: Shot[] = [
  mkShot({ shotId: 1, type: "hook", duration: 3, description: "厨房口播", voiceover: "就这玩意儿救了我的钱包" }),
  mkShot({ shotId: 2, type: "demo", duration: 5, description: "挤咖啡液入冰水", voiceover: "" }),
  mkShot({ shotId: 3, type: "cta", duration: 4, description: "举盒收尾", voiceover: "链接挂这了" }),
];

describe("时长计算", () => {
  it("filmTotalSeconds 求和；filmRequestSeconds 取整并夹在 4-30", () => {
    expect(filmTotalSeconds(zhShots)).toBe(12);
    expect(filmRequestSeconds(zhShots)).toBe(12);
    expect(filmRequestSeconds([mkShot({ shotId: 1, duration: 2 })])).toBe(4);
    expect(
      filmRequestSeconds([mkShot({ shotId: 1, duration: 45 })])
    ).toBe(FILM_MAX_SECONDS);
  });
});

describe("中文整片 prompt", () => {
  const prompt = buildStoryboardFilmPrompt(zhShots);

  it("逐镜 @图片N 引用 + 类型标签 + 时间段按脚本时长铺满全片", () => {
    expect(prompt).toContain("[0-3秒] 镜头1（钩子镜，画面以 @图片1 为基准）");
    expect(prompt).toContain("[3-8秒] 镜头2（演示镜，画面以 @图片2 为基准）");
    expect(prompt).toContain("[8-12秒] 镜头3（转化镜，画面以 @图片3 为基准）");
    expect(prompt).toContain("总时长约 12 秒，共 3 个镜头");
  });

  it("台词走官方 {} 括号语法进段落；无台词镜头明确只留环境音", () => {
    expect(prompt).toContain("{就这玩意儿救了我的钱包}");
    expect(prompt).toContain("{链接挂这了}");
    expect(prompt).toContain("（无台词，只保留环境音与动作声）");
  });

  it("全局块：一致性 + 口语说话方式 + 无字幕水印 + 官方音频负控", () => {
    expect(prompt).toContain("同一人物");
    expect(prompt).toContain("逐字说出");
    expect(prompt).toContain("不出现任何字幕");
    // 官方负向通道只覆盖字幕与音频：bgm 交给合成器权威层
    expect(prompt).toContain("无bgm");
  });

  it("素材绑定段：无 sheet 时 @图片1..N 顺序声明为关键帧", () => {
    expect(prompt).toContain("素材对应：@图片1 至 @图片3 依次为镜头1至镜头3的关键帧");
  });

  it("质感行默认带真实手机直出（全正向措辞）；realism:false 时不出现", () => {
    expect(prompt).toContain("真实手机直出质感");
    expect(prompt).toContain("保留毛孔细节");
    const styled = buildStoryboardFilmPrompt(zhShots, undefined, undefined, { realism: false });
    expect(styled).not.toContain("真实手机直出质感");
  });

  it("唯一具名角色时台词归属到角色名", () => {
    const withCast = buildStoryboardFilmPrompt(zhShots, [{ name: "小夏", appearance: "邻家" } as never]);
    expect(withCast).toContain("小夏对着镜头自然说话");
  });

  it("脚本里的运镜逐段带进整片（有才带，空 camera 不出现残段）", () => {
    const withCam = buildStoryboardFilmPrompt([
      mkShot({ shotId: 1, camera: "缓慢推近", voiceover: "开场" }),
      mkShot({ shotId: 2, camera: "", voiceover: "" }),
    ]);
    expect(withCam).toContain("运镜：缓慢推近。");
    // 第二镜没有运镜 → 不该出现空的「运镜：」残段
    expect(withCam.match(/运镜：/g)?.length).toBe(1);
  });
});

describe("英文整片 prompt（台词无中文时整体切英文）", () => {
  const enShots: Shot[] = [
    mkShot({ shotId: 1, type: "hook", duration: 6, description: "kitchen talking head", voiceover: "This thing saved my wallet" }),
    mkShot({ shotId: 2, type: "demo", duration: 6, description: "pouring coffee", voiceover: "" }),
  ];
  const prompt = buildStoryboardFilmPrompt(enShots);

  it("@ImageN 引用 + 逐字口播说明 + 时间段 + 台词语言声明", () => {
    expect(prompt).toContain("[0-6s] Shot 1 (hook shot, framing follows @Image1)");
    expect(prompt).toContain("Dialogue (spoken verbatim): {This thing saved my wallet}");
    expect(prompt).toContain("(no dialogue — ambient and action sounds only)");
    // 官方要求非中文台词显式声明语言
    expect(prompt).toContain("Dialogue language: English.");
    expect(prompt).toContain("Reference mapping: @Image1 through @Image2");
    expect(prompt).not.toContain("镜头");
  });

  it("英文段落同样带运镜", () => {
    const withCam = buildStoryboardFilmPrompt([
      mkShot({ shotId: 1, description: "kitchen", camera: "slow push-in", voiceover: "Hi" }),
    ]);
    expect(withCam).toContain("Camera: slow push-in. ");
  });
});

describe("定妆参考位（characterSheet 序号偏移）", () => {
  it("sheet 领跑参考数组：@图片1=定妆照声明，分镜引用整体 +1，绑定段同步偏移", () => {
    const prompt = buildStoryboardFilmPrompt(zhShots, undefined, { characterSheet: true });
    expect(prompt).toContain("@图片1 是出镜人物的四视图定妆照");
    expect(prompt).toContain("镜头1（钩子镜，画面以 @图片2 为基准）");
    expect(prompt).toContain("镜头3（转化镜，画面以 @图片4 为基准）");
    expect(prompt).not.toContain("画面以 @图片1 为基准");
    expect(prompt).toContain("素材对应：@图片1 是出镜人物定妆照（仅作身份参考）；@图片2 至 @图片4");
  });

  it("无 sheet 时不出现定妆声明，分镜仍从 @图片1 起", () => {
    const prompt = buildStoryboardFilmPrompt(zhShots);
    expect(prompt).not.toContain("定妆照");
    expect(prompt).toContain("画面以 @图片1 为基准");
  });
});

describe("台词密度检查（官方口型漂移预防，只拦极端超载）", () => {
  it("中文按 5 字/秒上限：正常台词不报警，塞爆的报警并给出计数", () => {
    // 3 秒 × 5 = 15 字上限；「就这玩意儿救了我的钱包」11 个可读字符 → 不报警
    expect(dialogueDensityWarnings(zhShots)).toEqual([]);
    const stuffed = [
      mkShot({ shotId: 1, duration: 2, voiceover: "这一句话实在是太长了根本不可能在两秒钟之内自然说完它" }),
    ];
    const warns = dialogueDensityWarnings(stuffed);
    expect(warns).toHaveLength(1);
    expect(warns[0].index).toBe(0);
    expect(warns[0].limit).toBe(10);
    expect(warns[0].count).toBeGreaterThan(10);
  });

  it("英文按 2.6 词/秒上限；无台词与零时长镜头跳过", () => {
    const en = [
      mkShot({ shotId: 1, duration: 2, description: "kitchen", voiceover: "this is way way too many words to say naturally in two short seconds honestly" }),
      mkShot({ shotId: 2, duration: 0, description: "kitchen", voiceover: "ignored" }),
      mkShot({ shotId: 3, duration: 3, description: "kitchen", voiceover: "" }),
    ];
    const warns = dialogueDensityWarnings(en);
    expect(warns).toHaveLength(1);
    expect(warns[0].limit).toBe(6);
  });
});

describe("超长脚本的时间轴缩放", () => {
  it("原始 40 秒按比例压进 30 秒，最后一段结尾恰好等于总时长", () => {
    const long: Shot[] = [
      mkShot({ shotId: 1, duration: 20, voiceover: "上半场" }),
      mkShot({ shotId: 2, duration: 20, voiceover: "下半场" }),
    ];
    const prompt = buildStoryboardFilmPrompt(long);
    expect(prompt).toContain("[0-15秒] 镜头1");
    expect(prompt).toContain("[15-30秒] 镜头2");
  });
});

describe("多角色说话人归属与参考绑定纪律", () => {
  const twoCast: ScriptCharacter[] = [
    { id: "char_a", name: "小美", gender: "female", persona: "毒舌闺蜜", appearance: "32岁低马尾，日常淡妆，浅色居家服" },
    { id: "char_b", name: "大壮", gender: "male", persona: "嘴硬心软", appearance: "30岁短发，格子衬衫" },
  ];
  const shots = [
    mkShot({ shotId: 1, type: "hook", voiceover: "你这纸巾一擦就破？", characterId: "char_a" }),
    mkShot({ shotId: 2, type: "demo", voiceover: "那你试试这个。", characterId: "char_b" }),
    mkShot({ shotId: 3, type: "cta", voiceover: "链接放这了。" }),
  ] as Shot[];

  it("双角色：人物设定块列全员外观 + 方向词约定 + 台词行按角色归属（带一句短锚）", () => {
    const p = buildStoryboardFilmPrompt(shots, twoCast);
    expect(p).toContain("人物设定（下文提到角色一律用角色名指代");
    expect(p).toContain("左/右一律指画面方向");
    expect(p).toContain("小美（32岁低马尾，日常淡妆，浅色居家服）");
    expect(p).toContain("由小美（32岁低马尾）说出）：{你这纸巾一擦就破？}");
    expect(p).toContain("由大壮（30岁短发）说出）：{那你试试这个。}");
    // 旁白镜（无 characterId）不归属到任何角色
    expect(p).toContain("台词（逐字说出）：{链接放这了。}");
    // 多角色时全局说话行改为「按标注角色说出」
    expect(p).toContain("由该镜标注的角色自然说出台词");
  });

  it("双角色 + 定妆照：声明后跟背景剥离句（不得带入影棚灰底/分格）", () => {
    const p = buildStoryboardFilmPrompt(shots, twoCast, { characterSheet: true });
    expect(p).toContain("不得把定妆照的浅灰影棚背景、四格分格或边框带进任何镜头画面");
  });

  it("单角色不回归：仍走 soloName 说话行，台词行不加归属短锚", () => {
    const solo: ScriptCharacter[] = [{ id: "char_a", name: "小美", gender: "female", persona: "", appearance: "32岁低马尾" }];
    const p = buildStoryboardFilmPrompt(shots.slice(0, 1), solo);
    expect(p).toContain("小美对着镜头自然说话");
    expect(p).toContain("台词（逐字说出）：{你这纸巾一擦就破？}");
    expect(p).not.toContain("由小美");
    // 单角色也有人物设定块（外观锚仍有跨镜价值）
    expect(p).toContain("人物设定（下文提到角色一律用角色名指代");
  });

  it("单角色 + 定妆照：声明句点名该角色", () => {
    const solo: ScriptCharacter[] = [{ id: "char_a", name: "小美", gender: "female", persona: "", appearance: "32岁低马尾" }];
    const p = buildStoryboardFilmPrompt(shots.slice(0, 1), solo, { characterSheet: true });
    expect(p).toContain("@图片1 是小美的四视图定妆照");
  });

  it("英文脚本：cast 块与逐行归属走英文", () => {
    const enShots = [
      mkShot({ shotId: 1, description: "girl reacts", camera: "push in", voiceover: "This tissue tears instantly?", characterId: "char_a" }),
      mkShot({ shotId: 2, description: "guy demos", camera: "follow", voiceover: "Try this one.", characterId: "char_b" }),
    ] as Shot[];
    const enCast: ScriptCharacter[] = [
      { id: "char_a", name: "Mia", gender: "female", persona: "", appearance: "early 30s, low ponytail, light makeup" },
      { id: "char_b", name: "Ben", gender: "male", persona: "", appearance: "30s, short hair, plaid shirt" },
    ];
    const p = buildStoryboardFilmPrompt(enShots, enCast);
    expect(p).toContain("Cast (refer to characters strictly by these names");
    expect(p).toContain("spoken verbatim by Mia (early 30s");
    expect(p).toContain("the character named on that shot speaks the line verbatim");
  });
});

describe("referenceQuotaCheck（付费前参考图配额闸）", () => {
  it("按平台端点执行 Seedance 参考图上限，付费前拦截", async () => {
    const { referenceQuotaCheck } = await import("@/lib/storyboard-film");
    expect(referenceQuotaCheck(50, "bytedance/seedance-2.5")).toEqual({ ok: true, count: 50, limit: 50 });
    expect(referenceQuotaCheck(51, "bytedance/seedance-2.5")).toEqual({ ok: false, count: 51, limit: 50 });
    expect(referenceQuotaCheck(30, "bytedance/seedance-2.5/reference-to-video")).toEqual({ ok: true, count: 30, limit: 30 });
    expect(referenceQuotaCheck(31, "bytedance/seedance-2.5/reference-to-video")).toEqual({ ok: false, count: 31, limit: 30 });
    expect(referenceQuotaCheck(9, "bytedance/seedance-2.0-mini/reference-to-video")).toEqual({ ok: true, count: 9, limit: 9 });
    expect(referenceQuotaCheck(10, "bytedance/seedance-2.0-mini/reference-to-video")).toEqual({ ok: false, count: 10, limit: 9 });
  });
  it("无已知上限的模型不拦（拿不准就放行）", async () => {
    const { referenceQuotaCheck } = await import("@/lib/storyboard-film");
    expect(referenceQuotaCheck(99, "some/unknown-model")).toEqual({ ok: true, count: 99 });
    expect(referenceQuotaCheck(99, "minimax/h3/reference-to-video").ok).toBe(true);
  });
});

describe("resolveStoryboardFilmModel", () => {
  it("preserves the exact OpenRouter model selected by the user", async () => {
    const { resolveStoryboardFilmModel } = await import("@/lib/storyboard-film");
    expect(resolveStoryboardFilmModel("openrouter", "bytedance/seedance-2.0")).toBe("bytedance/seedance-2.0");
    expect(resolveStoryboardFilmModel("openrouter", "google/veo-3.1")).toBe("google/veo-3.1");
    expect(resolveStoryboardFilmModel("openrouter", "")).toBe("");
  });

  it("repairs legacy OpenRouter reference-to-video suffixes", async () => {
    const { resolveStoryboardFilmModel } = await import("@/lib/storyboard-film");
    expect(resolveStoryboardFilmModel("openrouter", "bytedance/seedance-2.5/reference-to-video"))
      .toBe("bytedance/seedance-2.5");
    expect(resolveStoryboardFilmModel("openrouter", "bytedance/seedance-2.0-fast/reference-to-video"))
      .toBe("bytedance/seedance-2.0-fast");
  });

  it("normalizes legacy Atlas endpoint selections to the auto-routed family", async () => {
    const { resolveStoryboardFilmModel } = await import("@/lib/storyboard-film");
    expect(resolveStoryboardFilmModel("atlas-cloud", "bytedance/seedance-2.5/image-to-video"))
      .toBe("bytedance/seedance-2.5");
    expect(resolveStoryboardFilmModel("atlas-cloud", "bytedance/seedance-2.0-fast/reference-to-video"))
      .toBe("bytedance/seedance-2.0-fast");
  });

  it("does not rewrite another provider's model contract", async () => {
    const { resolveStoryboardFilmModel } = await import("@/lib/storyboard-film");
    expect(resolveStoryboardFilmModel("volcengine", "doubao-seedance-custom"))
      .toBe("doubao-seedance-custom");
  });
});

describe("film duration capability mapping", () => {
  it("selects the closest live provider duration and prefers the lower value on ties", async () => {
    const { closestSupportedFilmDuration } = await import("@/lib/storyboard-film");
    expect(closestSupportedFilmDuration(30, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])).toBe(15);
    expect(closestSupportedFilmDuration(7, [6, 8])).toBe(6);
    expect(closestSupportedFilmDuration(7, [])).toBe(7);
  });

  it("maps resolution/aspect settings explicitly and preserves supported values", async () => {
    const {
      supportedVideoSetting,
      videoRequestAspectRatio,
      videoRequestDimensions,
      videoRequestResolution,
    } = await import("@/lib/storyboard-film");
    expect(videoRequestResolution(1080, 1920)).toBe("1080p");
    expect(videoRequestAspectRatio(1080, 1920)).toBe("9:16");
    expect(supportedVideoSetting("1080p", ["480p", "720p"], "720p")).toBe("720p");
    expect(supportedVideoSetting("16:9", ["16:9", "9:16"], "9:16")).toBe("16:9");
    expect(videoRequestDimensions("720p", "16:9")).toEqual({ width: 1280, height: 720 });
  });

  it("scales prompt shot timing to the effective model duration", async () => {
    const { fitFilmShotsToDuration, filmTotalSeconds } = await import("@/lib/storyboard-film");
    const shots = [mkShot({ shotId: 1, duration: 10 }), mkShot({ shotId: 2, duration: 20 })] as Shot[];
    const fitted = fitFilmShotsToDuration(shots, 15);
    expect(filmTotalSeconds(fitted)).toBe(15);
    expect(fitted.map((shot) => shot.duration)).toEqual([5, 10]);
  });
});
