// Re-host product images into Supabase Storage so Shopify can fetch them.
//
// Images are downloaded once, validated (magic bytes + dimensions), deduped by
// content hash, stored content-addressed and never re-encoded — this keeps the
// best available quality. The returned report is surfaced in the admin preview
// and stored on the import job for auditing.

import { createHash } from "node:crypto";
import type { ImageReport, ImageReportItem } from "./scrapers/base";
import { sniffImage, imageUrlCandidates, longEdge, isSvg } from "./image-utils";
import { safeFetchBytes } from "./safe-fetch";
import { supabaseAdmin } from "./supabase-server";

const BUCKET = "products";
const MAX_IMAGES = 50;
const MAX_CANDIDATES = 5;
const MIN_BYTES = 4 * 1024;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_LONG_EDGE = 200;
const LOW_RES_EDGE = 600;
const CONCURRENCY = 4;

export interface RehostOptions {
  referer?: string;
}

export interface RehostResult {
  urls: string[];
  report: ImageReport;
  // Maps every input source URL to its re-hosted public URL. Used to remap
  // per-colour images and variant images after upload.
  map: Map<string, string>;
}

function refererFor(url: string, sourceReferer?: string): string | undefined {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("tokopedia")) return "https://www.tokopedia.com/";
    if (host.includes("shopee") || host.includes("susercontent")) return "https://shopee.co.id/";
    if (sourceReferer) return sourceReferer;
    return u.origin + "/";
  } catch {
    return sourceReferer;
  }
}

async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

interface DownloadedImage {
  publicUrl: string;
  report: ImageReportItem;
  hash: string;
}

async function downloadBest(
  rawUrl: string,
  sourceReferer?: string,
): Promise<{ bytes: Uint8Array; mime: string; ext: string; width?: number; height?: number; sourceUrl: string }> {
  const candidates = imageUrlCandidates(rawUrl).slice(0, MAX_CANDIDATES);
  let lastError = "Tidak ada kandidat URL";
  for (const candidate of candidates) {
    try {
      const referer = refererFor(candidate, sourceReferer);
      const res = await safeFetchBytes(candidate, {
        timeoutMs: 30_000,
        maxBytes: MAX_BYTES,
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          ...(referer ? { Referer: referer } : {}),
        },
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      if (res.bytes.byteLength < MIN_BYTES) {
        lastError = `Terlalu kecil (${res.bytes.byteLength} byte)`;
        continue;
      }
      if (isSvg(new TextDecoder().decode(res.bytes.slice(0, 4096)))) {
        lastError = "SVG tidak didukung";
        continue;
      }
      const info = sniffImage(res.bytes);
      if (!info) {
        lastError = "Bukan gambar yang valid";
        continue;
      }
      const edge = longEdge(info.width, info.height);
      if (edge && edge < MIN_LONG_EDGE) {
        lastError = `Resolusi terlalu kecil (${info.width}×${info.height})`;
        continue;
      }
      return {
        bytes: res.bytes,
        mime: info.mime,
        ext: info.ext === "jpg" ? "jpg" : info.ext,
        width: info.width,
        height: info.height,
        sourceUrl: candidate,
      };
    } catch (e: any) {
      lastError = e?.message || String(e);
    }
  }
  throw new Error(lastError);
}

async function uploadOne(
  rawUrl: string,
  sourceReferer: string | undefined,
  seenHashes: Set<string>,
  hashToPublic: Map<string, string>,
): Promise<DownloadedImage | null> {
  const supabase = supabaseAdmin();
  const img = await downloadBest(rawUrl, sourceReferer);
  const hash = createHash("sha1").update(img.bytes).digest("hex");

  const cached = hashToPublic.get(hash);
  if (cached) {
    return {
      hash,
      publicUrl: cached,
      report: {
        sourceUrl: img.sourceUrl,
        publicUrl: cached,
        width: img.width,
        height: img.height,
        bytes: img.bytes.byteLength,
        mime: img.mime,
        lowRes: longEdge(img.width, img.height) > 0 && longEdge(img.width, img.height) < LOW_RES_EDGE,
      },
    };
  }

  const key = `imports/${hash}.${img.ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(key, img.bytes, {
    contentType: img.mime,
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`Upload gagal: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  hashToPublic.set(hash, data.publicUrl);
  return {
    hash,
    publicUrl: data.publicUrl,
    report: {
      sourceUrl: img.sourceUrl,
      publicUrl: data.publicUrl,
      width: img.width,
      height: img.height,
      bytes: img.bytes.byteLength,
      mime: img.mime,
      lowRes: longEdge(img.width, img.height) > 0 && longEdge(img.width, img.height) < LOW_RES_EDGE,
    },
  };
}

// Returns public URLs of successfully re-hosted images (in order) plus a report.
// Throws if Supabase is not configured (caller falls back to original URLs).
export async function rehostImages(
  urls: string[],
  opts: RehostOptions = {},
): Promise<RehostResult> {
  const map = new Map<string, string>();
  const input = (urls || []).filter(Boolean).slice(0, MAX_IMAGES);
  const report: ImageReport = { total: input.length, used: 0, items: [], rejected: [] };
  if (!input.length) return { urls: [], report, map };

  // Fail fast when storage is not configured.
  supabaseAdmin();

  const seenHashes = new Set<string>();
  const hashToPublic = new Map<string, string>();
  const results = await pool(input, CONCURRENCY, async (url) => {
    try {
      return await uploadOne(url, opts.referer, seenHashes, hashToPublic);
    } catch (e: any) {
      report.rejected.push({ url, reason: e?.message || String(e) });
      return null;
    }
  });

  const out: string[] = [];
  const seenPublic = new Set<string>();
  results.forEach((r, i) => {
    if (!r) return;
    map.set(input[i], r.publicUrl);
    if (seenPublic.has(r.publicUrl)) return;
    seenPublic.add(r.publicUrl);
    out.push(r.publicUrl);
    report.items.push(r.report);
  });
  report.used = out.length;
  return { urls: out, report, map };
}
