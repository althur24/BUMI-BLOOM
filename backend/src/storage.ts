import { supabase } from "./lib/supabase.js";

export const BUCKETS = ["products", "brands", "editorial"] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * Upload a file buffer to a Supabase Storage bucket (upsert by path).
 * Returns the storage path on success; throws on error.
 */
export async function uploadToBucket(
  bucket: Bucket,
  storagePath: string,
  body: Buffer,
  mimeType: string,
): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(storagePath, body, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

/** Public read URL for an object in a public bucket. */
export function getPublicUrl(bucket: Bucket, storagePath: string): string {
  return supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
}

/** Build a unique storage path for an uploaded file, e.g. "products/2026/7/<cuid>.png". */
export function buildStoragePath(fileName: string, prefix = ""): string {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  const rand = Math.random().toString(36).slice(2, 10);
  const stamp = Date.now().toString(36);
  const base = `${stamp}-${rand}${ext}`;
  return prefix ? `${prefix.replace(/\/$/, "")}/${base}` : base;
}
