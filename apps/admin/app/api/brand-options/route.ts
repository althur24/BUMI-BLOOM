export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin, jsonError } from "@/lib/auth";
import { adminGraphQL, fetchBrandMetaobjects } from "@/lib/shopify";
import { cached } from "@/lib/cache";

// Brand key normaliser — MUST stay identical to normalizeBrandKey() in the
// storefront's public/js/data.js, otherwise an admin re-order would not match
// the brand it was meant to. Lowercase, "&" → "and", strip common suffixes,
// then drop everything non-alphanumeric.
function normalizeBrandKey(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/officialshop|official|shop|store/g, "")
    .replace(/[^a-z0-9]/g, "");
}

interface BrandOption {
  name: string;
  key: string;
  productCount: number;
}

// All brands the storefront can show: every product vendor (with its product
// count) plus brand metaobjects that have no products yet. Deduped by key so
// "Sabine & Heem" and "Sabine and Heem" are one row.
export async function GET() {
  try {
    await requireAdmin(["SUPER_ADMIN", "CONTENT_EDITOR", "SUPPORT"]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  try {
    const brands = await cached("admin:brand-options", 120_000, loadBrandOptions);
    return NextResponse.json({ brands });
  } catch (err: any) {
    console.error("[brand-options] GET error:", err?.message || err);
    return jsonError(502, "Gagal memuat brand dari Shopify");
  }
}

async function loadBrandOptions(): Promise<BrandOption[]> {
  const byKey = new Map<string, BrandOption>();

  // Match the storefront's catalogue fetch (also first: 100, no pagination) so
  // the admin can only order brands the storefront actually knows about.
  try {
    const data = await adminGraphQL<{
      products: { edges: { node: { vendor: string } }[] };
    }>(`query { products(first: 100) { edges { node { vendor } } } }`);

    const counts = new Map<string, { name: string; count: number }>();
    for (const edge of data.products?.edges || []) {
      const vendor = String(edge.node?.vendor || "").trim();
      const key = normalizeBrandKey(vendor);
      if (!key) continue;
      const prev = counts.get(key);
      counts.set(key, { name: prev?.name || vendor, count: (prev?.count || 0) + 1 });
    }
    for (const [key, v] of counts) {
      byKey.set(key, { key, name: v.name, productCount: v.count });
    }
  } catch (err: any) {
    console.error("[brand-options] product vendor lookup failed:", err?.message || err);
  }

  // Metaobject-only brands (created before any product is pushed) stay
  // orderable too — they render as monogram cards on /brands.
  try {
    const metas = await fetchBrandMetaobjects();
    for (const meta of metas) {
      const nameField = (meta.fields || []).find((f) => f.key === "name");
      const name = String(nameField?.value || "").trim();
      const key = normalizeBrandKey(name) || normalizeBrandKey(meta.handle);
      if (!key) continue;
      if (byKey.has(key)) continue;
      byKey.set(key, { key, name: name || meta.handle, productCount: 0 });
    }
  } catch (err: any) {
    console.error("[brand-options] metaobject lookup failed:", err?.message || err);
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
