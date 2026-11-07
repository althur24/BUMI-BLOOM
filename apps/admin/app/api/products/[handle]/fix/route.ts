import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import {
  bindColorImagesFromVariants,
  colorsFromProductVariants,
  getProduct,
  updateProduct,
} from "@/lib/products";
import { fetchExistingVendors, resolveVendorSimple, adminRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["SUPER_ADMIN", "MARKETPLACE_ADMIN", "CONTENT_EDITOR"] as const;

type FixAction =
  | "colors-from-variants"
  | "bind-color-images"
  | "normalize-vendor"
  | "clean-handle";

// POST /api/products/[handle]/fix { action }
export async function POST(
  request: Request,
  context: { params: { handle: string } },
) {
  try {
    await requireAdmin([...EDIT_ROLES]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  let body: { action?: FixAction };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body JSON tidak valid.");
  }

  const handle = decodeURIComponent(context.params.handle);
  const action = body?.action;

  try {
    if (action === "colors-from-variants") {
      const result = await colorsFromProductVariants(handle);
      if (!result.written) {
        return jsonError(409, result.reason || "Tidak ada warna yang bisa diisi.");
      }
      await flagManualEdit(handle);
      return NextResponse.json({ ok: true, action, colors: result.colors });
    }

    if (action === "bind-color-images") {
      const result = await bindColorImagesFromVariants(handle);
      if (!result.written) {
        return jsonError(409, result.reason || "Tidak ada gambar varian yang bisa dipakai.");
      }
      await flagManualEdit(handle);
      return NextResponse.json({ ok: true, action, bound: result.bound });
    }

    if (action === "normalize-vendor") {
      const product = await getProduct(handle);
      if (!product) return jsonError(404, "Produk tidak ditemukan.");
      const vendors = await fetchExistingVendors();
      const resolved = resolveVendorSimple(product.vendor, vendors);
      if (resolved === product.vendor) {
        return NextResponse.json({
          ok: true,
          action,
          vendor: product.vendor,
          message: "Vendor sudah sesuai.",
        });
      }
      const result = await updateProduct(handle, { vendor: resolved });
      await flagManualEdit(handle);
      return NextResponse.json({
        ok: true,
        action,
        vendor: resolved,
        previous: product.vendor,
        productId: result.productId,
      });
    }

    if (action === "clean-handle") {
      const product = await getProduct(handle);
      if (!product) return jsonError(404, "Produk tidak ditemukan.");
      // Strip a leading vendor slug that does not belong to this product.
      const vendor = (product.vendor || "").toLowerCase();
      const current = product.handle;
      let cleaned = current;
      if (vendor) {
        const parts = current.split("-");
        const vendorWords = vendor.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        const stillVendor = vendorWords.every((w) => parts[0] === w);
        void stillVendor;
      }
      // Remove duplicated vendor token at the start (e.g. sabine-and-heem-cocohanee-*)
      const known = ["sabine-and-heem", "sabine-heem", "heem"];
      for (const prefix of known) {
        if (vendor.includes("sabine") || vendor.includes("heem")) break;
        if (cleaned.startsWith(`${prefix}-`)) cleaned = cleaned.slice(prefix.length + 1);
      }
      if (cleaned === current) {
        return NextResponse.json({ ok: true, action, handle: current, message: "Handle sudah bersih." });
      }
      await adminRest("PUT", `/products/${product.id}.json`, {
        product: { id: product.id, handle: cleaned },
      });
      await flagManualEdit(cleaned);
      return NextResponse.json({ ok: true, action, handle: cleaned, previous: current });
    }

    return jsonError(400, `Aksi tidak dikenal: ${action}`);
  } catch (e: any) {
    return jsonError(502, e?.message || String(e));
  }
}

async function flagManualEdit(handle: string) {
  try {
    const product = await getProduct(handle);
    if (!product) return;
    await prisma.importJob.updateMany({
      where: { shopifyProductId: String(product.id) },
      data: { manuallyEditedAt: new Date() },
    });
  } catch {
    // flagging is best-effort
  }
}
