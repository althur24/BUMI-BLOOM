// Audience values understood by the storefront (Girls / Boys collections).
//
// Kept in its own dependency-free module so the pure import helpers (mapper,
// dry-run scripts, unit tests) can use it without pulling in the Shopify
// transport that lib/products.ts depends on.
//
// "unisex" is the safe default and matches both collections; an empty value is
// never valid because it would hide the product from Girls and Boys alike.
//
// Baby is NOT an audience — the storefront no longer has a Baby collection, so
// a legacy `baby` metafield is read back as "unisex" to match the storefront's
// own normalisation (see normalizeBrandAudience in the storefront data layer).

export type ProductAudience = "girls" | "boys" | "unisex";

export const PRODUCT_AUDIENCES: ProductAudience[] = ["unisex", "girls", "boys"];

// Legacy metafield values that must keep resolving to a usable audience.
const LEGACY_AUDIENCES: Record<string, ProductAudience> = {
  baby: "unisex",
};

// Parse a `bumi.audience` metafield. Returns null when unset/unknown so the
// product list can flag it as an issue; readers that need a usable value use
// normaliseAudience() instead.
export function parseAudience(value: unknown): ProductAudience | null {
  const v = String(value ?? "").trim().toLowerCase();
  if ((PRODUCT_AUDIENCES as string[]).includes(v)) return v as ProductAudience;
  return LEGACY_AUDIENCES[v] ?? null;
}

export function normaliseAudience(value: unknown): ProductAudience {
  return parseAudience(value) ?? "unisex";
}
