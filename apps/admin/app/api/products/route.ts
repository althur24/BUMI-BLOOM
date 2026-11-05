import { NextResponse } from "next/server";
import { requireAdmin, jsonError } from "@/lib/auth";
import { listProducts } from "@/lib/products";

export const dynamic = "force-dynamic";

const VIEW_ROLES = ["SUPER_ADMIN", "MARKETPLACE_ADMIN", "CONTENT_EDITOR"] as const;

// GET /api/products?search=&filter=&pageInfo= → live Shopify products with the
// `bumi` metafields the storefront depends on.
export async function GET(request: Request) {
  try {
    await requireAdmin([...VIEW_ROLES]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  const u = new URL(request.url);
  const search = u.searchParams.get("search") || undefined;
  const filter = u.searchParams.get("filter") || "";
  const pageInfo = u.searchParams.get("pageInfo") || undefined;
  const limit = Math.min(Number(u.searchParams.get("limit")) || 50, 250);

  try {
    const result = await listProducts({ search, limit, pageInfo });
    const products = filter
      ? result.products.filter((p) => {
          if (filter === "issues") return p.issues.length > 0;
          if (filter === "no-colors") return p.colors.length === 0;
          if (filter === "variants-no-image") return p.variantsWithImage === 0 && p.variantCount > 1;
          if (filter === "no-size-guide") return !p.sizeGuide;
          return true;
        })
      : result.products;

    return NextResponse.json({
      products,
      nextCursor: result.nextCursor,
      counts: {
        total: result.products.length,
        withIssues: result.products.filter((p) => p.issues.length > 0).length,
        noColors: result.products.filter((p) => p.colors.length === 0).length,
      },
    });
  } catch (e: any) {
    return jsonError(502, `Gagal memuat produk dari Shopify: ${e?.message || e}`);
  }
}
