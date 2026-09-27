// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelCapabilityPreflight } from "@/components/model-capability-preflight";
import { resolveCapabilityContract } from "@/lib/provider-capability-contract";
import { useSettingsStore } from "@/lib/stores/settings-store";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useSettingsStore.setState({ locale: "zh" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("ModelCapabilityPreflight", () => {
  it("explains unsupported settings before submission and shows recovery truth", async () => {
    const contract = resolveCapabilityContract({
      capability: "video",
      provider: "atlas-cloud",
      modelId: "bytedance/seedance-2.0-mini",
      supportsAudio: true,
    });
    await act(async () => root.render(<ModelCapabilityPreflight
      modelId={contract.modelId}
      duration={30}
      resolution="1080p"
      aspectRatio="9:16"
      chainMode="pin"
      contract={contract}
    />));
    expect(host.textContent).toContain("当前组合不受支持");
    expect(host.textContent).toContain("任务 ID 会先落盘");
    expect(host.textContent).toContain("duration: 30");
  });
});
