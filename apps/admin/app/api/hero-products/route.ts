export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin, jsonError } from "@/lib/auth";
import { adminGraphQL, findHeadlessPublicationId } from "@/lib/shopify";
import { cached } from "@/lib/cache";

// Free-text Shopify product types ("Busy Book", "Top", "Girls' Tops", "") → the
// storefront slug taxonomy (busy-book, tshirts, ...). Kept in sync with
// normalizeProductType in the storefront's data.js so picker groups match what
// the storefront filters. Rules run against the raw type first, then the title.
const CATEGORY_RULES: { category: string; re: RegExp }[] = [
  { category: "busy-book", re: /busy ?books?|quiet ?books?|activity ?books?|soft ?books?|buku (?:mainan|edukasi|aktivitas)/ },
  { category: "accessories", re: /accessor|hat|cap|topi|socks|kaos kaki|bag|tas|shoes|sepatu|sandal|belt|aksesoris|mitten|bootie|bib/ },
  { category: "outerwear", re: /jacket|jaket|coat|blazer|hoodie|cardigan|windbreaker|parka|bomber|vest|sweater|jumper|pullover/ },
  { category: "dresses", re: /dress|gaun|jumpsuit|romper/ },
  { category: "shorts", re: /shorts|celana|pants|trousers|jogger|skirt|rok|legging|overalls?|tights|bottom/ },
  { category: "tshirts", re: /shirt|tee|t-shirt|tshirt|top|atasan|kaos|blouse|polo|long ?sleeve|short ?sleeve/ },
];

function normalizeCategory(
  productType: string | null | undefined,
  title?: string | null,
): string {
  const type = String(productType || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const titleText = String(title || "").toLowerCase();
  for (const rule of CATEGORY_RULES) if (rule.re.test(type)) return rule.category;
  for (const rule of CATEGORY_RULES) if (rule.re.test(titleText)) return rule.category;
  return "tshirts";
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
    // Only offer products the storefront can actually render (published to
    // the Headless channel). If the publication lookup fails, fall back to
    // the unfiltered list rather than breaking the picker.
    let headlessPublicationId: string | null = null;
    try {
      headlessPublicationId = await findHeadlessPublicationId();
    } catch (e: any) {
      console.error("[hero-products] Headless publication lookup failed:", e?.message || e);
    }

    // The picker's product list changes rarely but this query (100 products
    // plus a per-product publication lookup) is expensive, so it is cached.
    const data = await cached(
      `admin:hero-products:${headlessPublicationId || "all"}`,
      120_000,
      () =>
        adminGraphQL<{
          products: {
            edges: {
              node: {
                id: string;
                handle: string;
                title: string;
                vendor: string;
                productType: string | null;
                featuredImage: { url: string } | null;
                publishedOnPublication?: boolean | null;
              };
            }[];
          };
        }>(
          headlessPublicationId
            ? `query HeroProducts($pubId: ID!) {
                products(first: 100, sortKey: TITLE) {
                  edges {
                    node {
                      id
                      handle
                      title
                      vendor
                      productType
                      featuredImage { url }
                      publishedOnPublication(publicationId: $pubId)
                    }
                  }
                }
              }`
            : `{
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
              }`,
          headlessPublicationId ? { pubId: headlessPublicationId } : undefined,
        ),
    );

    const byCategory = new Map<string, { handle: string; title: string; vendor: string; image: string | null }[]>();
    for (const edge of data.products.edges || []) {
      const n = edge.node;
      if (!n.handle) continue;
      if (headlessPublicationId && n.publishedOnPublication === false) continue;
      const category = normalizeCategory(n.productType, n.title);
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
