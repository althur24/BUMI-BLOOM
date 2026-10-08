// Shopee adapter. Shopee is heavily JS + anti-bot. Product pages expose data
// in JSON-LD (when present) and window.__PRELOADED_STATE__ / the item API.
// Strategy: JSON-LD first → __PRELOADED_STATE__ deep-search by itemid/shopid.
//
// NOTE: Shopee's anti-bot (device fingerprint + token signing + captcha) often
// blocks headless even with stealth. If extraction fails repeatedly, switch to
// the Shopee Affiliate API (Fase 5) which is the stable path.

import { withPage, readJsonLd } from "./browser";
import {
  extractProductFromJsonLd,
  toNum,
  type NormalizedProduct,
  type ScrapeResult,
} from "./base";

// Shopee URLs embed `i.{shopid}.{itemid}` at the end.
function parseIds(url: string): { shopid?: string; itemid?: string } {
  const m = url.match(/i\.(\d+)\.(\d+)/);
  return m ? { shopid: m[1], itemid: m[2] } : {};
}

export async function scrapeShopee(url: string): Promise<ScrapeResult> {
  const ids = parseIds(url);
  try {
    return await withPage(
      async (page) => {
        const jsonLd = await readJsonLd(page);
        const partial = extractProductFromJsonLd(jsonLd);

        const state = await page.evaluate(
          () => (window as any).__PRELOADED_STATE__ ?? null,
        );

        const pageTitle = await page.title().catch(() => "");
        const title = partial?.title || (pageTitle && pageTitle !== "Shopee" ? pageTitle : undefined);

        if (!title) {
          return {
            ok: false,
            error:
              "Tidak bisa parse Shopee (anti-bot/captcha/headless terdeteksi). Pertimbangkan Shopee Affiliate API.",
            raw: { jsonLdCount: jsonLd.length, ids },
          };
        }

        const normalized: NormalizedProduct = {
          platform: "SHOPEE",
          sourceUrl: url,
          title,
          description: partial?.description,
          price: partial?.price,
          currency: partial?.currency || "IDR",
          images: partial?.images || [],
          variants: [],
          brand: partial?.brand,
          rating: partial?.rating,
        };

        // Fill gaps from preloaded state, keyed by itemid when available.
        if (state && (!normalized.price || normalized.images.length === 0)) {
          const extra = deepFindShopeeItem(state, ids.itemid);
          if (extra) {
            normalized.price ??= extra.price;
            if (normalized.images.length === 0)
              normalized.images = extra.images || [];
            normalized.description ??= extra.description;
          }
        }

        return { ok: true, raw: { jsonLdCount: jsonLd.length, ids }, normalized };
      },
      { url },
    );
  } catch (e) {
    return { ok: false, error: errMsg(e), raw: { ids } };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Shopee item objects carry: itemid, shopid, price (scaled), images[] of
// { image_signature, url }, name, description. We BFS for the matching itemid
// (or the first plausible item object).
function deepFindShopeeItem(
  root: unknown,
  itemid?: string,
): Partial<NormalizedProduct> | null {
  const queue: unknown[] = [root];
  let visited = 0;
  let fallback: Partial<NormalizedProduct> | null = null;
  while (queue.length && visited < 120000) {
    visited++;
    const n = queue.shift() as any;
    if (!n || typeof n !== "object") continue;
    const isItem =
      (n.itemid != null && (n.price != null || n.images)) ||
      (n.item != null && typeof n.item === "object");
    const item = n.item && typeof n.item === "object" ? n.item : n;
    if (isItem && (item.price != null || item.images)) {
      const parsed = parseShopeeItem(item);
      if (parsed) {
        if (itemid && String(item.itemid) === String(itemid)) return parsed;
        if (!fallback) fallback = parsed;
      }
    }
    for (const k of Object.keys(n)) queue.push(n[k]);
  }
  return fallback;
}

function parseShopeeItem(item: any): Partial<NormalizedProduct> | null {
  const rawImgs = [item.images].flat();
  const images: string[] = [];
  for (const img of rawImgs) {
    if (!img) continue;
    if (typeof img === "string") images.push(img);
    else if (img?.url) images.push(img.url);
  }
  // Use the raw state price as-is. Shopee's `price` scaling varies across
  // versions and blind division corrupts >1M IDR values, so we don't guess —
  // JSON-LD (correct) is primary, and the admin can edit the preview price.
  const price = toNum(item.price);
  return {
    title: item.name,
    description: item.description,
    price,
    images,
    brand: typeof item.brand === "string" ? item.brand : item.brand?.name,
  };
}
