export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin, jsonError } from "@/lib/auth";
import { adminGraphQL } from "@/lib/shopify";

// Free-text Shopify product types ("Busy Book", "tshirts") → the storefront
// slug taxonomy (busy-book). Kept in sync with mapShopifyProduct in the
// storefront's data.js.
function normalizeCategory(productType: string | null | undefined): string {
  return String(productType || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

const CATEGORY_LABELS: Record<string, string> = {
  "busy-book": "Busy Book",
  tshirts: "T-Shirts & Tops",
  shorts: "Shorts & Bottoms",
  dresses: "Dresses",
  outerwear: "Outerwear",
  accessories: "Accessories",
  baby: "Baby",
};

export async function GET() {
  let ctx;
  try {
    ctx = await requireAdmin(["SUPER_ADMIN", "CONTENT_EDITOR", "SUPPORT"]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  try {
    const data = await adminGraphQL<{
      products: {
        edges: {
          node: {
            id: string;
            handle: string;
            title: string;
            vendor: string;
            productType: string | null;
            featuredImage: { url: string } | null;
          };
        }[];
      };
    }>(`{
      products(first: 100, sortKey: TITLE) {
        edges {
          node {
            id
            handle
            title
            vendor
            productType
            featuredImage { url }
          }
        }
      }
    }`);

    const byCategory = new Map<string, { handle: string; title: string; vendor: string; image: string | null }[]>();
    for (const edge of data.products.edges || []) {
      const n = edge.node;
      if (!n.handle) continue;
      const category = normalizeCategory(n.productType);
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category)!.push({
        handle: n.handle,
        title: n.title,
        vendor: n.vendor,
        image: n.featuredImage?.url || null,
      });
    }

    // Deterministic order: known categories first (busy book most prominent),
    // then any unknown categories, then uncategorised last.
    const order = ["busy-book", "tshirts", "shorts", "dresses", "outerwear", "accessories", "baby"];
    const known = order.filter((c) => byCategory.has(c));
    const unknown = [...byCategory.keys()].filter((c) => c && !order.includes(c)).sort();
    const categories = [...known, ...unknown, ""];

    const groups = categories
      .filter((c) => byCategory.has(c))
      .map((c) => ({
        category: c,
        label: CATEGORY_LABELS[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : "Tanpa kategori"),
        products: byCategory.get(c)!.sort((a, b) => a.title.localeCompare(b.title)),
      }));

    return NextResponse.json({ groups });
  } catch (err: any) {
    console.error("[hero-products] GET error:", err?.message || err);
    return jsonError(500, "Failed to fetch products from Shopify");
  }
}
