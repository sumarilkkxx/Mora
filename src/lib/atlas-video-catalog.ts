import { ATLAS_VIDEO_MODELS, type AtlasVideoMode } from "@/lib/atlas-video-models";

const CATALOG_URL = "https://www.atlascloud.ai/zh/models/all";
const DOCS_BASE_URL = "https://www.atlascloud.ai/docs/more-models";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface AtlasCatalogVideoModel {
  id: string;
  name: string;
  categories: string[];
  organization?: string;
  description?: string;
  pricePerUnit?: number;
  priceUnit?: string;
}

export interface AtlasSchemaProperty {
  type?: string;
  description?: string;
  enum?: Array<string | number | boolean>;
  default?: unknown;
  examples?: unknown[];
  items?: AtlasSchemaProperty;
}

export interface AtlasInputSchema {
  properties: Record<string, AtlasSchemaProperty>;
  required: string[];
}

let catalogCache: { expiresAt: number; models: AtlasCatalogVideoModel[] } | undefined;
const schemaCache = new Map<string, { expiresAt: number; schema: AtlasInputSchema }>();

function decodeEscapedText(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/\r?\n/g, "\\n")}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
}

function capture(segment: string, field: string): string | undefined {
  const marker = `\\"${field}\\":\\"`;
  const start = segment.indexOf(marker);
  if (start < 0) return undefined;
  let cursor = start + marker.length;
  while (cursor < segment.length) {
    const quote = segment.indexOf('"', cursor);
    if (quote < 0) return undefined;
    let slashCount = 0;
    for (let index = quote - 1; index >= 0 && segment[index] === "\\"; index--) slashCount++;
    if (slashCount === 1) return segment.slice(start + marker.length, quote - 1);
    cursor = quote + 1;
  }
  return undefined;
}

function fallbackCatalog(): AtlasCatalogVideoModel[] {
  return ATLAS_VIDEO_MODELS.map((model) => ({
    id: model.id,
    name: `${model.name} ${model.mode.replaceAll("-", " ")}`,
    categories: [model.mode.toUpperCase()],
    description: "Mora 内置的 Atlas Cloud 离线回退模型",
    pricePerUnit: model.pricePerSecond,
    priceUnit: "second",
  }));
}

export function parseAtlasVideoCatalog(html: string): AtlasCatalogVideoModel[] {
  const segments = html.split('{\\"uuid\\":').slice(1);
  const models = new Map<string, AtlasCatalogVideoModel>();
  for (const segment of segments) {
    const type = capture(segment, "type");
    if (type !== "Video") continue;
    const id = capture(segment, "model");
    const name = capture(segment, "displayName");
    if (!id || !name) continue;
    const categoriesStart = segment.indexOf('\\"categories\\":[');
    const categoriesEnd = categoriesStart >= 0 ? segment.indexOf(']', categoriesStart) : -1;
    const categoriesRaw = categoriesEnd >= 0 ? segment.slice(categoriesStart + '\\"categories\\":['.length, categoriesEnd) : "";
    const categories = [...categoriesRaw.matchAll(/\\"([^"\\]+)\\"/g)].map((match) => match[1]);
    const actualStart = segment.indexOf('\\"actual\\":{');
    const price = actualStart >= 0 ? capture(segment.slice(actualStart), "base_price") : undefined;
    models.set(id, {
      id,
      name: decodeEscapedText(name),
      categories,
      organization: capture(segment, "organization"),
      description: capture(segment, "profile") ? decodeEscapedText(capture(segment, "profile")!) : undefined,
      pricePerUnit: price != null && Number.isFinite(Number(price)) ? Number(price) : undefined,
      priceUnit: capture(segment, "unit"),
    });
  }
  return [...models.values()];
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "Mora/0.8 AtlasCatalog" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAtlasVideoCatalog(): Promise<AtlasCatalogVideoModel[]> {
  const now = Date.now();
  if (catalogCache && catalogCache.expiresAt > now) return catalogCache.models;
  try {
    const models = parseAtlasVideoCatalog(await fetchText(CATALOG_URL));
    if (models.length < 10) throw new Error(`Atlas catalog only returned ${models.length} video models`);
    catalogCache = { models, expiresAt: now + CACHE_TTL_MS };
    return models;
  } catch (error) {
    console.warn("[ATLAS_CATALOG_FALLBACK]", error instanceof Error ? error.message : String(error));
    const models = fallbackCatalog();
    catalogCache = { models, expiresAt: now + 5 * 60 * 1000 };
    return models;
  }
}

export function atlasCatalogMode(model: Pick<AtlasCatalogVideoModel, "id" | "categories">): AtlasVideoMode | undefined {
  const id = model.id.toLowerCase();
  const categories = model.categories.map((category) => category.toUpperCase());
  if (id.includes("reference-to-video") || categories.includes("REFERENCE-TO-VIDEO")) return "reference-to-video";
  if (/image-to-video|\/i2v(?:-|$)|start-end(?:-frame)?-to-video/.test(id) || categories.includes("IMAGE-TO-VIDEO")) return "image-to-video";
  if (/text-to-video|\/t2v(?:-|$)/.test(id) || categories.includes("TEXT-TO-VIDEO")) return "text-to-video";
  return undefined;
}

const STANDARD_MODE_SUFFIX = /\/(text-to-video|image-to-video|reference-to-video)$/i;

export function atlasCatalogFamilyId(modelId: string): string | undefined {
  const match = STANDARD_MODE_SUFFIX.exec(modelId);
  return match ? modelId.slice(0, -match[0].length) : undefined;
}

export function routeAtlasCatalogModel(
  configuredModelId: string,
  mode: AtlasVideoMode,
  catalog: AtlasCatalogVideoModel[],
): string | undefined {
  const ids = new Set(catalog.map((model) => model.id.toLowerCase()));
  const configured = configuredModelId.toLowerCase();
  const family = atlasCatalogFamilyId(configured) ?? configured;
  const sibling = `${family}/${mode}`;
  if (ids.has(sibling)) return sibling;
  const exact = catalog.find((model) => model.id.toLowerCase() === configured);
  const exactMode = exact ? atlasCatalogMode(exact) : undefined;
  return exact && (!exactMode || exactMode === mode) ? exact.id : undefined;
}

function docsUrl(modelId: string): string {
  const [organization, ...parts] = modelId.split("/");
  return `${DOCS_BASE_URL}/${encodeURIComponent(organization)}/${parts.map(encodeURIComponent).join("-")}/generateVideo`;
}

function parseInputSchema(html: string): AtlasInputSchema | undefined {
  const startMarker = '\\"Input\\":';
  const endMarker = ',\\"PredictionResponse\\"';
  const start = html.indexOf(startMarker);
  if (start < 0) return undefined;
  const valueStart = start + startMarker.length;
  const end = html.indexOf(endMarker, valueStart);
  if (end < 0) return undefined;
  const encoded = html.slice(valueStart, end);
  try {
    const decoded = JSON.parse(`"${encoded.replace(/\r?\n/g, "\\n")}"`) as string;
    const parsed = JSON.parse(decoded) as Partial<AtlasInputSchema>;
    if (!parsed.properties) return undefined;
    return { properties: parsed.properties, required: parsed.required ?? [] };
  } catch {
    return undefined;
  }
}

export async function getAtlasInputSchema(modelId: string): Promise<AtlasInputSchema> {
  const now = Date.now();
  const cached = schemaCache.get(modelId);
  if (cached && cached.expiresAt > now) return cached.schema;
  const schema = parseInputSchema(await fetchText(docsUrl(modelId)));
  if (!schema) throw new Error(`Atlas Cloud 未公布 ${modelId} 的可解析输入 Schema`);
  schemaCache.set(modelId, { schema, expiresAt: now + CACHE_TTL_MS });
  return schema;
}
