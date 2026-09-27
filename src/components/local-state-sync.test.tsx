// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStateSync } from "@/components/local-state-sync";
import { useProductLibraryStore } from "@/lib/stores/product-library-store";
import { useSettingsStore } from "@/lib/stores/settings-store";

let host: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  useProductLibraryStore.setState({ products: [] });
  useSettingsStore.setState({ llm: { ...useSettingsStore.getState().llm, apiKey: "" } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete window.moraCredentials;
});

describe("LocalStateSync legacy migration", () => {
  it("removes legacy localStorage only after credentials and SQLite both succeed", async () => {
    localStorage.setItem("daihuo-jianshou-products", JSON.stringify({ state: { products: [{ id: "p1", name: "Legacy", category: "beauty", images: [], videoCount: 0, createdAt: "2026-01-01T00:00:00.000Z" }] } }));
    localStorage.setItem("daihuo-jianshou-settings", JSON.stringify({ state: { llm: { provider: "", baseUrl: "https://example.test", apiKey: "legacy-secret", model: "m" } } }));
    const saved: unknown[] = [];
    window.moraCredentials = {
      load: async () => ({ providers: {}, llm: "", tts: { apiKey: "", groupId: "" } }),
      save: async (value) => { saved.push(value); },
      clear: async () => {},
    };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ migrated: true });
      return Response.json({
        products: [{ id: "p1", name: "SQLite", category: "beauty", images: [], videoCount: 0, createdAt: "2026-01-01T00:00:00.000Z" }],
        templates: [], characters: [], brand: null,
        settings: { llm: { provider: "", baseUrl: "https://example.test", apiKey: "", model: "m" } },
      });
    }));

    await act(async () => root.render(<LocalStateSync />));
    await settle();

    expect(saved).toContainEqual(expect.objectContaining({ llm: "legacy-secret" }));
    expect(localStorage.getItem("daihuo-jianshou-products")).toBeNull();
    expect(localStorage.getItem("daihuo-jianshou-settings")).toBeNull();
    expect(useProductLibraryStore.getState().products[0].name).toBe("SQLite");
    expect(useSettingsStore.getState().llm.apiKey).toBe("legacy-secret");
  });

  it("keeps legacy data recoverable and visible when the DB migration fails", async () => {
    const raw = JSON.stringify({ state: { products: [{ id: "p1", name: "Recoverable", category: "beauty", images: [], videoCount: 0, createdAt: "2026-01-01T00:00:00.000Z" }] } });
    localStorage.setItem("daihuo-jianshou-products", raw);
    window.moraCredentials = {
      load: async () => ({ providers: {}, llm: "", tts: { apiKey: "", groupId: "" } }),
      save: async () => {}, clear: async () => {},
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "database unavailable" }, { status: 500 })));

    await act(async () => root.render(<LocalStateSync />));
    await settle();

    expect(localStorage.getItem("daihuo-jianshou-products")).toBe(raw);
    expect(useProductLibraryStore.getState().products[0].name).toBe("Recoverable");
    expect(host.textContent).toContain("database unavailable");
  });
});
