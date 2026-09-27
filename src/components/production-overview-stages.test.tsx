// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProductionOverviewStages } from "@/components/production-overview-stages";
import { deriveProductionOverview } from "@/lib/production-overview";
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

describe("ProductionOverviewStages", () => {
  it("renders persisted state, disabled prerequisites and the real next action", async () => {
    const overview = deriveProductionOverview({
      project: { id: "project", name: "Fixture", productionWorkflow: [{ id: "motion", enabled: false }] },
      scripts: [{ id: "script", selected: true, shots: [{ shotId: 1 }, { shotId: 2 }] }],
      assets: [{ id: "asset", shotId: 1, status: "done" }],
      tasks: [],
      compositions: [],
      operations: [{ id: "operation", kind: "pipeline", status: "running", stage: "stock_fill" }],
      snapshots: [],
    });

    await act(async () => root.render(<ProductionOverviewStages overview={overview} />));

    expect(host.querySelector('[data-stage="operation"]')?.getAttribute("data-state")).toBe("running");
    expect(host.querySelector('[data-stage="composition"] [data-action-reason="assets_required"]')?.textContent).toContain("素材");
    expect(host.querySelector('[data-next-action="operation"]')?.getAttribute("href")).toBe("/tasks");
    expect(host.querySelector('[data-legacy-workflow="ignored"]')).not.toBeNull();
  });
});
