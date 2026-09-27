import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import type { ProductItem } from "@/lib/stores/product-library-store";
import type { ScriptTemplate } from "@/lib/stores/template-store";
import type { BrandConfig } from "@/lib/stores/brand-store";
import type { Character } from "@/lib/stores/project-store";

export interface LocalStateSnapshot {
  products: ProductItem[];
  templates: ScriptTemplate[];
  characters: Character[];
  brand: BrandConfig | null;
  settings: Record<string, unknown>;
}

export type LocalStateScope = "products" | "templates" | "characters" | "brand" | "settings";

type AppDatabase = BetterSQLite3Database<typeof schema>;
const MIGRATION_KEY = "migration.browser-state-v1";
const SETTINGS_KEY = "app.ordinary-settings";
const CREDENTIAL_KEY = /api.?key|token|secret|password|group.?id/i;

function asDate(value: Date | string | number | undefined): Date {
  if (value instanceof Date) return value;
  const parsed = value == null ? new Date() : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const settings = { ...(value as Record<string, unknown>) };
  if (typeof settings.locale === "string") settings.locale = settings.locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  return settings;
}

export function assertCredentialFree(value: unknown, path = "settings"): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key) && child !== "" && child != null) throw new Error(`credential field rejected at ${path}.${key}`);
    assertCredentialFree(child, `${path}.${key}`);
  }
}

export class LocalStateRepository {
  constructor(private readonly database: AppDatabase) {}

  read(): LocalStateSnapshot {
    const products = this.database.select().from(schema.products).orderBy(asc(schema.products.createdAt)).all().map((row) => ({
      id: row.id, name: row.name, category: row.category, description: row.description ?? undefined,
      images: row.images ?? [], price: row.price ?? undefined, targetAudience: row.targetAudience ?? undefined,
      videoCount: row.videoCount ?? 0, createdAt: row.createdAt ?? new Date(0),
    }));
    const templates = this.database.select().from(schema.scriptTemplates).orderBy(asc(schema.scriptTemplates.createdAt)).all().map((row) => ({
      id: row.id, name: row.name, description: row.description ?? undefined, category: row.category ?? undefined,
      videoMode: row.videoMode ?? undefined, styleType: row.styleType ?? undefined, shots: row.shots ?? [],
      totalDuration: row.totalDuration ?? undefined, sourceProjectId: row.sourceProjectId ?? undefined,
      useCount: row.useCount ?? 0, createdAt: row.createdAt ?? new Date(0),
    }));
    const characters = this.database.select().from(schema.characters).orderBy(asc(schema.characters.createdAt)).all().map((row) => ({
      id: row.id, name: row.name, description: row.description ?? undefined, appearance: row.appearance ?? undefined,
      referenceImages: row.referenceImages ?? [], voiceProfile: row.voiceProfile ?? undefined, isDefault: row.isDefault ?? false,
    }));
    const settingsRows = this.database.select().from(schema.settings).all();
    const ordinary = settingsRows.find((row) => row.key === SETTINGS_KEY)?.value;
    const brandRow = this.database.select().from(schema.brandSettings).orderBy(asc(schema.brandSettings.createdAt)).limit(1).get();
    const brand = brandRow ? {
      id: brandRow.id, name: brandRow.name, logoUrl: brandRow.logoPath ?? undefined,
      primaryColor: brandRow.primaryColor ?? "#6366f1", secondaryColor: brandRow.secondaryColor ?? "#8b5cf6",
      fontFamily: brandRow.fontFamily ?? "默认字体",
      watermark: brandRow.watermark ?? { enabled: false, position: "bottom-right", opacity: 0.3, scale: 0.15 },
      introEnabled: brandRow.introEnabled ?? false, outroEnabled: brandRow.outroEnabled ?? false,
      outroText: brandRow.outroText ?? undefined,
    } satisfies BrandConfig : null;
    return { products, templates, characters, brand, settings: normalizeSettings(ordinary) };
  }

  migrateBrowserState(snapshot: LocalStateSnapshot): { migrated: boolean } {
    assertCredentialFree(snapshot.settings);
    return this.database.transaction((tx) => {
      if (tx.select().from(schema.settings).where(eq(schema.settings.key, MIGRATION_KEY)).get()) return { migrated: false };
      if (snapshot.products.length) tx.insert(schema.products).values(snapshot.products.map((item) => ({ ...item, createdAt: asDate(item.createdAt), updatedAt: asDate(item.createdAt) }))).onConflictDoNothing().run();
      if (snapshot.templates.length) tx.insert(schema.scriptTemplates).values(snapshot.templates.map((item) => ({
        id: item.id, name: item.name, description: item.description, category: item.category, videoMode: item.videoMode,
        styleType: item.styleType, shots: item.shots, totalDuration: item.totalDuration,
        sourceProjectId: item.sourceProjectId, useCount: item.useCount, createdAt: asDate(item.createdAt),
      }))).onConflictDoNothing().run();
      if (snapshot.characters.length) tx.insert(schema.characters).values(snapshot.characters).onConflictDoNothing().run();
      if (snapshot.brand) {
        tx.insert(schema.brandSettings).values({
          id: snapshot.brand.id, name: snapshot.brand.name, logoPath: snapshot.brand.logoUrl,
          primaryColor: snapshot.brand.primaryColor, secondaryColor: snapshot.brand.secondaryColor,
          fontFamily: snapshot.brand.fontFamily, watermark: snapshot.brand.watermark,
          introEnabled: snapshot.brand.introEnabled, outroEnabled: snapshot.brand.outroEnabled,
          outroText: snapshot.brand.outroText, isDefault: true,
        }).onConflictDoNothing().run();
      }
      tx.insert(schema.settings).values({ key: SETTINGS_KEY, value: normalizeSettings(snapshot.settings) }).onConflictDoNothing().run();
      tx.insert(schema.settings).values({ key: MIGRATION_KEY, value: { completedAt: new Date().toISOString() } }).run();
      return { migrated: true };
    });
  }

  replace(scope: LocalStateScope, value: unknown): void {
    if (scope === "settings") assertCredentialFree(value);
    this.database.transaction((tx) => {
      if (scope === "products") {
        const items = value as ProductItem[];
        tx.delete(schema.products).run();
        if (items.length) tx.insert(schema.products).values(items.map((item) => ({ ...item, createdAt: asDate(item.createdAt), updatedAt: new Date() }))).run();
      } else if (scope === "templates") {
        const items = value as ScriptTemplate[];
        tx.delete(schema.scriptTemplates).run();
        if (items.length) tx.insert(schema.scriptTemplates).values(items.map((item) => ({
          id: item.id, name: item.name, description: item.description, category: item.category, videoMode: item.videoMode,
          styleType: item.styleType, shots: item.shots, totalDuration: item.totalDuration,
          sourceProjectId: item.sourceProjectId, useCount: item.useCount, createdAt: asDate(item.createdAt),
        }))).run();
      } else if (scope === "characters") {
        const items = value as Character[];
        tx.delete(schema.characters).run();
        if (items.length) tx.insert(schema.characters).values(items).run();
      } else if (scope === "brand") {
        const brand = value as BrandConfig;
        tx.delete(schema.brandSettings).run();
        tx.insert(schema.brandSettings).values({
          id: brand.id, name: brand.name, logoPath: brand.logoUrl, primaryColor: brand.primaryColor,
          secondaryColor: brand.secondaryColor, fontFamily: brand.fontFamily, watermark: brand.watermark,
          introEnabled: brand.introEnabled, outroEnabled: brand.outroEnabled, outroText: brand.outroText, isDefault: true,
        }).run();
      } else {
        const settings = normalizeSettings(value);
        tx.insert(schema.settings).values({ key: SETTINGS_KEY, value: settings, updatedAt: new Date() })
          .onConflictDoUpdate({ target: schema.settings.key, set: { value: settings, updatedAt: new Date() } }).run();
      }
    });
  }
}
