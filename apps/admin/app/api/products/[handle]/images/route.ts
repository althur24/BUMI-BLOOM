import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { adminRest } from "@/lib/shopify";
import { getProduct } from "@/lib/products";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["SUPER_ADMIN", "MARKETPLACE_ADMIN", "CONTENT_EDITOR"] as const;

// POST /api/products/[handle]/images { src, alt } → append an image that is
// already hosted (e.g. uploaded through /api/imports/upload-images).
export async function POST(
  request: Request,
  context: { params: { handle: string } },
) {
  try {
    await requireAdmin([...EDIT_ROLES]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  let body: { src?: string; alt?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body JSON tidak valid.");
  }

  const src = String(body?.src || "").trim();
  if (!/^https?:\/\//i.test(src)) return jsonError(400, "Field `src` wajib berupa URL http(s).");

  const handle = decodeURIComponent(context.params.handle);
  try {
    const product = await getProduct(handle);
    if (!product) return jsonError(404, "Produk tidak ditemukan.");

    const duplicate = product.images.find(
      (img) => String(img.src).split("?")[0] === src.split("?")[0],
    );
    if (duplicate) {
      return NextResponse.json({ ok: true, image: duplicate, duplicate: true });
    }

    const res = await adminRest<any>("POST", `/products/${product.id}/images.json`, {
      image: {
        src,
        alt: String(body?.alt || product.title).slice(0, 512),
        position: product.images.length + 1,
      },
    });

    await prisma.importJob
      .updateMany({
        where: { shopifyProductId: String(product.id) },
        data: { manuallyEditedAt: new Date() },
      })
      .catch(() => {});

    return NextResponse.json({ ok: true, image: res?.image || null });
  } catch (e: any) {
    return jsonError(502, e?.message || String(e));
  }
}
