import { describe, it, expect } from "vitest";
import { stylePrompts, styleNameMap, styleFormGroups, type ScriptStyleType } from "@/lib/script-engine/prompts";
import { validateCharacters } from "@/lib/script-engine/generator";
import { assignCharacterVoices } from "@/lib/character-voices";
import type { ScriptCharacter } from "@/lib/db/schema";

describe("十风格体系（剧情形/物品形/口播形/场景形）", () => {
  const nonCustom = (Object.keys(styleNameMap) as ScriptStyleType[]).filter((s) => s !== "custom");

  it("每个非 custom 风格都有提示词与显示名", () => {
    for (const s of nonCustom) {
      expect(stylePrompts[s as Exclude<ScriptStyleType, "custom">]?.length, s).toBeGreaterThan(100);
      expect(styleNameMap[s].length, s).toBeGreaterThan(0);
    }
  });

  it("形态分组恰好覆盖全部非 custom 风格且不重复", () => {
    const grouped = styleFormGroups.flatMap((g) => g.styles);
    expect([...grouped].sort()).toEqual([...nonCustom].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("对话类风格（drama/interview/product_pov）的提示词都要求输出 characters", () => {
    for (const s of ["drama", "interview", "product_pov"] as const) {
      expect(stylePrompts[s], s).toContain("characters");
      expect(stylePrompts[s], s).toContain("characterId");
    }
  });

  it("非对话类风格不强制 characters（unboxing 明确单人无角色）", () => {
    expect(stylePrompts.unboxing).toContain("无需 characters");
  });
});

describe("validateCharacters（LLM 人物数组解析）", () => {
  it("合法数组保留字段、非法条目丢弃、上限 4 个", () => {
    const raw = [
      { id: "char_a", name: "小美", gender: "female", persona: "毒舌", appearance: "黑长直" },
      { id: "", name: "无ID" },
      { id: "char_b", name: "大壮", gender: "male" },
      "not-an-object",
      { id: "c3", name: "三" },
      { id: "c4", name: "四" },
      { id: "c5", name: "五" },
    ];
    const out = validateCharacters(raw)!;
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ id: "char_a", name: "小美", gender: "female", persona: "毒舌", appearance: "黑长直" });
    expect(out[1].gender).toBe("male");
  });

  it("未知 gender 回退 female；空数组/非数组 → undefined", () => {
    expect(validateCharacters([{ id: "a", name: "x", gender: "robot" }])![0].gender).toBe("female");
    expect(validateCharacters([])).toBeUndefined();
    expect(validateCharacters("nope")).toBeUndefined();
  });
});

describe("assignCharacterVoices（免费多音色分配）", () => {
  const cast = (n: number, gender: "female" | "male"): ScriptCharacter[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${gender}_${i}`, name: `角色${i}`, gender }));

  it("同性别角色分到互不相同的音色", () => {
    const m = assignCharacterVoices(cast(3, "female"));
    expect(new Set(m.values()).size).toBe(3);
  });

  it("确定性：同一 cast 两次分配结果一致（重合成不换声）", () => {
    const c = [...cast(2, "female"), ...cast(2, "male")];
    expect([...assignCharacterVoices(c)]).toEqual([...assignCharacterVoices(c)]);
  });

  it("女声池首位不是默认旁白晓晓（对话角色不能与旁白同声）", () => {
    const m = assignCharacterVoices(cast(1, "female"));
    expect([...m.values()][0]).not.toBe("zh-CN-XiaoxiaoNeural");
  });

  it("男女混排各用各池；重复 id 只分配一次", () => {
    const c: ScriptCharacter[] = [
      { id: "a", name: "A", gender: "female" },
      { id: "b", name: "B", gender: "male" },
      { id: "a", name: "A2", gender: "female" },
    ];
    const m = assignCharacterVoices(c);
    expect(m.size).toBe(2);
    expect(m.get("a")).toMatch(/Xiaoyi|Xiaobei|Xiaoni/);
    expect(m.get("b")).toMatch(/Yunxi|Yunjian|Yunyang/);
  });
});
