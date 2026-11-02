// Scraper type contracts. Decoupled from Prisma so scrapers stay testable in
// isolation. The queue maps NormalizedProduct → ImportJob.extractedJson.

export type Platform = "SHOPEE" | "TOKPED" | "WEB" | "OTHER";

export interface ScraperVariant {
  options: Record<string, string>; // { Warna: "Hitam", Ukuran: "M" }
  price?: number; // major units (e.g. 49950)
  compareAtPrice?: number; // original / strike-through price
  sku?: string;
  stock?: number;
  grams?: number;
  hex?: string; // color hex code (e.g. "#000000") — only for color variants
}

export interface NormalizedColor {
  name: string;
  hex: string;
}

export interface ImageReportItem {
  sourceUrl: string;
  publicUrl?: string;
  width?: number;
  height?: number;
  bytes?: number;
  mime?: string;
  lowRes?: boolean;
  rejected?: string;
}

export interface ImageReport {
  total: number;
  used: number;
  items: ImageReportItem[];
  rejected: { url: string; reason: string }[];
}

export interface NormalizedProduct {
  platform: Platform;
  sourceUrl: string;
  title: string;
  description?: string;
  price?: number; // major units
  compareAtPrice?: number; // major units
  currency?: string; // "IDR"
  images: string[]; // original marketplace URLs (pre-rehost)
  sizeChartImage?: string; // separated from the gallery
  imageReport?: ImageReport;
  extractionPath?: string; // which extraction strategy succeeded
  variants: ScraperVariant[];
  // Color swatches for the storefront (bumi.colors). Scrapers/AI/admin edits
  // fill this; the Shopify mapper falls back to variants + a name→hex dictionary.
  colors?: NormalizedColor[];
  specs?: Record<string, string>;
  brand?: string;
  rating?: number;
  reviewsCount?: number;
  soldCount?: number;
  location?: string;
  materialCare?: string;
  sizeGuide?: string;
  shippingReturns?: string;
  fibre?: string;
}

export interface ScrapeResult {
  ok: boolean;
  raw?: unknown; // raw extracted (JSON-LD / state) for ImportJob.rawJson
  normalized?: NormalizedProduct;
  error?: string;
}

// ── JSON-LD helpers ─────────────────────────────────────────────────────────

export function findJsonLdProduct(blocks: unknown[]): Record<string, any> | null {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, any>;
    const candidates: any[] = [];
    if (b["@type"] === "Product") candidates.push(b);
    if (Array.isArray(b["@type"]) && b["@type"].includes("Product")) candidates.push(b);
    if (Array.isArray(b["@graph"])) {
      b["@graph"].forEach((x: any) => {
        if (
          x &&
          (x["@type"] === "Product" ||
            (Array.isArray(x["@type"]) && x["@type"].includes("Product")))
        ) {
          candidates.push(x);
        }
      });
    }
    for (const obj of candidates) {
      if (obj && typeof obj === "object") return obj;
    }
  }
  return null;
}

export function jsonLdOffers(product: Record<string, any>): any[] {
  if (!product) return [];
  const raw = product.offers ?? product.offer;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter((o: any) => o && typeof o === "object");
}

// ── JSON-LD Product extraction (generic, most stable across marketplaces) ────
export function extractProductFromJsonLd(
  blocks: unknown[],
): Partial<NormalizedProduct> | null {
  const obj = findJsonLdProduct(blocks);
  if (!obj) return null;

  const offers = jsonLdOffers(obj);
  const first = offers[0];
  const price =
    first?.price != null
      ? Number(first.price)
      : first?.lowPrice != null
        ? Number(first.lowPrice)
        : obj.price != null
          ? Number(obj.price)
          : undefined;
  const currency = first?.priceCurrency || obj.priceCurrency;

  const rawImages = [obj.image].flat();
  const images: string[] = [];
  for (const img of rawImages) {
    if (!img) continue;
    if (typeof img === "string") images.push(img);
    else if (img?.url) images.push(img.url);
    else if (img?.contentUrl) images.push(img.contentUrl);
  }

  const partial: Partial<NormalizedProduct> = {
    title: obj.name,
    description: obj.description,
    price: Number.isFinite(price as number) ? (price as number) : undefined,
    currency,
    images,
    brand:
      typeof obj.brand === "string"
        ? obj.brand
        : obj.brand?.name,
  };
  if (obj.aggregateRating?.ratingValue)
    partial.rating = Number(obj.aggregateRating.ratingValue);
  if (obj.aggregateRating?.reviewCount)
    partial.reviewsCount = Number(obj.aggregateRating.reviewCount);
  return partial;
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
