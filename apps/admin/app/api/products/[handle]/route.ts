import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { getProduct, updateProduct, type ProductPatch } from "@/lib/products";
import { fetchExistingVendors } from "@/lib/shopify";
import { canonicalizeUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["SUPER_ADMIN", "MARKETPLACE_ADMIN", "CONTENT_EDITOR"] as const;

// GET /api/products/[handle] → full product detail for the editor.
export async function GET(
  _request: Request,
  context: { params: { handle: string } },
) {
  try {
    await requireAdmin([...EDIT_ROLES]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  try {
    const handle = decodeURIComponent(context.params.handle);
    const product = await getProduct(handle);
    if (!product) return jsonError(404, `Produk "${handle}" tidak ditemukan.`);

    // Link the live product back to its import job so manual edits can be
    // flagged and a later re-import can warn before overwriting.
    const job = await prisma.importJob.findFirst({
      where: { shopifyProductId: String(product.id) },
      orderBy: { createdAt: "desc" },
      select: { id: true, sourceUrl: true, manuallyEditedAt: true },
    });

    const vendors = await fetchExistingVendors().catch(() => [] as string[]);

    return NextResponse.json({
      product: { ...product, manuallyEdited: Boolean(job?.manuallyEditedAt) },
      job: job ? { id: job.id, sourceUrl: job.sourceUrl } : null,
      vendors,
    });
  } catch (e: any) {
    return jsonError(502, `Gagal memuat produk: ${e?.message || e}`);
  }
}

// PATCH /api/products/[handle] → write edits straight to Shopify.
export async function PATCH(
  request: Request,
  context: { params: { handle: string } },
) {
  try {
    await requireAdmin([...EDIT_ROLES]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  let body: ProductPatch;
  try {
    body = (await request.json()) as ProductPatch;
  } catch {
    return jsonError(400, "Body JSON tidak valid.");
  }
  if (!body || typeof body !== "object") {
    return jsonError(400, "Body wajib berisi perubahan produk.");
  }

  const handle = decodeURIComponent(context.params.handle);
  // The canonical source URL is managed by the import pipeline; never let the
  // editor rewrite it into something that would break future re-imports.
  if (body.metafields?.source_url) {
    body.metafields.source_url = canonicalizeUrl(body.metafields.source_url);
  }

  try {
    const result = await updateProduct(handle, body);

    // Flag the matching import job so a re-import asks before overwriting.
    await prisma.importJob
      .updateMany({
        where: { shopifyProductId: String(result.productId) },
        data: { manuallyEditedAt: new Date() },
      })
      .catch(() => {});

    return NextResponse.json(result);
  } catch (e: any) {
    return jsonError(400, e?.message || String(e));
  }
}
