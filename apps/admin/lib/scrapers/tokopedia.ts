// Tokopedia adapter — reworked for modern Tokopedia SSR.
// Tokopedia no longer exposes JSON-LD or __NEXT_DATA__. Instead, product data is
// in: (1) data-testid DOM attributes, (2) og: meta tags, (3) inline relay state
// (escaped JSON with URLOriginal images, shopName, variant value+stock).
//
// Strategy: DOM extraction via Playwright locators (no page.evaluate to avoid
// tsx __name injection issues) → regex relay state from page.content().

import { withPage } from "./browser";
import { toNum, type NormalizedProduct, type ScraperVariant, type ScrapeResult } from "./base";

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
        const variants = extractVariants(html, price);

        const normalized: NormalizedProduct = {
          platform: "TOKPED",
          sourceUrl: url,
          title: resolvedTitle,
          description: description || undefined,
          price,
          currency: "IDR",
          images,
          variants,
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
): ScraperVariant[] {
  // Detect variant dimensions: "identifier":"size" and/or "identifier":"color"
  const isSize = /"identifier":"size"/.test(html);
  const isColor = /"identifier":"color"/.test(html);
  if (!isSize && !isColor) return [];

  // Extract ALL variant options: "value":"...","hex":"...","stock":"..."
  // hex="" → size option; hex="#XXXXXX" → color option.
  interface RawOption { value: string; hex: string; stock: number; }
  const re = /"value":"([^"]+)","hex":"([^"]*)","stock":"?(\d+)/g;
  const sizes: RawOption[] = [];
  const colors: RawOption[] = [];
  const seenSize = new Set<string>();
  const seenColor = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const value = m[1];
    const hex = m[2];
    const stock = parseInt(m[3], 10);
    if (/^\d+$/.test(value)) continue; // skip numeric IDs
    if (hex) {
      if (!seenColor.has(value)) { seenColor.add(value); colors.push({ value, hex, stock }); }
    } else {
      if (!seenSize.has(value)) { seenSize.add(value); sizes.push({ value, hex, stock }); }
    }
  }

  // ── Single dimension: flat list ─────────────────────────────────────────
  if (sizes.length > 0 && colors.length === 0) {
    return sizes.map((s) => ({
      options: { Ukuran: s.value },
      price: productPrice,
      stock: s.stock,
    }));
  }
  if (colors.length > 0 && sizes.length === 0) {
    return colors.map((c) => ({
      options: { Warna: c.value },
      price: productPrice,
      stock: c.stock,
      hex: c.hex,
    }));
  }

  // ── Multi dimension: cartesian product (size × color) ───────────────────
  const variants: ScraperVariant[] = [];
  for (const s of sizes) {
    for (const c of colors) {
      // Best-effort stock per combination: use the size's stock (color stock is
      // usually an aggregate, not per-combination). This may overcount total
      // inventory but is the safest fallback without parsing children[].
      variants.push({
        options: { Warna: c.value, Ukuran: s.value },
        price: productPrice,
        stock: s.stock,
        hex: c.hex,
      });
    }
  }
  return variants;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
