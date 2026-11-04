import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { sniffImage, isSvg } from "@/lib/image-utils";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAdmin, jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BUCKET = "products";
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_BYTES = 1024;
const MAX_FILES = 10;

// POST multipart/form-data with a `files` field → uploads images to Supabase
// Storage (content-addressed) and returns their public URLs.
export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Body harus multipart/form-data.");
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return jsonError(400, "Field `files` wajib.");
  const oversized = files.find((f) => f.size > MAX_BYTES);
  if (oversized) {
    return jsonError(
      413,
      `File "${oversized.name}" terlalu besar (${Math.round(oversized.size / 1024 / 1024)} MB > 20 MB).`,
    );
  }
  if (files.length > MAX_FILES) {
    return jsonError(400, `Maksimal ${MAX_FILES} file per upload.`);
  }

  try {
    supabaseAdmin();
  } catch (e: any) {
    return jsonError(500, e.message);
  }

  const uploaded: { url: string; width?: number; height?: number }[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    try {
      if (file.size > MAX_BYTES) {
        rejected.push({ name: file.name, reason: `Terlalu besar (${file.size} byte > 20 MB)` });
        continue;
      }
      if (file.size < MIN_BYTES) {
        rejected.push({ name: file.name, reason: `Terlalu kecil (${file.size} byte)` });
        continue;
      }

      const buf = new Uint8Array(await file.arrayBuffer());

      if (isSvg(new TextDecoder().decode(buf.slice(0, 4096)))) {
        rejected.push({ name: file.name, reason: "SVG tidak didukung" });
        continue;
      }

      const info = sniffImage(buf);
      if (!info) {
        rejected.push({ name: file.name, reason: "Bukan file gambar yang valid" });
        continue;
      }

      const hash = createHash("sha1").update(buf).digest("hex");
      const key = `uploads/${hash}.${info.ext}`;

      const { error } = await supabaseAdmin()
        .storage
        .from(BUCKET)
        .upload(key, buf, {
          contentType: info.mime,
          upsert: true,
          cacheControl: "31536000",
        });
      if (error) throw new Error(error.message);

      const { data } = supabaseAdmin()
        .storage
        .from(BUCKET)
        .getPublicUrl(key);

      uploaded.push({ url: data.publicUrl, width: info.width, height: info.height });
    } catch (e: any) {
      rejected.push({ name: file.name, reason: e?.message || String(e) });
    }
  }

  return NextResponse.json({ uploaded, rejected });
}
