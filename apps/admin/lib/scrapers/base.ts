// Scraper type contracts. Decoupled from Prisma so scrapers stay testable in
// isolation. The queue maps NormalizedProduct → ImportJob.extractedJson.

export type Platform = "SHOPEE" | "TOKPED" | "OTHER";

export interface ScraperVariant {
  options: Record<string, string>; // { Warna: "Hitam", Ukuran: "M" }
  price?: number; // major units (e.g. 49950)
  sku?: string;
  stock?: number;
}

export interface NormalizedProduct {
  platform: Platform;
  sourceUrl: string;
  title: string;
  description?: string;
  price?: number; // major units
  currency?: string; // "IDR"
  images: string[]; // original marketplace URLs (pre-rehost)
  variants: ScraperVariant[];
  specs?: Record<string, string>;
  brand?: string;
  rating?: number;
  soldCount?: number;
  location?: string;
}

export interface ScrapeResult {
  ok: boolean;
  raw?: unknown; // raw extracted (JSON-LD / state) for ImportJob.rawJson
  normalized?: NormalizedProduct;
  error?: string;
}

// ── JSON-LD Product extraction (generic, most stable across marketplaces) ────
export function extractProductFromJsonLd(
  blocks: unknown[],
): Partial<NormalizedProduct> | null {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, any>;
    // A JSON-LD block may be a Product directly, or wrap one in @graph.
    const candidates: any[] = [];
    if (b["@type"] === "Product") candidates.push(b);
    if (Array.isArray(b["@type"]) && b["@type"].includes("Product"))
      candidates.push(b);
    if (Array.isArray(b["@graph"]))
      b["@graph"].forEach((x: any) => {
        if (x && (x["@type"] === "Product" || (Array.isArray(x["@type"]) && x["@type"].includes("Product"))))
          candidates.push(x);
      });

    for (const obj of candidates) {
      const offers = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
      const price =
        offers?.price != null
          ? Number(offers.price)
          : offers?.lowPrice != null
            ? Number(offers.lowPrice)
            : undefined;
      const currency = offers?.priceCurrency;
      const rawImages = [obj.image].flat();
      const images: string[] = [];
      for (const img of rawImages) {
        if (!img) continue;
        if (typeof img === "string") images.push(img);
        else if (img?.url) images.push(img.url);
      }
      const partial: Partial<NormalizedProduct> = {
        title: obj.name,
        description: obj.description,
        price,
        currency,
        images,
        brand:
          typeof obj.brand === "string"
            ? obj.brand
            : obj.brand?.name,
      };
      if (obj.aggregateRating?.ratingValue)
        partial.rating = Number(obj.aggregateRating.ratingValue);
      return partial;
    }
  }
  return null;
}

// Coerce a value to a number or undefined. Handles IDR formatting where "." is
// a thousands separator (e.g. "Rp499.000" → 499000, "1.234.567" → 1234567) while
// still treating a genuine decimal ("499.95") correctly.
export function toNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  let s = String(v).trim();
  if (!s) return undefined;
  const hasCurrency = /rp|idr|\$/i.test(s);
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return undefined;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    // Both: assume "." thousands, "," decimal (EU/ID style).
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // Comma only: decimal separator.
    s = s.replace(",", ".");
  } else if (hasDot) {
    // Dot only: if it looks like IDR thousands (currency marker, or dot
    // followed by exactly 3 digits at end, or multiple dots) → strip dots.
    const looksThousands =
      hasCurrency || /\.\d{3}$/.test(s) || (s.match(/\./g) || []).length > 1;
    if (looksThousands) s = s.replace(/\./g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
