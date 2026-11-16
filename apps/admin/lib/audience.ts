// Audience values understood by the storefront (Girls / Boys collections).
//
// Kept in its own dependency-free module so the pure import helpers (mapper,
// dry-run scripts, unit tests) can use it without pulling in the Shopify
// transport that lib/products.ts depends on.
//
// "unisex" is the safe default and matches both collections; an empty value is
// never valid because it would hide the product from Girls and Boys alike.

export type ProductAudience = "girls" | "boys" | "unisex" | "baby";

export const PRODUCT_AUDIENCES: ProductAudience[] = ["unisex", "girls", "boys", "baby"];

// Parse a `bumi.audience` metafield. Returns null when unset/unknown so the
// product list can flag it as an issue; readers that need a usable value use
// normaliseAudience() instead.
export function parseAudience(value: unknown): ProductAudience | null {
  const v = String(value ?? "").trim().toLowerCase();
  return (PRODUCT_AUDIENCES as string[]).includes(v) ? (v as ProductAudience) : null;
}

export function normaliseAudience(value: unknown): ProductAudience {
  return parseAudience(value) ?? "unisex";
}
