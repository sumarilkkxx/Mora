import { describe, it, expect } from "vitest";
import { STOCK_SOURCES } from "@/lib/providers/stock-types";
import { searchStock } from "@/lib/providers/stock-registry";
import { toCoverrCandidate, type CoverrVideo } from "@/lib/providers/coverr";
import {
  isCommerceSafeCcUrl,
  jamendoLicenseName,
  toJamendoCandidate,
  type JamendoTrack,
} from "@/lib/providers/jamendo";
import {
  freesoundLicenseInfo,
  toFreesoundCandidate,
  type FreesoundSound,
} from "@/lib/providers/freesound";
import { classifyLicense } from "@/lib/asset-credits";

describe("新素材源注册", () => {
  it("coverr/jamendo/freesound 进入源清单，均带 envKey 与 signupUrl", () => {
    for (const id of ["coverr", "jamendo", "freesound"] as const) {
      const meta = STOCK_SOURCES.find((s) => s.id === id);
      expect(meta, id).toBeDefined();
      expect(meta!.keyless).toBe(false);
      expect(meta!.envKey).toBeTruthy();
      expect(meta!.signupUrl).toBeTruthy();
    }
  });

  it("媒体类型匹配：coverr 仅视频、jamendo/freesound 仅音频（不匹配时静默返回空）", async () => {
    expect(await searchStock("coverr", "x", { mediaType: "audio", apiKeys: { coverr: "k" } })).toEqual([]);
    expect(await searchStock("jamendo", "x", { mediaType: "video", apiKeys: { jamendo: "k" } })).toEqual([]);
    expect(await searchStock("freesound", "x", { mediaType: "image", apiKeys: { freesound: "k" } })).toEqual([]);
  });
});

describe("Coverr 归一化", () => {
  const base: CoverrVideo = {
    id: "abc123",
    title: "Pouring coffee",
    duration: 12.5,
    max_width: 1080,
    max_height: 1920,
    poster: "https://storage.coverr.co/p/abc123",
    urls: { mp4: "https://cdn/x.mp4", mp4_download: "https://cdn/x_dl.mp4" },
  };

  it("优先下载链接、署名 Coverr、requiresAttribution=true", () => {
    const c = toCoverrCandidate(base)!;
    expect(c.downloadUrl).toBe("https://cdn/x_dl.mp4");
    expect(c.source).toBe("coverr");
    expect(c.requiresAttribution).toBe(true);
    expect(c.license).toBe("Coverr");
    expect(c.width).toBe(1080);
    expect(c.height).toBe(1920);
  });

  it("无可下载 URL 时返回 null", () => {
    expect(toCoverrCandidate({ id: "no-urls" })).toBeNull();
  });
});

describe("Jamendo 授权过滤（商用安全=纯 CC-BY）", () => {
  it("isCommerceSafeCcUrl：BY 通过，NC/ND/SA/未知全部拒绝", () => {
    expect(isCommerceSafeCcUrl("http://creativecommons.org/licenses/by/3.0/")).toBe(true);
    expect(isCommerceSafeCcUrl("https://creativecommons.org/licenses/by/4.0/")).toBe(true);
    expect(isCommerceSafeCcUrl("http://creativecommons.org/licenses/by-nc/3.0/")).toBe(false);
    expect(isCommerceSafeCcUrl("http://creativecommons.org/licenses/by-nd/3.0/")).toBe(false);
    expect(isCommerceSafeCcUrl("http://creativecommons.org/licenses/by-sa/3.0/")).toBe(false);
    expect(isCommerceSafeCcUrl(undefined)).toBe(false);
  });

  it("jamendoLicenseName 解析版本号", () => {
    expect(jamendoLicenseName("http://creativecommons.org/licenses/by/3.0/")).toBe("CC BY 3.0");
    expect(jamendoLicenseName("bad")).toBe("unknown");
  });

  it("toJamendoCandidate：NC 曲目被丢弃，BY 曲目带署名文本", () => {
    const byTrack: JamendoTrack = {
      id: "t1",
      name: "Sunrise",
      artist_name: "Alice",
      artist_id: "a9",
      duration: 120,
      audio: "https://stream/t1.mp3",
      audiodownload: "https://dl/t1.mp3",
      audiodownload_allowed: true,
      license_ccurl: "http://creativecommons.org/licenses/by/3.0/",
      shareurl: "https://www.jamendo.com/track/t1",
    };
    const c = toJamendoCandidate(byTrack)!;
    expect(c.downloadUrl).toBe("https://dl/t1.mp3");
    expect(c.requiresAttribution).toBe(true);
    expect(c.attributionText).toContain("Alice");
    expect(c.authorUrl).toContain("/artist/a9");

    const ncTrack = { ...byTrack, license_ccurl: "http://creativecommons.org/licenses/by-nc/3.0/" };
    expect(toJamendoCandidate(ncTrack)).toBeNull();
  });

  it("下载不允许时回落到流媒体 URL", () => {
    const t: JamendoTrack = {
      id: "t2",
      name: "Dusk",
      audio: "https://stream/t2.mp3",
      audiodownload: "https://dl/t2.mp3",
      audiodownload_allowed: false,
      license_ccurl: "http://creativecommons.org/licenses/by/3.0/",
    };
    expect(toJamendoCandidate(t)!.downloadUrl).toBe("https://stream/t2.mp3");
  });
});

describe("Freesound 授权过滤", () => {
  it("freesoundLicenseInfo：CC0 免署名、CC-BY 需署名、其余拒绝", () => {
    expect(freesoundLicenseInfo("http://creativecommons.org/publicdomain/zero/1.0/")).toEqual({
      name: "CC0",
      commerceSafe: true,
      requiresAttribution: false,
    });
    expect(freesoundLicenseInfo("http://creativecommons.org/licenses/by/4.0/").requiresAttribution).toBe(true);
    expect(freesoundLicenseInfo("http://creativecommons.org/licenses/by-nc/4.0/").commerceSafe).toBe(false);
    expect(freesoundLicenseInfo(undefined).commerceSafe).toBe(false);
  });

  it("toFreesoundCandidate：取 HQ 预览直链；无预览或 NC 返回 null", () => {
    const s: FreesoundSound = {
      id: 7,
      name: "box open",
      username: "bob",
      duration: 2.1,
      license: "http://creativecommons.org/publicdomain/zero/1.0/",
      url: "https://freesound.org/s/7/",
      previews: { "preview-hq-mp3": "https://cdn/7-hq.mp3", "preview-lq-mp3": "https://cdn/7-lq.mp3" },
    };
    const c = toFreesoundCandidate(s)!;
    expect(c.downloadUrl).toBe("https://cdn/7-hq.mp3");
    expect(c.requiresAttribution).toBe(false);

    expect(toFreesoundCandidate({ ...s, previews: undefined })).toBeNull();
    expect(
      toFreesoundCandidate({ ...s, license: "http://creativecommons.org/licenses/by-nc/4.0/" })
    ).toBeNull();
  });
});

describe("授权清单联动", () => {
  it("classifyLicense：Coverr 记为需署名、可商用", () => {
    expect(classifyLicense("Coverr")).toEqual({ risk: "attribution", requiresAttribution: true });
  });
});
