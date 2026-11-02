// Image candidate collection shared by all scrapers. Scrapers return the best
// possible source URLs here; the storage layer downloads/validates/ranks them.

import {
  decodeHtmlEntities,
  hasImageExtension,
  imageIdentity,
  isLikelyAsset,
  isLikelySizeChart,
  imageQualityScore,
  parseSrcset,
} from "../image-utils";
import { resolveUrl } from "../urls";

export interface ImagePlan {
  images: string[];
  sizeChartImage?: string;
}

function pushUnique(out: string[], seen: Set<string>, raw: string) {
  const url = String(raw || "").trim();
  if (!url || url.startsWith("data:")) return;
  if (!/^https?:\/\//i.test(url)) return;
  const key = imageIdentity(url);
  if (seen.has(key)) {
    // Another CDN transform of the same image — keep the larger one.
    const index = out.findIndex((existing) => imageIdentity(existing) === key);
    if (index >= 0 && imageQualityScore(url) > imageQualityScore(out[index])) {
      out[index] = url;
    }
    return;
  }
  seen.add(key);
  out.push(url);
}

// Best-effort extraction from raw HTML: open-graph/Twitter meta, lazy-load
// attributes, srcset and inline background images. Structured data (JSON-LD /
// state) remains the primary, ordered source; this fills the gaps.
export function extractImageCandidates(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const source = decodeHtmlEntities(String(html || ""));

  const meta = (prop: string) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
      "i",
    );
    const m = source.match(re);
    if (m) {
      const url = resolveUrl(pageUrl, m[1]);
      if (url) pushUnique(out, seen, url);
    }
  };
  for (const p of [
    "og:image",
    "og:image:secure_url",
    "twitter:image",
    "twitter:image:src",
    "image",
  ]) {
    meta(p);
  }

  const attrRe =
    /\b(?:src|data-src|data-original|data-zoom-image|data-large_image|data-lazy-src|data-image|data-old-hires|data-highres)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(source)) !== null) {
    const url = resolveUrl(pageUrl, m[1]);
    if (url && hasImageExtension(url)) pushUnique(out, seen, url);
  }

  const srcsetRe = /\b(?:srcset|data-srcset)=["']([^"']+)["']/gi;
  while ((m = srcsetRe.exec(source)) !== null) {
    const parsed = parseSrcset(m[1]);
    const urls = [parsed.best, ...parsed.all].filter(Boolean) as string[];
    for (const candidate of urls) {
      const url = resolveUrl(pageUrl, candidate);
      if (url && hasImageExtension(url)) pushUnique(out, seen, url);
    }
  }

  const bgRe = /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  while ((m = bgRe.exec(source)) !== null) {
    const url = resolveUrl(pageUrl, m[1]);
    if (url && hasImageExtension(url)) pushUnique(out, seen, url);
  }

  // Absolute image URLs that appear inside escaped JSON/state blobs.
  const absRe = /https?:\/\/[^\s"'<>\\]+?\.(?:jpe?g|png|webp|gif|avif)(?:\?[^\s"'<>\\]*)?/gi;
  let absCount = 0;
  while ((m = absRe.exec(source)) !== null && absCount < 80) {
    const url = decodeHtmlEntities(m[0]);
    if (hasImageExtension(url)) {
      pushUnique(out, seen, url);
      absCount++;
    }
  }

  return out;
}

function scopeKey(raw: string): string {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
    return `${u.hostname.toLowerCase()}/${parts}`;
  } catch {
    return "";
  }
}

export function buildImagePlan(opts: {
  structured?: string[];
  html?: string;
  pageUrl?: string;
  limit?: number;
}): ImagePlan {
  const limit = opts.limit ?? 20;
  const candidates: string[] = [];

  for (const raw of opts.structured || []) {
    const url = /^https?:\/\//i.test(raw)
      ? raw
      : opts.pageUrl
        ? resolveUrl(opts.pageUrl, raw) || ""
        : "";
    if (url) candidates.push(url);
  }

  const structuredCount = candidates.length;
  const scope = structuredCount >= 3 ? scopeKey(candidates[0]) : "";
  if (opts.html && opts.pageUrl) {
    for (const url of extractImageCandidates(opts.html, opts.pageUrl)) {
      // When structured data already provides a gallery, only accept HTML
      // extras from the same product folder — otherwise banners/logos from the
      // rest of the site leak into the product gallery.
      if (scope && scopeKey(url) !== scope) continue;
      candidates.push(url);
    }
  }

  // Keep the highest-quality URL for each image identity, preserving the
  // order in which each identity first appeared.
  const order: string[] = [];
  const best = new Map<string, string>();
  for (const url of candidates) {
    if (!/^https?:\/\//i.test(url) || isLikelyAsset(url)) continue;
    const key = imageIdentity(url);
    if (!best.has(key)) order.push(key);
    const current = best.get(key);
    if (!current || imageQualityScore(url) > imageQualityScore(current)) {
      best.set(key, url);
    }
  }

  let urls = order.map((key) => best.get(key)!).filter(Boolean);
  // Drop thumbnail-sized CDN transforms (e.g. 200px colour chips) when the
  // page already exposed several high-resolution images.
  const highRes = urls.filter((u) => imageQualityScore(u) >= 600).length;
  if (highRes >= 3) {
    urls = urls.filter((u) => {
      const score = imageQualityScore(u);
      return score === 0 || score >= 600;
    });
  }

  let sizeChartImage: string | undefined;
  const gallery: string[] = [];
  for (const url of urls) {
    if (!sizeChartImage && isLikelySizeChart(url)) {
      sizeChartImage = url;
      continue;
    }
    gallery.push(url);
  }

  return { images: gallery.slice(0, limit), sizeChartImage };
}
