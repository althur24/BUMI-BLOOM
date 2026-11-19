import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import type { ImportSource } from "@prisma/client";
import { requireAdmin, jsonError } from "@/lib/auth";
import { parseTokopediaHtml } from "@/lib/scrapers/tokopedia";
import { detectPlatform } from "@/lib/platform";
import { canonicalizeUrl } from "@/lib/urls";
import { assertHttpUrl } from "@/lib/safe-fetch";

export const dynamic = "force-dynamic";

// POST /api/imports/from-html { url, html }
// Fallback for when the server IP is blocked by the marketplace (e.g. Railway →
// Tokopedia times out). The admin copies the product page HTML from their own
// browser (residential IP) and the server only parses it — no marketplace
// network access. Creates an EXTRACTED job so the normal preview/push flow works.
const MIN_HTML = 2_000;
const MAX_HTML = 4_000_000;

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body JSON tidak valid");
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const html = typeof body?.html === "string" ? body.html : "";
  if (!url) return jsonError(400, "URL produk wajib diisi.");
  try {
    assertHttpUrl(url);
  } catch (e: any) {
    return jsonError(400, e?.message || "URL tidak valid.");
  }
  if (!html || html.length < MIN_HTML) {
    return jsonError(
      400,
      "HTML kosong atau terlalu pendek. Salin SELURUH halaman produk (bukan sebagian).",
    );
  }
  if (html.length > MAX_HTML) {
    return jsonError(413, "HTML terlalu besar — salin halaman produk saja.");
  }

  const platform = detectPlatform(url);
  if (platform !== "TOKPED") {
    return jsonError(
      400,
      "Mode tempel HTML saat ini hanya mendukung Tokopedia.",
    );
  }

  const result = parseTokopediaHtml(url, html);
  if (!result.ok || !result.normalized) {
    return jsonError(422, result.error || "Gagal mem-parsing HTML.");
  }

  const sourceKey = canonicalizeUrl(url);
  const job = await prisma.importJob.create({
    data: {
      sourceUrl: url,
      sourceKey,
      sourceType: platform as ImportSource,
      status: "EXTRACTED",
      extractedJson: result.normalized as any,
      rawJson: { step: "from-html" } as any,
      createdBy: ctx.email,
    },
  });

  return NextResponse.json({ jobId: job.id, status: "EXTRACTED" }, { status: 201 });
}
