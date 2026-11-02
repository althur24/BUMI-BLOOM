// Pure image helpers: magic-byte sniffing, dimensions, CDN URL upgrading and
// size-chart detection. No network access so they are safe to unit test.

export interface ImageInfo {
  mime: string;
  ext: "jpg" | "png" | "gif" | "webp" | "avif" | "svg";
  width?: number;
  height?: number;
}

function u16be(b: Uint8Array, o: number) {
  return (b[o] << 8) | b[o + 1];
}
function u16le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32be(b: Uint8Array, o: number) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function u24le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}

function jpegSize(b: Uint8Array): { width?: number; height?: number } {
  let off = 2;
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = b[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = u16be(b, off + 2);
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      return { height: u16be(b, off + 5), width: u16be(b, off + 7) };
    }
    off += 2 + len;
  }
  return {};
}

function webpSize(b: Uint8Array): { width?: number; height?: number } {
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === "VP8 ") {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return {
      width: u24le(b, 24) + 1,
      height: u24le(b, 27) + 1,
    };
  }
  return {};
}

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (!bytes || bytes.length < 12) return null;
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg", ...jpegSize(bytes) };
  }
  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return {
      mime: "image/png",
      ext: "png",
      width: u32be(bytes, 16),
      height: u32be(bytes, 20),
    };
  }
  // GIF
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return { mime: "image/gif", ext: "gif", width: u16le(bytes, 6), height: u16le(bytes, 8) };
  }
  // WebP
  if (
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp", ...webpSize(bytes) };
  }
  // AVIF/HEIF: ftyp box
  if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp") {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "avif" || brand === "avis") {
      return { mime: "image/avif", ext: "avif" };
    }
  }
  return null;
}

export function isSvg(text: string): boolean {
  return /^\s*<svg[\s>]/i.test(text.slice(0, 2048));
}

// ── URL upgrading ──────────────────────────────────────────────────────────

const RESIZE_QUERY_KEYS = new Set([
  "w",
  "width",
  "h",
  "height",
  "q",
  "quality",
  "fit",
  "crop",
  "format",
  "auto",
  "impolicy",
  "imageview2",
  "imageview",
  "resize",
  "size",
  "thumbnail",
  "thumb",
]);

function isResizeParam(key: string): boolean {
  const k = key.toLowerCase();
  return RESIZE_QUERY_KEYS.has(k) || k.startsWith("imageview") || k.startsWith("x-oss-process");
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of list) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

// Returns URL candidates ordered best-quality → fallback. The storage layer
// tries them in order until one downloads and validates.
export function imageUrlCandidates(raw: string): string[] {
  const out: string[] = [];
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return [raw];
  }

  // Strip resize-only query params (keep signature params).
  const keptParams: [string, string][] = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (!isResizeParam(k)) keptParams.push([k, v]);
  }
  const stripped = new URL(u.href);
  stripped.search = "";
  for (const [k, v] of keptParams) stripped.searchParams.append(k, v);
  const strippedHref = stripped.href;

  const path = u.pathname;

  // Tokopedia signed CDN transforms: <hash>~tplv-<vendor>-<op>:<w>:<h>.<ext>.
  // The same asset is available at larger widths, so try those before falling
  // back to the small transform the page happened to render.
  const tplv = path.match(/^(.*~tplv-[^:]+):(\d+):(\d+)\.(webp|jpe?g|png)$/i);
  if (tplv) {
    const origSize = Number(tplv[2]) || 0;
    // Try larger sizes first, but include sizes that are >= the original so a
    // rejected (403) upscale falls back to a transform the CDN accepts.
    const sizes = [1600, 1200, 1000, 700].filter((n) => n !== origSize);
    for (const size of sizes) {
      out.push(`${u.origin}${tplv[1]}:${size}:0.${tplv[4]}${stripped.search}`);
    }
    out.push(`${u.origin}${tplv[1]}:${origSize}:${tplv[3]}.${tplv[4]}${stripped.search}`);
  }

  // CloudFront/Nuxt image proxy: name_1791432827732_resized1024-jpeg.webp
  const resized = path.match(/^(.*)_resized\d+(-[a-z0-9]+)?\.(webp|jpe?g|png)$/i);
  if (resized) {
    const base = resized[1];
    const origExt = (resized[2] || "").replace(/^-/, "").toLowerCase() || "jpeg";
    const ext = origExt === "jpg" ? "jpeg" : origExt;
    out.push(`${u.origin}${base}.${ext}`);
    for (const size of [2048, 1024, 512]) {
      out.push(`${u.origin}${base}_resized${size}-${ext}.webp`);
    }
  }

  // Tokopedia image cache: /img/cache/<size>/. "original" often 500s while
  // 1500/1000 are resized copies, so try both orders.
  if (/\/img\/cache\/(?:original|\d+)\//i.test(path)) {
    for (const size of ["original", "1500", "1200", "1000", "800", "700", "500", "300"]) {
      out.push(strippedHref.replace(/\/img\/cache\/(?:original|\d+)\//i, `/img/cache/${size}/`));
    }
    for (const size of ["1500", "1200", "1000", "700"]) {
      out.push(strippedHref.replace(/\/img\/cache\/(?:original|\d+)\//i, `/img/cache/${size}/`));
    }
  }

  // Shopify: _2048x2048, _1024x, @2x
  const shopify = path.match(/^(.*?)(?:_(\d+)x(\d*)|@(\d)x)(\.[a-z0-9]+)$/i);
  if (shopify) {
    out.push(`${u.origin}${shopify[1]}${shopify[5]}${stripped.search}`);
  }

  // WooCommerce/WordPress: -1024x768
  const woo = path.match(/^(.*?)-\d+x\d+(\.[a-z0-9]+)$/i);
  if (woo) {
    out.push(`${u.origin}${woo[1]}${woo[2]}${stripped.search}`);
  }

  out.push(strippedHref);
  out.push(u.href);
  return uniq(out);
}

// Content hash embedded in Tokopedia/CloudFront asset paths. The same photo is
// exposed through several hosts (p16/p19 CDNs and images.tokopedia.net) and
// several transforms, so the asset id is the most reliable identity.
// Supabase storage objects are content addressed (imports/<sha1>.<ext>), so the
// hash identifies the image regardless of query string.
function contentHashKey(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/public\/[^/]+\/imports\/([0-9a-f]{40})\./i);
  return m ? m[1].toLowerCase() : null;
}

function tokopediaAssetKey(url: string): string | null {
  const m = url.match(/([0-9a-f]{24,40})~/i) || url.match(/\/([0-9a-f]{32})\./i);
  if (m) return m[1].toLowerCase();
  const cloudfront = url.match(/([0-9a-f]{16,40})_[0-9]{10,}\.(?:jpe?g|png|webp)/i);
  if (cloudfront) return cloudfront[1].toLowerCase();
  return null;
}

// Identity used for dedupe (ignores CDN transform suffix/query and mirror
// hosts such as Tokopedia's p16/p19 image hosts).
export function imageIdentity(raw: string): string {
  const first = imageUrlCandidates(raw)[0] || raw;
  try {
    const u = new URL(first);
    let path = u.pathname;
    path = path.replace(/~tplv[^/]*$/i, "");
    path = path.replace(/_resized\d+(?:-[a-z0-9]+)?\.(?:webp|jpe?g|png)$/i, "");
    let host = u.hostname.toLowerCase();
    // Tokopedia serves the same asset from p16-/p19- mirror hosts with
    // -sign/-common suffixes; fold those into one identity.
    host = host.replace(/^p\d+-/, "").replace(/-sign\b/g, "").replace(/-common\b/g, "");
    const contentKey = contentHashKey(first);
    if (contentKey) return `supabase:${contentKey}`;
    const assetKey = tokopediaAssetKey(first);
    if (assetKey) return `tokopedia:${assetKey}`;
    return `${host}${path}`.toLowerCase();
  } catch {
    return String(first).split("?")[0].toLowerCase();
  }
}

// Rough quality score from the URL itself (larger width = better). Used to
// keep the best variant when several CDN transforms share one base image.
export function imageQualityScore(raw: string): number {
  const candidates = imageUrlCandidates(raw);
  if (candidates.length > 1) {
    // Score the best URL this asset could be fetched from, so an upgradeable
    // mirror is not judged by its original (possibly 150px) URL.
    return Math.max(...candidates.map((c) => scoreOneUrl(c)), scoreOneUrl(raw));
  }
  return scoreOneUrl(String(raw || ""));
}

function scoreOneUrl(raw: string): number {
  const u = String(raw || "");
  const tplv = u.match(/~tplv-[^:]+:([0-9]+)(?::([0-9]+))?\./);
  if (tplv) return Math.max(Number(tplv[1]) || 0, Number(tplv[2]) || 0);
  // A URL without a resize transform points at the untouched original, which
  // is always better than a CDN re-encode/upscale.
  const resized = u.match(/_resized(\d+)/i);
  if (resized) return Number(resized[1]) || 0;
  const dim = u.match(/[_-](\d{3,4})x(\d{3,4})\./);
  if (dim) return Number(dim[1]) || 0;
  const cache = u.match(/\/img\/cache\/(\d+)\//i);
  if (cache) return Number(cache[1]) || 0;
  if (/[?&](?:w|width)=(\d+)/i.test(u)) {
    const m = u.match(/[?&](?:w|width)=(\d+)/i);
    return m ? Number(m[1]) : 0;
  }
  return 10000;
}

export function isLikelySizeChart(url: string, alt?: string): boolean {
  const s = `${url} ${alt || ""}`.toLowerCase();
  return /size[-_\s]?(chart|guide|table)|panduan[-_\s]?ukuran|ukuran[-_\s]?badan|sizechart|sizeguide/.test(s);
}

export function isLikelyAsset(url: string, alt?: string): boolean {
  const s = `${url} ${alt || ""}`.toLowerCase();
  if (
    /\/pdp\/icons\/|\/assets?\/(?:icon|sprite)|shopcredibility|banner|promo[-_/]|voucher|giftcard/.test(s) ||
    /(?:^|\/)icon\d{2,4}\.png|apple-touch-icon|manifest\.json|favicon/.test(s) ||
    /zeus_v2\/[0-9a-f]{6,}\.(?:png|jpe?g|webp|svg)$/.test(s) ||
    /\/obj\/[a-z-]+\/zeus_v2\//.test(s)
  ) {
    return true;
  }
  return /(logo|favicon|sprite|placeholder|payment|visa|mastercard|paypal|flag[-_/]|avatar|badge[-_/]|icon[-_/])/.test(
    s,
  );
}

// Parse a srcset attribute and return the largest candidate plus all candidates.
export function parseSrcset(srcset: string): { best?: string; all: string[] } {
  const entries = String(srcset || "")
    .split(/,(?=\s*\S)/)
    .map((part) => part.trim())
    .filter(Boolean);
  let best: string | undefined;
  let bestScore = -1;
  const all: string[] = [];
  for (const entry of entries) {
    const [url, descriptor] = entry.split(/\s+/, 2);
    if (!url) continue;
    all.push(url);
    let score = 1;
    if (descriptor) {
      const w = descriptor.match(/^(\d+)w$/i);
      const x = descriptor.match(/^([\d.]+)x$/i);
      if (w) score = Number(w[1]);
      else if (x) score = Number(x[1]) * 1000;
    }
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }
  return { best, all };
}

export function decodeHtmlEntities(value: string): string {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/");
}

export function hasImageExtension(url: string): boolean {
  return /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(url);
}

export function longEdge(width?: number, height?: number): number {
  return Math.max(width || 0, height || 0);
}
