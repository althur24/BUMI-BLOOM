// Re-host marketplace images into Supabase Storage so Shopify can fetch them.
// Shopify's CDN cannot pull images from Shopee/Tokopedia (anti-hotlink /
// redirects), so every image must be copied to our own bucket first.

import { supabaseAdmin } from "./supabase-server";

const BUCKET = "products";
const FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_IMAGES = 20;

function mimeToExt(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

// Returns the public URLs of successfully re-hosted images (in order).
// Throws if Supabase is not configured (caller falls back to original URLs).
export async function rehostImages(urls: string[]): Promise<string[]> {
  const supabase = supabaseAdmin(); // throws if env missing
  const out: string[] = [];

  for (const url of urls.slice(0, MAX_IMAGES)) {
    if (!url) continue;
    try {
      // Referer = marketplace origin helps past anti-hotlink checks on some CDNs.
      let referer: string | undefined;
      try {
        referer = new URL(url).origin + "/";
      } catch {}
      const res = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": FETCH_UA,
          Accept: "image/*,*/*",
          ...(referer ? { Referer: referer } : {}),
        },
      });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image")) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      const ext = mimeToExt(contentType);
      const key = `imports/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(key, buf, { contentType, upsert: false });
      if (error) continue;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
      out.push(data.publicUrl);
    } catch {
      // skip a single bad image, keep going
    }
  }
  return out;
}
