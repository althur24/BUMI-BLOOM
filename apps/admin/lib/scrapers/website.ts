// Generic website adapter (JSON-LD Product).
//
// Strategy: plain safe fetch first (fast, no browser). If the page doesn't
// expose a Product in its initial HTML, fall back to Playwright so client-side
// hydrated stores still work. Product data comes from JSON-LD; images are
// collected from structured data + the DOM, and per-size stock is recovered
// from common state payloads (e.g. Nuxt) when present.

import {
  findJsonLdProduct,
  jsonLdOffers,
  toNum,
  type NormalizedProduct,
  type ScraperVariant,
  type ScrapeResult,
} from "./base";
import { withPage, readJsonLd } from "./browser";
import { buildImagePlan } from "./images";
import { detectColorNames, hexForColorName } from "../colors";
import {
  buildSizeGuide,
  extractMaterialFacts,
  inferAudience,
  inferCategory,
} from "../categorize";
import { assertPublicHost, safeFetchText } from "../safe-fetch";
import { hostnameOf } from "../urls";
import { decodeHtmlEntities, isLikelySizeChart } from "../image-utils";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Some stores emit multiple JSON objects separated by newlines.
      const parts = raw.split(/\n(?=\{)/);
      for (const part of parts) {
        try {
          blocks.push(JSON.parse(part));
        } catch {
          // ignore malformed block
        }
      }
    }
  }
  return blocks;
}

function metaContent(html: string, prop: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  return m ? decodeHtmlEntities(m[1]) : undefined;
}

function cleanTitle(raw: string, brand?: string, siteName?: string): string {
  let s = decodeHtmlEntities(String(raw || "")).trim();
  s = s.replace(/__+/g, "-").replace(/_/g, " ");
  if (brand) {
    const b = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^\\s*${b}\\s*[-–|:]\\s*`, "i"), "");
    s = s.replace(new RegExp(`\\s*[-–|]\\s*${b}\\s*$`, "i"), "");
  }
  if (siteName) {
    const n = siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`\\s*[-–|]\\s*${n}\\s*$`, "i"), "");
  }
  s = s.replace(/\s*[-–|]\s*[-–|]\s*/g, " - ");
  s = s.replace(/\s+/g, " ").trim();
  return s || String(raw || "").trim();
}

function cleanDescription(raw: string | undefined, title: string, brand?: string): string | undefined {
  if (!raw) return undefined;
  let s = decodeHtmlEntities(String(raw));
  s = s.replace(/\\n/g, "\n").replace(/\\r/g, "");
  // Preserve block structure before stripping tags.
  s = s.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  // Remove a duplicated brand/title prefix ("BRAND - TITLE | ...").
  if (brand) {
    const b = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^\\s*${b}\\s*[-–|:]\\s*`, "i"), "");
  }
  if (title) {
    const t = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^\\s*${t}\\s*[|\\-–:]\\s*`, "i"), "");
  }
  if (brand) {
    const b = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`\\s*[|]\\s*${b}\\s*$`, "i"), "");
  }
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s || undefined;
}

function availabilityStock(availability: unknown): number {
  const a = String(availability || "").toLowerCase();
  if (/outofstock|soldout|discontinued/.test(a)) return 0;
  return 10;
}

function pickCompareAt(product: Record<string, any>, offers: any[], price?: number): number | undefined {
  const candidates = [
    product.compareAtPrice,
    product.listPrice,
    product.highPrice,
    ...offers.flatMap((o) => [o?.compareAtPrice, o?.listPrice, o?.highPrice]),
  ];
  for (const c of candidates) {
    const n = toNum(c);
    if (n != null && price != null && n > price) return n;
  }
  return undefined;
}

function collectStructuredImages(product: Record<string, any>): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (!v) return;
    if (typeof v === "string") out.push(v);
    else if (v.url) out.push(v.url);
    else if (v.contentUrl) out.push(v.contentUrl);
  };
  for (const img of [product.image].flat()) push(img);
  for (const media of [product.associatedMedia, product.subjectOf].flat()) {
    if (media && typeof media === "object") push(media);
  }
  return out;
}

// Recover per-size stock quantities from Nuxt/devalue payloads. Pattern:
//   "size","S (1-2 YO)",[128],{"quantity":129},31
export function extractStateQuantities(html: string): Map<string, number> {
  const map = new Map<string, number>();
  // The dimension key is often a devalue reference emitted only once, so the
  // generic pattern (label + quantity) is what matches every size.
  const re = /"([^"]{1,60})",\[\d+\],\{"quantity":\d+\},(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const label = decodeHtmlEntities(m[1]).trim();
    const qty = Number(m[2]);
    if (!label || !Number.isFinite(qty)) continue;
    if (!/\d/.test(label) && !/^(xxs|xs|s|m|l|xl|xxl|xxxl|\d+t)$/i.test(label)) continue;
    if (label.length > 40 || /^https?:/i.test(label)) continue;
    if (!map.has(label)) map.set(label, qty);
  }
  return map;
}

function looksLikeVariantName(name: string): boolean {
  return /\b(xxs|xs|s|m|l|xl|xxl|xxxl|\d+\s*[-–]\s*\d+|\d+\s*(?:y|yo|t|m|cm|months?|yrs?))\b/i.test(
    name,
  );
}

function normaliseOfferName(name: string | undefined): string | undefined {
  const s = String(name || "").trim();
  if (!s) return undefined;
  return s.length > 120 ? s.slice(0, 120) : s;
}

function buildFromProduct(
  product: Record<string, any>,
  blocks: unknown[],
  html: string,
  pageUrl: string,
  extractionPath: string,
): NormalizedProduct {
  const offers = jsonLdOffers(product);
  const first = offers[0];
  const price = toNum(first?.price) ?? toNum(first?.lowPrice) ?? toNum(product.price);
  const currency =
    first?.priceCurrency || product.priceCurrency || (/\.id(\/|$)|\.co\.id/i.test(pageUrl) ? "IDR" : undefined);

  const rawBrand =
    typeof product.brand === "string" ? product.brand : product.brand?.name;
  const siteName = metaContent(html, "og:site_name") || hostnameOf(pageUrl) || undefined;
  const brand = rawBrand ? String(rawBrand).trim() : undefined;
  const title = cleanTitle(String(product.name || metaContent(html, "og:title") || ""), brand, siteName);
  const description = cleanDescription(
    product.description ? String(product.description) : metaContent(html, "og:description"),
    title,
    brand,
  );

  const quantityMap = extractStateQuantities(html);
  const offerNames = offers
    .map((o) => normaliseOfferName(o?.name))
    .filter((n): n is string => Boolean(n));
  const useSizeOption =
    offers.length > 1 &&
    offerNames.length === offers.length &&
    new Set(offerNames).size > 1 &&
    offerNames.some(looksLikeVariantName);

  const variants: ScraperVariant[] = offers.length
    ? offers.map((o, i) => {
        const name = offerNames[i];
        const qty = name ? quantityMap.get(name) : undefined;
        const stock =
          typeof qty === "number" && Number.isFinite(qty)
            ? qty
            : availabilityStock(o?.availability);
        return {
          options: useSizeOption && name ? { Size: name } : {},
          price: toNum(o?.price) ?? toNum(o?.lowPrice) ?? price,
          compareAtPrice: pickCompareAt(product, offers, price),
          sku: o?.sku ? String(o.sku) : product.sku ? String(product.sku) : undefined,
          stock,
        };
      })
    : [
        {
          options: {},
          price,
          compareAtPrice: pickCompareAt(product, offers, price),
          sku: product.sku ? String(product.sku) : undefined,
          stock: availabilityStock(first?.availability),
        },
      ];

  // Colors: only trust a single detected color (single-variant products are
  // typically colorways). Adding a Color option makes swatches checkout-safe.
  const colors = detectColorNames(title);
  if (colors.length === 1) {
    const name = colors[0];
    const hex = hexForColorName(name);
    for (const v of variants) v.options = { Color: name, ...v.options };
    variants.forEach((v) => (v.hex = v.hex || hex));
  }

  const imagesStructured = collectStructuredImages(product);
  const plan = buildImagePlan({ structured: imagesStructured, html, pageUrl });
  const sizeChartImage =
    plan.sizeChartImage ||
    imagesStructured.find((u) => isLikelySizeChart(u)) ||
    undefined;

  const sizeLabels = [
    ...new Set(
      variants
        .map((v) => v.options.Size || v.options.Ukuran)
        .filter((s): s is string => Boolean(s)),
    ),
  ];
  const onModel = (description || "").match(/On model\s*:\s*([^\n]+)/i)?.[1];
  const sizeGuide = buildSizeGuide(sizeLabels, { sizeChartImage, extraText: onModel });
  const facts = extractMaterialFacts(description);

  const audience = inferAudience(title, description);
  const category = inferCategory(title, description);
  const location =
    product.offers?.seller?.address?.addressLocality ||
    product.offers?.[0]?.seller?.address?.addressLocality ||
    findAreaServed(blocks);

  const normalized: NormalizedProduct = {
    platform: "WEB",
    sourceUrl: pageUrl,
    title,
    description,
    price,
    compareAtPrice: pickCompareAt(product, offers, price),
    currency,
    images: plan.images,
    sizeChartImage,
    variants,
    colors: colors.length ? colors.map((name) => ({ name, hex: hexForColorName(name) })) : undefined,
    specs: {
      ...(category ? { category } : {}),
      audience,
      ...(description ? { originalDescription: description.slice(0, 4000) } : {}),
    },
    brand,
    rating: toNum(product.aggregateRating?.ratingValue),
    reviewsCount: toNum(product.aggregateRating?.reviewCount),
    location: location ? String(location) : undefined,
    materialCare: facts.materialCare,
    fibre: facts.fibre,
    sizeGuide,
    extractionPath,
  };
  return normalized;
}

function findAreaServed(blocks: unknown[]): string | undefined {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as any;
    const nodes = [b, ...(Array.isArray(b["@graph"]) ? b["@graph"] : [])];
    for (const node of nodes) {
      const area = node?.areaServed?.name || node?.address?.addressLocality;
      if (area) return String(area);
    }
  }
  return undefined;
}

export async function scrapeWebsite(url: string): Promise<ScrapeResult> {
  let html = "";
  let blocks: unknown[] = [];
  let extractionPath = "";

  try {
    const res = await safeFetchText(url, { timeoutMs: 20_000, maxBytes: 10 * 1024 * 1024 });
    html = res.text;
    blocks = parseJsonLd(html);
    if (findJsonLdProduct(blocks)) extractionPath = "jsonld+fetch";
  } catch (e) {
    // Network/SSRF failure on the plain fetch — try the browser below.
  }

  if (!extractionPath) {
    try {
      await assertPublicHost(new URL(url));
      html = await withPage(
        async (page) => {
          const pageUrl = page.url();
          await assertPublicHost(new URL(pageUrl)).catch(() => {});
          const pageBlocks = await readJsonLd(page);
          if (pageBlocks.length) blocks = pageBlocks;
          return page.content();
        },
        { url, blockAssets: false, waitMs: 2500 },
      );
      if (findJsonLdProduct(blocks)) extractionPath = "jsonld+playwright";
      else {
        // Re-parse from the rendered HTML as a last resort.
        blocks = parseJsonLd(html);
        if (findJsonLdProduct(blocks)) extractionPath = "jsonld+playwright-html";
      }
    } catch (e: any) {
      return {
        ok: false,
        error: `Halaman tidak bisa dibuka: ${e?.message || e}`,
        raw: { extractionPath: "none", htmlLength: html.length },
      };
    }
  }

  const product = findJsonLdProduct(blocks);
  if (!product) {
    return {
      ok: false,
      error:
        "Halaman ini tidak menyediakan data produk (JSON-LD Product). Pastikan ini link detail produk, bukan halaman toko/kategori.",
      raw: { extractionPath: extractionPath || "none", htmlLength: html.length },
    };
  }

  try {
    const normalized = buildFromProduct(product, blocks, html, url, extractionPath);
    return {
      ok: true,
      raw: {
        extractionPath,
        offerCount: jsonLdOffers(product).length,
        imageCount: normalized.images.length,
        hasSizeChart: Boolean(normalized.sizeChartImage),
      },
      normalized,
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
