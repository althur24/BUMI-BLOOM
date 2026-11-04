import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { ImportStatus } from "@prisma/client";
import { requireAdmin, jsonError } from "@/lib/auth";
import { pushProductToShopify, fetchExistingVendors, resolveVendorSimple } from "@/lib/shopify";
import { buildShopifyPushInput } from "@/lib/import-mapper";
import { rehostImages } from "@/lib/storage";
import { aiMatchVendor } from "@/lib/ai/enrich";
import { canonicalizeUrl } from "@/lib/urls";
import type { NormalizedProduct } from "@/lib/scrapers/base";

export const dynamic = "force-dynamic";

// POST → push an EXTRACTED job's product to Shopify (create + metafields +
// publish to Headless). Optional JSON body overrides fields (admin edits from
// the preview). On push failure, reverts to EXTRACTED so the admin can retry.
export async function POST(
  request: Request,
  context: { params: { id: string } },
) {
  try {
    await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  const job = await prisma.importJob.findUnique({
    where: { id: context.params.id },
  });
  if (!job) return jsonError(404, "Import job tidak ditemukan");
  if (job.status !== ImportStatus.EXTRACTED) {
    return jsonError(
      409,
      `Job status ${job.status} — harus EXTRACTED untuk push.`,
    );
  }

  // Optional body edits override extracted fields (title/price/images/...).
  let overrides: Partial<NormalizedProduct> = {};
  try {
    const body = await request.json();
    if (body && typeof body === "object") overrides = body;
  } catch {
    // no body → use extractedJson as-is
  }

  const base = (job.extractedJson ?? {}) as unknown as NormalizedProduct;
  const np: NormalizedProduct = { ...base, ...overrides } as NormalizedProduct;
  if (!np.title) return jsonError(400, "Title kosong — tidak bisa push.");
  if (np.price == null || !(np.price > 0)) {
    return jsonError(400, "Harga produk kosong/0 — set harga AUD sebelum push.");
  }
  if (np.variants.some((v) => v.price != null && !(v.price > 0))) {
    return jsonError(400, "Ada varian dengan harga 0 — perbaiki harga sebelum push.");
  }

  // If the user edited the product price, propagate it to ALL variants so the
  // edited price is what Shopify receives (not the auto-converted AUD price).
  if (overrides.price != null && np.variants.length > 0) {
    for (const v of np.variants) {
      v.price = overrides.price;
    }
  }

  // Persist the (edited) extraction + move to PUSHING.
  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: ImportStatus.PUSHING,
      extractedJson: np as any,
      errorMessage: null,
    },
  });

  try {
    // Ensure images are re-hosted to Supabase (Shopify can't fetch marketplace
    // URLs due to anti-hotlink). The queue tries this during extraction, but
    // re-attempt here in case Storage wasn't configured then or images were edited.
    const supabaseHost = process.env.SUPABASE_URL || "";
    const needsRehost = supabaseHost
      ? np.images.some((u) => !u.includes(supabaseHost))
      : np.images.length > 0;
    if (needsRehost && np.images.length) {
      try {
        const rehosted = await rehostImages(np.images, { referer: np.sourceUrl });
        if (rehosted.urls.length) np.images = rehosted.urls;
        np.imageReport = rehosted.report;
      } catch {
        // Supabase not configured — keep originals (Shopify may fail to fetch).
      }
    }

    // Re-host images that are not on our storage yet, including the size chart
    // and the per-colour images (needed for Shopify variant images).
    const colorSrcs = Object.values(np.colorImages || {}).filter(Boolean);
    const extras = [
      ...(np.sizeChartImage ? [np.sizeChartImage] : []),
      ...colorSrcs,
    ].filter((u) => supabaseHost && !u.includes(supabaseHost));
    if (extras.length) {
      try {
        const rehostedExtras = await rehostImages([...new Set(extras)], {
          referer: np.sourceUrl,
        });
        const remap = (u?: string) => (u ? rehostedExtras.map.get(u) || u : u);
        if (np.sizeChartImage) np.sizeChartImage = remap(np.sizeChartImage);
        if (np.colorImages) {
          np.colorImages = Object.fromEntries(
            Object.entries(np.colorImages).map(([k, v]) => [k, remap(v) as string]),
          );
        }
        // Colour images must be present in the product gallery to be usable.
        const gallerySet = new Set(np.images);
        for (const src of Object.values(np.colorImages || {})) {
          if (src && !gallerySet.has(src)) {
            np.images = [...np.images, src];
            gallerySet.add(src);
          }
        }
      } catch {
        // keep the original URLs
      }
    }

    // Resolve vendor: match scraped brand to existing Shopify vendor (case-
    // insensitive fuzzy + AI). Avoids duplicate vendors like
    // "sabineandheemofficial" vs "Sabine & Heem".
    if (np.brand) {
      try {
        const existing = await fetchExistingVendors();
        // 1) Simple normalization match (fast, free).
        let resolved = resolveVendorSimple(np.brand, existing);
        // 2) AI fuzzy match if simple match didn't find an existing vendor.
        if (resolved === np.brand && existing.length > 0) {
          const aiMatch = await aiMatchVendor(np.brand, existing);
          if (aiMatch) resolved = aiMatch;
        }
        // Safety net: the AI may only correct the FORMATTING of the same
        // brand (case, spaces, suffixes). It must never rewrite a brand into
        // a different vendor. Validate by running resolveVendorSimple on the
        // AI's suggestion — if the scraped brand and the AI suggestion are
        // not the same vendor per the same rules, reject the AI's answer.
        if (resolved !== np.brand) {
          const crossCheck = resolveVendorSimple(np.brand, [resolved]);
          if (crossCheck !== resolved) {
            resolved = np.brand; // not the same brand → keep the scraped brand
          }
        }
        np.brand = resolved;
      } catch {
        // vendor resolution failed (non-critical) — keep original brand.
      }
    }

    const input = buildShopifyPushInput(np, { handle: job.shopifyHandle || undefined });
    const res = await pushProductToShopify(input, {
      existingId: job.shopifyProductId,
      sourceUrl: job.sourceKey || canonicalizeUrl(job.sourceUrl),
    });
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportStatus.PUSHED,
        shopifyProductId: String(res.productId),
        shopifyHandle: input.handle,
        shopifyAdminUrl: res.shopifyAdminUrl,
      },
    });
    return NextResponse.json({
      ok: true,
      shopifyProductId: res.productId,
      shopifyHandle: input.handle,
      shopifyAdminUrl: res.shopifyAdminUrl,
      warnings: res.warnings,
    });
  } catch (e: any) {
    // Push failed — revert to EXTRACTED (retryable) and keep the error message.
    await prisma.importJob
      .update({
        where: { id: job.id },
        data: {
          status: ImportStatus.EXTRACTED,
          errorMessage: e?.message || String(e),
        },
      })
      .catch(() => {});
    return jsonError(502, `Push ke Shopify gagal: ${e?.message || e}`);
  }
}
