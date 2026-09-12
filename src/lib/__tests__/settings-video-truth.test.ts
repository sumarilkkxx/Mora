import { beforeEach, describe, expect, it } from "vitest";
import { buildVideoOptions, DEFAULT_VIDEO_PARAMS } from "@/lib/gen-params";
import { migrateSettings, useSettingsStore } from "@/lib/stores/settings-store";

describe("video settings use one authoritative state", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      defaultResolution: "1080p",
      defaultAspectRatio: "9:16",
      videoParams: { aspectRatio: "9:16", resolution: "1080p", duration: 5 },
    });
  });

  it("syncs prominent resolution/aspect controls into generation params", () => {
    useSettingsStore.getState().setDefaultResolution("720p");
    useSettingsStore.getState().setDefaultAspectRatio("16:9");
    const state = useSettingsStore.getState();
    expect(state.videoParams).toMatchObject({ resolution: "720p", aspectRatio: "16:9" });
    expect(buildVideoOptions(state.videoParams)).toMatchObject({ width: 1280, height: 720 });
  });

  it("syncs advanced generation controls back into the prominent fields", () => {
    useSettingsStore.getState().setVideoParams({
      resolution: "1080p", aspectRatio: "1:1", duration: 12, seed: 42,
    });
    const state = useSettingsStore.getState();
    expect(state.defaultResolution).toBe("1080p");
    expect(state.defaultAspectRatio).toBe("1:1");
    expect(buildVideoOptions(state.videoParams)).toEqual({
      width: 1080, height: 1080, duration: 12, seed: 42,
    });
  });

  it("repairs old persisted states whose duplicate controls disagreed", () => {
    const old = {
      ...useSettingsStore.getState(),
      defaultResolution: "720p" as const,
      defaultAspectRatio: "16:9" as const,
      videoParams: { resolution: "1080p" as const, aspectRatio: "9:16" as const, duration: 8 },
    };
    const migrated = migrateSettings(old);
    expect(migrated.videoParams).toMatchObject({ resolution: "720p", aspectRatio: "16:9", duration: 8 });
  });

  it("defaults new installs to 720p and preserves an existing 1080p preference", () => {
    expect(DEFAULT_VIDEO_PARAMS.resolution).toBe("720p");
    const existing = { ...useSettingsStore.getState(), spendCapUsd: undefined } as unknown as Parameters<typeof migrateSettings>[0];
    const migrated = migrateSettings(existing);
    expect(migrated.defaultResolution).toBe("1080p");
    expect(migrated.videoParams.resolution).toBe("1080p");
    expect(migrated.spendCapUsd).toBe(5);
  });

  it("persists the execution provider alongside a duplicate video model id", () => {
    useSettingsStore.getState().setDefaultVideoModel(
      "bytedance/seedance-2.0-mini/reference-to-video",
      "atlas-cloud"
    );
    expect(useSettingsStore.getState()).toMatchObject({
      defaultVideoModel: "bytedance/seedance-2.0-mini/reference-to-video",
      defaultVideoProvider: "atlas-cloud",
    });
  });

  it("restores the real Atlas Cloud provider while continuing to remove the unsupported fal.ai provider", () => {
    const old = {
      ...useSettingsStore.getState(),
      providers: { "fal-ai": { enabled: true, apiKey: "old" } },
      customModels: [
        { id: "atlas", provider: "atlas-cloud", modelId: "bytedance/seedance-2.0-mini/reference-to-video", name: "Atlas Mini", mediaType: "video" as const },
        { id: "fal", provider: "fal-ai", modelId: "x", name: "fal", mediaType: "video" as const },
      ],
    };
    const migrated = migrateSettings(old);
    expect(migrated.providers["atlas-cloud"]).toEqual({ enabled: false, apiKey: "" });
    expect(migrated.providers["fal-ai"]).toBeUndefined();
    expect(migrated.customModels.map((model) => model.id)).toEqual(["atlas"]);
  });
});
