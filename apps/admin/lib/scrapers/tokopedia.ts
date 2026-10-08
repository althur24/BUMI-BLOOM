// Tokopedia adapter. Tokopedia is a Next.js SSR app: it embeds product data in
// both JSON-LD (<script type="application/ld+json">) and __NEXT_DATA__.
// Strategy: JSON-LD first (most stable) → __NEXT_DATA__ deep-search fallback.

import { withPage, readJsonLd } from "./browser";
import {
  extractProductFromJsonLd,
  toNum,
  type NormalizedProduct,
  type ScrapeResult,
} from "./base";

export async function scrapeTokopedia(url: string): Promise<ScrapeResult> {
  try {
    return await withPage(
      async (page) => {
        const jsonLd = await readJsonLd(page);
        const partial = extractProductFromJsonLd(jsonLd);

        const nextData = await page.evaluate(() => {
          const el = document.getElementById("__NEXT_DATA__");
          if (!el?.textContent) return null;
          try {
            return JSON.parse(el.textContent);
          } catch {
            return null;
          }
        });

        const title =
          partial?.title ||
          (await page.title().catch(() => "")) ||
          undefined;

        if (!title) {
          return {
            ok: false,
            error:
              "Title tidak ditemukan — kemungkinan halaman butuh login atau anti-bot memblok render.",
            raw: { jsonLd },
          };
        }

        const normalized: NormalizedProduct = {
          platform: "TOKPED",
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

        // Fill gaps from __NEXT_DATA__ when JSON-LD was thin.
        if (nextData && (!normalized.price || normalized.images.length === 0)) {
          const extra = deepFindProduct(nextData);
          if (extra) {
            normalized.price ??= extra.price;
            if (normalized.images.length === 0)
              normalized.images = extra.images || [];
            normalized.description ??= extra.description;
            normalized.brand ??= extra.brand;
          }
        }

        return { ok: true, raw: { jsonLdCount: jsonLd.length, nextData }, normalized };
      },
      { url },
    );
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Heuristic BFS through __NEXT_DATA__ for a product-shaped object.
function deepFindProduct(
  root: unknown,
): Partial<NormalizedProduct> | null {
  const queue: unknown[] = [root];
  let visited = 0;
  while (queue.length && visited < 80000) {
    visited++;
    const n = queue.shift() as any;
    if (!n || typeof n !== "object") continue;
    const price = n.price ?? n.price_int ?? n.price_int_str;
    const hasImg = n.image_url || n.images || n.pictures;
    if (price != null && (hasImg || n.name)) {
      const rawImgs = [n.image_url, n.images, n.pictures].flat();
      const images: string[] = [];
      for (const img of rawImgs) {
        if (!img) continue;
        if (typeof img === "string") images.push(img);
        else if (img?.url) images.push(img.url);
        else if (img?.image_url) images.push(img.image_url);
      }
      return {
        title: n.name,
        description: n.description,
        price: toNum(price),
        images,
        brand: typeof n.brand === "string" ? n.brand : n.brand?.name,
      };
    }
    for (const k of Object.keys(n)) queue.push(n[k]);
  }
  return null;
}
