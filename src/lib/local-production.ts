import type { GeneratedScript } from "@/lib/script-engine/generator";

/**
 * Local production reuses the merchant's existing product image for every shot.
 * AI descriptions stay in the script data so a later switch to AI production
 * can reuse them, but they must not make the local workflow request generation.
 */
export function bindProductImageToLocalShots(
  scripts: GeneratedScript[],
  productionMode: unknown,
  hasProductImage: boolean
): GeneratedScript[] {
  if (productionMode !== "local" || !hasProductImage) return scripts;

  return scripts.map((script) => ({
    ...script,
    shots: script.shots.map((shot) => ({
      ...shot,
      visualSource: "product_image" as const,
    })),
  }));
}
