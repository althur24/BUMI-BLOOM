import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { ImportStatus } from "@prisma/client";
import { requireAdmin, jsonError } from "@/lib/auth";
import { pushProductToShopify } from "@/lib/shopify";
import { buildShopifyPushInput } from "@/lib/import-mapper";
import { rehostImages } from "@/lib/storage";
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
        const rehosted = await rehostImages(np.images);
        if (rehosted.length) np.images = rehosted;
      } catch {
        // Supabase not configured — keep originals (Shopify may fail to fetch).
      }
    }

    const input = buildShopifyPushInput(np);
    const res = await pushProductToShopify(input);
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
