"use client";

import { useEffect, useState } from "react";
import { createRendererCredentialVault, mergeCredentials, splitCredentials, type CredentialSnapshot } from "@/lib/credential-vault";
import { migrateSettings, useSettingsStore, type SettingsState } from "@/lib/stores/settings-store";
import { useProductLibraryStore, type ProductItem } from "@/lib/stores/product-library-store";
import { useTemplateStore, type ScriptTemplate } from "@/lib/stores/template-store";
import { useBrandStore, type BrandConfig } from "@/lib/stores/brand-store";
import { useCharacterStore, type Character } from "@/lib/stores/project-store";
import type { LocalStateScope, LocalStateSnapshot } from "@/lib/local-state-repository";

const LEGACY_KEYS = {
  products: "daihuo-jianshou-products",
  templates: "daihuo-jianshou-templates",
  characters: "daihuo-jianshou-characters",
  brand: "daihuo-jianshou-brand",
  settings: "daihuo-jianshou-settings",
} as const;

function legacyState(key: string): Record<string, unknown> | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    return parsed?.state && typeof parsed.state === "object" ? parsed.state : null;
  } catch { return null; }
}

function serializableSettings(state: SettingsState): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value !== "function"));
}

function mergeCredentialSnapshots(primary: CredentialSnapshot, fallback: CredentialSnapshot): CredentialSnapshot {
  return {
    providers: { ...fallback.providers, ...primary.providers },
    llm: primary.llm || fallback.llm,
    tts: {
      apiKey: primary.tts.apiKey || fallback.tts.apiKey,
      groupId: primary.tts.groupId || fallback.tts.groupId,
    },
  };
}

function restoreLegacyState(): { snapshot: LocalStateSnapshot; credentials: CredentialSnapshot; found: boolean } {
  const productsState = legacyState(LEGACY_KEYS.products);
  const templatesState = legacyState(LEGACY_KEYS.templates);
  const charactersState = legacyState(LEGACY_KEYS.characters);
  const brandState = legacyState(LEGACY_KEYS.brand);
  const settingsState = legacyState(LEGACY_KEYS.settings);
  const found = Boolean(productsState || templatesState || charactersState || brandState || settingsState);

  const products = ((productsState?.products as ProductItem[] | undefined) ?? []).map((item) => ({ ...item, createdAt: new Date(String(item.createdAt)) }));
  const templates = ((templatesState?.templates as ScriptTemplate[] | undefined) ?? []).map((item) => ({ ...item, createdAt: new Date(String(item.createdAt)) }));
  const characters = (charactersState?.characters as Character[] | undefined) ?? [];
  const brand = (brandState?.brand as BrandConfig | undefined) ?? useBrandStore.getState().brand;
  if (productsState) useProductLibraryStore.setState({ products });
  if (templatesState) useTemplateStore.setState({ templates });
  if (charactersState) useCharacterStore.setState({ characters });
  if (brandState) useBrandStore.setState({ brand });

  const combined = migrateSettings({ ...useSettingsStore.getState(), ...(settingsState ?? {}) } as SettingsState);
  if (settingsState) useSettingsStore.setState(combined);
  const split = splitCredentials(serializableSettings(combined));
  return { snapshot: { products, templates, characters, brand, settings: split.settings }, credentials: split.credentials, found };
}

async function jsonOrThrow(response: Response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((value as { error?: string }).error || `Local state request failed (${response.status})`);
  return value;
}

/**
 * Bridges in-memory Zustand views to the SQLite authority. Legacy localStorage is
 * deleted only after both credential transfer and the atomic DB migration succeed.
 */
export function LocalStateSync() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    const timers = new Map<LocalStateScope, ReturnType<typeof setTimeout>>();
    const vault = createRendererCredentialVault();

    const persist = (scope: LocalStateScope, value: unknown) => {
      clearTimeout(timers.get(scope));
      timers.set(scope, setTimeout(() => {
        void fetch("/api/local-state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope, value }),
        }).then(jsonOrThrow).catch((error) => {
          console.error(`Failed to persist ${scope}:`, error);
          setError(error instanceof Error ? error.message : String(error));
          window.dispatchEvent(new CustomEvent("mora:persistence-error", { detail: String(error) }));
        });
      }, 120));
    };

    void (async () => {
      const legacy = restoreLegacyState();
      try {
        const savedCredentials = await vault.load();
        const credentials = mergeCredentialSnapshots(savedCredentials, legacy.credentials);
        if (legacy.found) await vault.save(credentials);
        await jsonOrThrow(await fetch("/api/local-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(legacy.snapshot),
        }));
        const authoritative = await jsonOrThrow(await fetch("/api/local-state")) as LocalStateSnapshot;
        if (disposed) return;

        useProductLibraryStore.setState({ products: authoritative.products.map((item) => ({ ...item, createdAt: new Date(item.createdAt) })) });
        useTemplateStore.setState({ templates: authoritative.templates.map((item) => ({ ...item, createdAt: new Date(item.createdAt) })) });
        useCharacterStore.setState({ characters: authoritative.characters });
        if (authoritative.brand) useBrandStore.setState({ brand: authoritative.brand });
        const ordinary = migrateSettings({ ...useSettingsStore.getState(), ...authoritative.settings } as SettingsState);
        useSettingsStore.setState(mergeCredentials(ordinary, credentials));

        Object.values(LEGACY_KEYS).forEach((key) => localStorage.removeItem(key));
        unsubscribers.push(
          useProductLibraryStore.subscribe((state) => persist("products", state.products)),
          useTemplateStore.subscribe((state) => persist("templates", state.templates)),
          useCharacterStore.subscribe((state) => persist("characters", state.characters)),
          useBrandStore.subscribe((state) => persist("brand", state.brand)),
          useSettingsStore.subscribe((state) => {
            const split = splitCredentials(serializableSettings(state));
            persist("settings", split.settings);
            void vault.save(split.credentials).catch((error) => {
              console.error("Failed to persist credentials:", error);
              setError(error instanceof Error ? error.message : String(error));
              window.dispatchEvent(new CustomEvent("mora:persistence-error", { detail: String(error) }));
            });
          }),
        );
      } catch (error) {
        // The legacy keys remain untouched, so restarting the old or fixed build is recoverable.
        console.error("Local state migration failed; legacy browser data was preserved:", error);
        setError(error instanceof Error ? error.message : String(error));
        window.dispatchEvent(new CustomEvent("mora:persistence-error", { detail: String(error) }));
      }
    })();

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);
  if (!error) return null;
  return (
    <div role="alert" className="fixed inset-x-4 top-4 z-[100] mx-auto max-w-3xl rounded-xl border border-destructive/40 bg-background px-4 py-3 text-sm shadow-xl">
      <strong className="block">本地数据未能安全保存 / Local data was not saved safely</strong>
      <span className="mt-1 block text-muted-foreground">{error}</span>
    </div>
  );
}
