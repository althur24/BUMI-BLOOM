// Tokopedia adapter — reworked for modern Tokopedia SSR.
// Tokopedia no longer exposes JSON-LD or __NEXT_DATA__. Instead, product data is
// in: (1) data-testid DOM attributes, (2) og: meta tags, (3) inline relay state
// (escaped JSON with URLOriginal images, shopName, variant value+stock).
//
// Strategy: DOM extraction via Playwright locators (no page.evaluate to avoid
// tsx __name injection issues) → regex relay state from page.content().

import { withPage } from "./browser";
import {
  toNum,
  type NormalizedColor,
  type NormalizedProduct,
  type ScraperVariant,
  type ScrapeResult,
} from "./base";
import { dedupeColors, looksLikeSize, normalizeHex } from "../colors";

export async function scrapeTokopedia(url: string): Promise<ScrapeResult> {
  try {
    return await withPage(
      async (page) => {
        // ── 1. DOM extraction via locators (Node-side, no page.evaluate) ─────
        const title = await getText(page, "lblPDPDetailProductName");
        const priceText = await getText(page, "lblPDPDetailProductPrice");
        const description = await getText(page, "lblPDPDescriptionProduk");
        const ogTitle = await getMeta(page, "og:title");
        const ogImage = await getMeta(page, "og:image");
        const pageTitle = await page.title().catch(() => "");

        // ── 2. Full page HTML (for regex extraction) ─────────────────────────
        const html = await page.content();

        // ── 3. Resolve title ─────────────────────────────────────────────────
        const resolvedTitle =
          title ||
          (ogTitle ? ogTitle.split(" | Tokopedia")[0].trim() : "") ||
          pageTitle ||
          "";

        if (!resolvedTitle) {
          return {
            ok: false,
            error:
              "Title tidak ditemukan — kemungkinan halaman butuh login atau anti-bot memblok render.",
            raw: {},
          };
        }

        // ── 4. Price ─────────────────────────────────────────────────────────
        const price = toNum(priceText) || undefined;

        // ── 5. Images (full signed URLs from relay state) ────────────────────
        const images = extractImages(html, ogImage);

        // ── 6. Brand ─────────────────────────────────────────────────────────
        const brand = extractBrand(html, ogTitle);

        // ── 7. Variants (size/color + stock) ─────────────────────────────────
        const { variants, colors } = extractVariants(html, price);

        const normalized: NormalizedProduct = {
          platform: "TOKPED",
          sourceUrl: url,
          title: resolvedTitle,
          description: description || undefined,
          price,
          currency: "IDR",
          images,
          variants,
          colors,
          brand,
        };

        return {
          ok: true,
          raw: { domFound: !!title, imgCount: images.length, variantCount: variants.length },
          normalized,
        };
      },
      { url },
    );
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ── Playwright locator helpers (Node-side, avoid page.evaluate) ──────────────

async function getText(page: import("playwright").Page, testid: string): Promise<string> {
  const loc = page.locator(`[data-testid="${testid}"]`);
  if ((await loc.count()) === 0) return "";
  return (await loc.first().textContent())?.trim() || "";
}

async function getMeta(page: import("playwright").Page, prop: string): Promise<string> {
  const loc = page.locator(`meta[property="${prop}"]`);
  if ((await loc.count()) === 0) return "";
  return (await loc.first().getAttribute("content")) || "";
}

// ── Regex extractors (run on page.content() HTML string) ─────────────────────

function extractImages(html: string, ogImage: string): string[] {
  const urls = new Set<string>();
  // URLOriginal":"https://..." — full URL including signature query params.
  const re = /URLOriginal":"(https[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    urls.add(m[1].replace(/&amp;/g, "&"));
  }
  if (urls.size === 0 && ogImage) {
    urls.add(ogImage.replace(/&amp;/g, "&"));
  }
  return [...urls].slice(0, 10);
}

function extractBrand(html: string, ogTitle: string): string | undefined {
  // Relay state: "shopName":"sabineandheemofficial"
  const m = html.match(/"shopName":"([^"]+)"/);
  if (m) return m[1];
  // og:title format: "...product... di {shopname} | Tokopedia"
  if (ogTitle) {
    const beforePipe = ogTitle.split(" | Tokopedia")[0];
    const diMatch = beforePipe.match(/ di (.+)$/);
    if (diMatch) return diMatch[1].trim();
  }
  return undefined;
}

function extractVariants(
  html: string,
  productPrice?: number,
): { variants: ScraperVariant[]; colors: NormalizedColor[] } {
  const empty = { variants: [] as ScraperVariant[], colors: [] as NormalizedColor[] };

  // Group markers tell us which dimensions exist. We deliberately do NOT use
  // their positions to slice the value list: Tokopedia sometimes emits every
  // group definition before a single shared options array, which made the
  // nearest-preceding-marker heuristic dump colours into Size. Instead we use
  // the markers only to know whether Color/Size dimensions exist, then classify
  // each value by its content (valid hex / size-shaped name).
  const hasSize = /"identifier":"(?:size|ukuran)"/i.test(html);
  const hasColor = /"identifier":"(?:colou?r|warna)"/i.test(html);
  if (!hasSize && !hasColor) return empty;

  interface RawOption { value: string; hex: string; stock: number; }
  const sizes: RawOption[] = [];
  const colorOptions: RawOption[] = [];
  const seenSize = new Set<string>();
  const seenColor = new Set<string>();
  const re = /"value":"([^"]+)","hex":"([^"]*)","stock":"?(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const value = m[1];
    const hex = cleanHex(m[2]);
    const stock = parseInt(m[3], 10);
    // Long numeric strings are variant IDs, not sizes. Keep numeric sizes
    // like "2", "4", "100" (height in cm).
    if (/^\d{6,}$/.test(value)) continue;
    if (!value.trim()) continue;

    const isColor = classifyOption(value, hex, hasSize, hasColor);
    if (isColor) {
      if (!seenColor.has(value)) {
        seenColor.add(value);
        colorOptions.push({ value, hex, stock });
      }
    } else if (!seenSize.has(value)) {
      seenSize.add(value);
      sizes.push({ value, hex, stock });
    }
  }

  const colors = dedupeColors(
    colorOptions.map((c) => ({ name: c.value, hex: c.hex })),
  );

  // ── Single dimension: flat list ─────────────────────────────────────────
  if (sizes.length > 0 && colorOptions.length === 0) {
    return {
      variants: sizes.map((s) => ({
        options: { Ukuran: s.value },
        price: productPrice,
        stock: s.stock,
      })),
      colors: [],
    };
  }
  if (colorOptions.length > 0 && sizes.length === 0) {
    return {
      variants: colorOptions.map((c) => ({
        options: { Warna: c.value },
        price: productPrice,
        stock: c.stock,
        hex: c.hex,
      })),
      colors,
    };
  }

  // ── Multi dimension: cartesian product (colour × size) ──────────────────
  const variants: ScraperVariant[] = [];
  for (const c of colorOptions) {
    for (const s of sizes) {
      // Stock: colour stock is usually the aggregate (more reliable).
      // Size stock is often 0 (not maintained per-size).
      const stock = c.stock > 0 ? c.stock : s.stock;
      variants.push({
        options: { Warna: c.value, Ukuran: s.value },
        price: productPrice,
        stock,
        hex: c.hex,
      });
    }
  }
  return { variants, colors };
}

// Decide whether an option belongs to Color or Size.
// 1. A real hex always means Color.
// 2. Size-shaped values (S/M/L, 1Y, 3-6M, 110cm, "One Size") are Size.
// 3. Everything else is a Color — marketplaces often use pattern/colorway
//    names like OCEAN, CRAB, MAHESA that the old parser treated as sizes.
function classifyOption(
  value: string,
  hex: string,
  hasSize: boolean,
  hasColor: boolean,
): boolean {
  if (hex) return true;
  if (!hasSize && hasColor) return true; // only one dimension, and it's Color
  if (hasSize && !hasColor) return false; // only one dimension, and it's Size
  return !looksLikeSize(value);
}

// Tokopedia stores hex without "#" in some payloads; normalize both forms.
function cleanHex(raw: string): string {
  if (!raw) return "";
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  return normalizeHex(withHash) || normalizeHex(raw) || "";
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
