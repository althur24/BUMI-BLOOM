// Direct Shopify product read/write for the admin "Produk" editor.
//
// The import pipeline is intentionally one-way (source → staging → Shopify).
// This module is the other direction: it lets an admin fix a live product
// (colours, variants, images, metafields) without re-importing it.

import {
  adminRest,
  adminGraphQL,
  ensureMetafieldTypes,
  setMetafields,
  VENDORS_CACHE_KEY,
} from "./shopify";
import { cacheDelete, cacheGet, cacheSet } from "./cache";
import { colorsFromVariants, normalizeHex, resolveColorHex } from "./colors";
import { normaliseAudience, parseAudience, type ProductAudience } from "./audience";

export type BumiMetafieldKey =
  | "colors"
  | "material"
  | "fibre"
  | "audience"
  | "size_guide"
  | "size_chart_image"
  | "size_label_mode"
  | "shipping_returns"
  | "badge"
  | "is_new"
  | "is_bestseller"
  | "rating"
  | "reviews_count"
  | "sold_count"
  | "source_url"
  | "source_platform"
  | "brand"
  | "no_color";

export interface ProductColor {
  name: string;
  hex: string;
  // Image bound to this colourway (Shopify image id + URL). Optional: the
  // storefront filter still uses `hex`, the image only drives variant images.
  imageId?: number | null;
  image?: string | null;
}

export interface AdminProductSummary {
  id: number;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  status: string;
  image: string | null;
  price: string;
  variantCount: number;
  variantsWithImage: number;
  imageCount: number;
  colors: ProductColor[];
  noColor: boolean;
  colorOptionCount: number;
  sizeGuide: boolean;
  // bumi.size_label_mode — "age" | "height" | "manual" ("" when unset).
  sizeLabelMode: string;
  // Storefront label: "new" | "bestseller" | null
  badge: string | null;
  // bumi.audience — drives the Girls/Boys collections. null when unset.
  audience: ProductAudience | null;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  issues: string[];
}

export interface AdminVariant {
  id: number;
  title: string;
  price: string;
  compareAtPrice: string | null;
  sku: string;
  inventoryQuantity: number;
  imageId: number | null;
  image: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  grams: number | null;
  // Needed to set stock without an extra per-variant GET.
  inventoryItemId: number | null;
}

export interface AdminProductDetail {
  id: number;
  handle: string;
  title: string;
  bodyHtml: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string;
  options: { name: string; values: string[] }[];
  variants: AdminVariant[];
  images: { id: number; src: string; alt: string | null; position: number }[];
  metafields: Record<string, string>;
  manuallyEdited: boolean;
}

export interface ProductPatch {
  title?: string;
  bodyHtml?: string;
  vendor?: string;
  productType?: string;
  status?: string;
  tags?: string;
  colors?: ProductColor[];
  noColor?: boolean;
  // Colour name → image id. Applied to every variant of that colourway.
  colorImages?: { colorName: string; imageId: number | null }[];
  metafields?: Partial<Record<BumiMetafieldKey, string>>;
  variantPrices?: { id: number; price?: string; compareAtPrice?: string | null; sku?: string; inventoryQuantity?: number }[];
  variantImages?: { id: number; imageId: number | null }[];
  removeImageIds?: number[];
}

const BUMI_FIELDS: BumiMetafieldKey[] = [
  "colors",
  "material",
  "fibre",
  "audience",
  "size_guide",
  "size_chart_image",
  "size_label_mode",
  "shipping_returns",
  "badge",
  "is_new",
  "is_bestseller",
  "rating",
  "reviews_count",
  "sold_count",
  "source_url",
  "source_platform",
  "brand",
  "no_color",
];

const FIELD_TYPES: Record<BumiMetafieldKey, string> = {
  colors: "json",
  // Material & Size Guide keep line breaks: the storefront renders Material as
  // rich text and parses Size Guide line-by-line (or " · "-separated).
  // EnsureMetafieldTypes deletes the stale single_line metafield per product
  // before the multi_line value is written, so nothing breaks on upgrade.
  material: "multi_line_text_field",
  fibre: "single_line_text_field",
  audience: "single_line_text_field",
  size_guide: "multi_line_text_field",
  size_chart_image: "url",
  size_label_mode: "single_line_text_field",
  shipping_returns: "single_line_text_field",
  badge: "single_line_text_field",
  // Boolean (matching the Shopify definition in
  // backend/scripts/create-metafield-definitions.mjs) so the editor and the
  // import pipeline write the same type. A mismatch makes metafieldsSet reject
  // the whole batch, silently losing every other field on save.
  is_new: "boolean",
  is_bestseller: "boolean",
  rating: "number_decimal",
  reviews_count: "number_integer",
  sold_count: "number_integer",
  source_url: "single_line_text_field",
  source_platform: "single_line_text_field",
  brand: "single_line_text_field",
  no_color: "boolean",
};

// Storefront product types. There is no "baby" type: the storefront has no
// Baby collection/filter, so imports map baby wording to the closest real
// category (see normaliseCategory in import-mapper.ts).
const STORE_CATEGORIES = new Set([
  "tshirts",
  "shorts",
  "dresses",
  "outerwear",
  "accessories",
  "busy-book",
]);

function optionPosition(options: { name: string }[] | undefined, re: RegExp): number {
  const list = options || [];
  for (let i = 0; i < list.length; i++) {
    if (re.test(String(list[i]?.name || ""))) return i + 1;
  }
  return 0;
}

function parseColors(raw: string | undefined): ProductColor[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c: any) => {
        const name = String(c?.name || "").trim();
        const hex = normalizeHex(c?.hex) || resolveColorHex(name, c?.hex);
        const imageId =
          c?.imageId != null && Number.isFinite(Number(c.imageId))
            ? Number(c.imageId)
            : null;
        const image = c?.image ? String(c.image) : null;
        return { name, hex, imageId, image };
      })
      .filter((c) => Boolean(c.name));
  } catch {
    return [];
  }
}

function metafieldValue(metafields: any[], key: string): string {
  const hit = (metafields || []).find((m: any) => m.key === key);
  return hit ? String(hit.value ?? "") : "";
}

// ── Reads ──────────────────────────────────────────────────────────────────

const METAFIELD_TTL_MS = 60_000;
const metafieldCacheKey = (productId: number | string) => `mf:${productId}`;

async function fetchMetafields(productId: number | string): Promise<any[]> {
  const cached = cacheGet<any[]>(metafieldCacheKey(productId));
  if (cached) return cached;
  try {
    const res = await adminRest<any>(
      "GET",
      `/products/${productId}/metafields.json?namespace=bumi`,
    );
    return cacheSet(metafieldCacheKey(productId), res?.metafields || [], METAFIELD_TTL_MS);
  } catch {
    return [];
  }
}

// Fetch the `bumi` metafields for many products in a SINGLE GraphQL request.
// The old code issued one REST call per product (N+1): a 50-product page made
// 50 sequential round-trips to Shopify, which is what made the admin slow.
async function fetchMetafieldsBatch(productIds: (number | string)[]): Promise<Map<number, any[]>> {
  const out = new Map<number, any[]>();
  const missing: number[] = [];
  for (const id of productIds) {
    const numeric = Number(id);
    if (!Number.isFinite(numeric)) continue;
    const cached = cacheGet<any[]>(metafieldCacheKey(numeric));
    if (cached) out.set(numeric, cached);
    else if (!missing.includes(numeric)) missing.push(numeric);
  }
  if (!missing.length) return out;

  // Shopify caps `nodes(ids:)` at 100 ids per request.
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    try {
      const data = await adminGraphQL<{
        nodes: ({ id: string; metafields?: { edges: { node: any }[] } } | null)[];
      }>(
        `query ProductMetafields($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              metafields(first: 30, namespace: "bumi") {
                edges { node { key value } }
              }
            }
          }
        }`,
        { ids: batch.map((id) => `gid://shopify/Product/${id}`) },
        { timeoutMs: 30_000 },
      );
      for (const node of data?.nodes || []) {
        if (!node?.id) continue;
        const numeric = Number(String(node.id).split("/").pop());
        if (!Number.isFinite(numeric)) continue;
        const metafields = (node.metafields?.edges || []).map((e) => e.node);
        out.set(numeric, metafields);
        cacheSet(metafieldCacheKey(numeric), metafields, METAFIELD_TTL_MS);
      }
    } catch (err: any) {
      console.error("[products] batch metafields failed:", err?.message || err);
      // Fall back to a bounded number of parallel single fetches so a GraphQL
      // hiccup degrades to "slower" instead of "missing metafields".
      await mapWithConcurrency(batch, 5, async (id) => {
        const metafields = await fetchMetafields(id);
        if (metafields.length) out.set(id, metafields);
      });
    }
  }
  return out;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next === undefined) return;
      await work(next);
    }
  });
  await Promise.all(workers);
}

export async function listProducts(opts: {
  search?: string;
  limit?: number;
  pageInfo?: string;
} = {}): Promise<{ products: AdminProductSummary[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(opts.limit ?? 50, 250)));
  if (opts.pageInfo) params.set("page_info", opts.pageInfo);
  params.set("fields", "id,handle,title,vendor,product_type,status,images,variants,options");

  const res = await adminRest<any>("GET", `/products.json?${params.toString()}`);
  const raw = res?.products || [];
  const linkHeader = res?.__link as string | undefined;

  const search = String(opts.search || "").trim().toLowerCase();

  const metafieldsByProduct = await fetchMetafieldsBatch(raw.map((p: any) => p.id));

  const products: AdminProductSummary[] = [];
  for (const p of raw) {
    const metafields = metafieldsByProduct.get(Number(p.id)) || [];
    const colors = parseColors(metafieldValue(metafields, "colors"));
    const variants = p.variants || [];
    const options = p.options || [];
    const colorPos = optionPosition(options, /^(colou?r|colour|warna)$/i);
    const colorValues = new Set<string>();
    if (colorPos) {
      for (const v of variants) {
        const value = String(v[`option${colorPos}`] || "").trim();
        if (value && !/^(default|default title)$/i.test(value)) colorValues.add(value);
      }
    }
    const variantsWithImage = variants.filter((v: any) => v.image_id).length;
    // An explicit "no colour" flag means the admin decided this product has no
    // colourway (e.g. a single-print item) — that is not a problem to fix.
    const noColor = metafieldValue(metafields, "no_color") === "true";

    const issues: string[] = [];
    if (!colors.length && !noColor) issues.push("Warna belum diisi");
    if (colorValues.size > 0 && colors.length === 0 && !noColor) issues.push("Warna varian belum tersimpan");
    if (variants.length > 1 && variantsWithImage === 0) issues.push("Varian tanpa gambar");
    if (!metafieldValue(metafields, "size_guide")) issues.push("Size guide kosong");
    const audience = parseAudience(metafieldValue(metafields, "audience"));
    if (!audience) issues.push("Audience (Girls/Boys) belum di-set");
    if (String(p.product_type || "").trim() && !STORE_CATEGORIES.has(String(p.product_type).toLowerCase())) {
      issues.push("Kategori tidak standar");
    }

    const haystack = `${p.title} ${p.vendor} ${p.handle}`.toLowerCase();
    if (search && !haystack.includes(search)) continue;

    products.push({
      id: p.id,
      handle: p.handle,
      title: p.title,
      vendor: p.vendor,
      productType: p.product_type || "",
      status: p.status || "",
      image: p.images?.[0]?.src || p.image?.src || null,
      price: variants[0]?.price ?? "0",
      variantCount: variants.length,
      variantsWithImage,
      imageCount: (p.images || []).length,
      colors,
      noColor,
      colorOptionCount: colorValues.size,
      sizeGuide: Boolean(metafieldValue(metafields, "size_guide")),
      sizeLabelMode: metafieldValue(metafields, "size_label_mode"),
      badge: (() => {
        const value = metafieldValue(metafields, "badge").trim().toLowerCase();
        return value === "new" || value === "bestseller" ? value : null;
      })(),
      audience,
      sourceUrl: metafieldValue(metafields, "source_url") || null,
      sourcePlatform: metafieldValue(metafields, "source_platform") || null,
      issues,
    });
  }

  // Shopify returns: <https://…products.json?limit=50&page_info=ABC>; rel="next"
  const nextMatch = linkHeader?.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/i);
  const nextCursor = nextMatch ? decodeURIComponent(nextMatch[1]) : null;
  return { products, nextCursor };
}

// REST product endpoints truncate variants at 100. When that happens, fetch the
// complete list from GraphQL (paginated) and map it to the REST variant shape
// the editor expects, so large products are not silently missing variants.
async function fetchAllVariantsDetailed(
  productId: number | string,
  options: { name: string; position?: number }[],
): Promise<any[] | null> {
  try {
    const positionByName = new Map<string, number>();
    options.forEach((o, i) =>
      positionByName.set(String(o.name).toLowerCase(), Number(o.position) || i + 1),
    );

    const out: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const data: {
        product: {
          variants: {
            nodes: any[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        } | null;
      } = await adminGraphQL(
        `query AllVariants($id: ID!, $after: String) {
          product(id: $id) {
            variants(first: 250, after: $after) {
              nodes {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                inventoryItem { id }
                image { id }
                selectedOptions { name value }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        { id: `gid://shopify/Product/${productId}`, after: cursor },
        { timeoutMs: 30_000 },
      );

      const variants = data?.product?.variants;
      if (!variants) return null;
      for (const node of variants.nodes || []) {
        const mapped: Record<string, any> = {
          id: numericFromGid(node.id),
          title: node.title,
          sku: node.sku || "",
          price: node.price ?? "0",
          compare_at_price: node.compareAtPrice ?? null,
          inventory_quantity: node.inventoryQuantity ?? 0,
          inventory_item_id: node.inventoryItem?.id ? numericFromGid(node.inventoryItem.id) : null,
          image_id: node.image?.id ? numericFromGid(node.image.id) : null,
          grams: null,
        };
        for (const sel of node.selectedOptions || []) {
          const position = positionByName.get(String(sel.name).toLowerCase());
          if (position) mapped[`option${position}`] = sel.value;
        }
        out.push(mapped);
      }
      if (!variants.pageInfo?.hasNextPage) break;
      cursor = variants.pageInfo.endCursor;
    }
    return out;
  } catch {
    return null;
  }
}

function numericFromGid(gid: string): number {
  return Number(String(gid).split("/").pop());
}

export async function getProduct(handle: string): Promise<AdminProductDetail | null> {
  const found = await adminRest<any>(
    "GET",
    `/products.json?handle=${encodeURIComponent(handle)}&limit=1`,
  );
  const p = found?.products?.[0];
  if (!p) return null;

  const metafields = await fetchMetafields(p.id);
  const meta: Record<string, string> = {};
  for (const m of metafields) meta[m.key] = String(m.value ?? "");

  const imageById = new Map<number, string>();
  for (const img of p.images || []) imageById.set(img.id, img.src);

  if (Array.isArray(p.variants) && p.variants.length >= 100) {
    const all = await fetchAllVariantsDetailed(p.id, p.options || []);
    if (all?.length) p.variants = all;
  }

  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    bodyHtml: p.body_html || "",
    vendor: p.vendor || "",
    productType: p.product_type || "",
    status: p.status || "active",
    tags: p.tags || "",
    options: (p.options || []).map((o: any) => ({
      name: o.name,
      values: Array.isArray(o.values) ? o.values.map(String) : [],
    })),
    variants: (p.variants || []).map((v: any) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      compareAtPrice: v.compare_at_price ?? null,
      sku: v.sku || "",
      inventoryQuantity: v.inventory_quantity ?? 0,
      imageId: v.image_id ?? null,
      image: v.image_id ? imageById.get(v.image_id) || null : null,
      option1: v.option1 ?? null,
      option2: v.option2 ?? null,
      option3: v.option3 ?? null,
      grams: v.grams ?? null,
      inventoryItemId: v.inventory_item_id ?? null,
    })),
    images: (p.images || []).map((img: any) => ({
      id: img.id,
      src: img.src,
      alt: img.alt ?? null,
      position: img.position ?? 0,
    })),
    metafields: meta,
    manuallyEdited: false,
  };
}

// ── Writes ─────────────────────────────────────────────────────────────────

function sanitizeHtml(html: string): string {
  // Only a very small allowlist — the editor sends plain text or simple HTML.
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

// `setMetafields` deliberately drops blank values, so switching a product
// label OFF needs the metafield deleted instead. This clears every key the
// caller passed as an empty string (only when it currently exists).
async function clearMetafields(
  productId: number | string,
  keys: string[],
): Promise<string[]> {
  if (!keys.length) return [];
  const existing = await fetchMetafields(productId);
  const byKey = new Map(
    existing.filter((m) => m && keys.includes(String(m.key))).map((m) => [String(m.key), m.id]),
  );
  const cleared: string[] = [];
  for (const key of keys) {
    const id = byKey.get(key);
    if (!id) continue;
    try {
      await adminRest("DELETE", `/metafields/${id}.json`);
      cleared.push(key);
    } catch (e: any) {
      throw new Error(`Metafield ${key} gagal dihapus: ${e?.message || e}`);
    }
  }
  cacheDelete(metafieldCacheKey(productId));
  return cleared;
}

async function upsertMetafields(
  productId: number | string,
  patch: Partial<Record<BumiMetafieldKey, string>>,
): Promise<string[]> {
  const values: { namespace: string; key: string; value: string; type: string }[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const typed = key as BumiMetafieldKey;
    if (!BUMI_FIELDS.includes(typed)) continue;
    if (value == null) continue;
    // An empty value is invalid for number/boolean/json fields and would make
    // metafieldsSet reject the whole batch. Blank labels (badge/is_new/…) are
    // cleared separately via clearMetafields, so skipping them here is safe.
    if (!String(value).trim()) continue;
    values.push({
      namespace: "bumi",
      key: typed,
      value: String(value),
      type: FIELD_TYPES[typed],
    });
  }
  if (!values.length) return [];
  // Self-heal any key whose stored type disagrees with the one we now write
  // (e.g. an old `is_new` stored as text). metafieldsSet rejects the whole
  // batch on a type mismatch, so without this a single stale key silently
  // loses every field in the same save.
  await ensureMetafieldTypes(productId, values);
  await setMetafields(`gid://shopify/Product/${productId}`, values);
  cacheDelete(metafieldCacheKey(productId));
  return values.map((v) => v.key);
}

export async function updateProduct(
  handle: string,
  patch: ProductPatch,
): Promise<{ productId: number; updated: string[]; warnings: string[] }> {
  const current = await getProduct(handle);
  if (!current) throw new Error(`Produk "${handle}" tidak ditemukan.`);

  const warnings: string[] = [];
  const updated: string[] = [];
  const productId = current.id;

  const productBody: Record<string, unknown> = { id: productId };
  if (patch.title != null) productBody.title = String(patch.title).trim().slice(0, 255);
  if (patch.bodyHtml != null) productBody.body_html = sanitizeHtml(patch.bodyHtml);
  if (patch.vendor != null) productBody.vendor = String(patch.vendor).trim().slice(0, 255);
  if (patch.productType != null) {
    const type = String(patch.productType).trim().toLowerCase();
    if (type && !STORE_CATEGORIES.has(type)) {
      warnings.push(`Kategori "${type}" tidak dikenal storefront.`);
    }
    productBody.product_type = type;
  }
  if (patch.status != null) productBody.status = String(patch.status);
  if (patch.tags != null) productBody.tags = String(patch.tags);

  if (Object.keys(productBody).length > 1) {
    await adminRest("PUT", `/products/${productId}.json`, { product: productBody });
    Object.keys(productBody).forEach((k) => {
      if (k !== "id") updated.push(k);
    });
    if (patch.vendor != null) cacheDelete(VENDORS_CACHE_KEY);
  }

  // Shopify rejects a variant batch that includes unchanged variants whose ids
  // it considers foreign ("variants have not been changed"). Build the payload
  // from the live product and only send fields that actually differ.
  const liveById = new Map(current.variants.map((v) => [v.id, v]));
  const pendingVariantUpdates: Record<string, unknown>[] = [];
  if (patch.variantPrices?.length) {
    const variants: Record<string, unknown>[] = [];
    for (const incoming of patch.variantPrices) {
      const live = liveById.get(incoming.id);
      if (!live) continue;
      const body: Record<string, unknown> = { id: live.id };
      let changed = false;
      if (incoming.price != null && incoming.price !== "") {
        const n = Number(incoming.price);
        if (!Number.isFinite(n) || n <= 0) throw new Error(`Harga varian ${live.id} tidak valid.`);
        if (n.toFixed(2) !== Number(live.price).toFixed(2)) {
          body.price = n.toFixed(2);
          changed = true;
        }
      }
      if (incoming.compareAtPrice !== undefined) {
        const next = incoming.compareAtPrice ? Number(incoming.compareAtPrice).toFixed(2) : null;
        const prev = live.compareAtPrice ? Number(live.compareAtPrice).toFixed(2) : null;
        if (next !== prev) {
          body.compare_at_price = next;
          changed = true;
        }
      }
      if (incoming.sku !== undefined && String(incoming.sku) !== live.sku) {
        body.sku = String(incoming.sku);
        changed = true;
      }
      if (changed) variants.push(body);
    }
    if (variants.length) {
      pendingVariantUpdates.push(...variants);
      updated.push("variants");
    }
  }

  if (patch.variantImages?.length) {
    const variants = patch.variantImages
      .filter((v) => liveById.has(v.id))
      .filter((v) => (liveById.get(v.id)?.imageId ?? null) !== (v.imageId ?? null));
    for (const v of variants) {
      try {
        await adminRest("PUT", `/variants/${v.id}.json`, {
          variant: { id: v.id, image_id: v.imageId },
        });
      } catch (e: any) {
        warnings.push(`Gambar varian ${v.id} gagal diset: ${e?.message || e}`);
      }
    }
    if (variants.length) updated.push("variantImages");
  }

  // Inventory is a separate endpoint and must be set per location.
  const stockPatch = (patch.variantPrices || []).filter((v) => v.inventoryQuantity != null);
  if (stockPatch.length) {
    const located = await adminRest<any>("GET", "/locations.json").catch(() => null);
    const locationId = (located?.locations || []).find((l: any) => l.active)?.id;
    if (!locationId) {
      warnings.push("Lokasi inventory tidak ditemukan — stok tidak diperbarui.");
    } else {
      for (const v of stockPatch) {
        // Reuse the inventory item id from the product read (no extra GET).
        const itemId = liveById.get(v.id)?.inventoryItemId;
        if (!itemId) {
          warnings.push(`Inventory item varian ${v.id} tidak ditemukan.`);
          continue;
        }
        try {
          await adminRest("POST", "/inventory_levels/set.json", {
            location_id: locationId,
            inventory_item_id: itemId,
            available: Math.max(0, Math.round(Number(v.inventoryQuantity))),
          });
        } catch (e: any) {
          warnings.push(`Stok varian ${v.id} gagal diset: ${e?.message || e}`);
        }
      }
      updated.push("inventory");
    }
  }

  if (patch.removeImageIds?.length) {
    const removing = new Set(patch.removeImageIds.map(Number));
    // Detach the image from every variant first; Shopify refuses (or silently
    // leaves dangling references) if a variant still points at it.
    for (const v of current.variants) {
      if (v.imageId != null && removing.has(v.imageId)) {
        try {
          await adminRest("PUT", `/variants/${v.id}.json`, {
            variant: { id: v.id, image_id: null },
          });
        } catch (e: any) {
          warnings.push(`Gambar varian ${v.id} gagal dilepas: ${e?.message || e}`);
        }
      }
    }
    for (const imageId of patch.removeImageIds) {
      try {
        await adminRest("DELETE", `/products/${productId}/images/${imageId}.json`);
      } catch (e: any) {
        warnings.push(`Gambar ${imageId} gagal dihapus: ${e?.message || e}`);
      }
    }
    updated.push("imagesRemoved");
  }

  const metaPatch: Partial<Record<BumiMetafieldKey, string>> = { ...(patch.metafields || {}) };

  // `bumi.audience` must never be blank. A product without it would be
  // missing from both the Girls and Boys collections, so an unspecified value
  // is written back as "unisex" rather than sent as an empty string.
  if ("audience" in metaPatch) {
    metaPatch.audience = normaliseAudience(metaPatch.audience);
  }

  // A colour's image lives in bumi.colors so the editor can show it next time
  // and the storefront can optionally use it later (it does not today).
  if (patch.colors) {
    const imageById = new Map<number, string>();
    for (const img of current.images) imageById.set(img.id, img.src);

    const seen = new Set<string>();
    const deduped = patch.colors
      .map((c) => {
        const name = String(c.name || "").trim();
        const hex = normalizeHex(c.hex) || resolveColorHex(name, c.hex);
        const imageId = c.imageId != null ? Number(c.imageId) : null;
        const image = imageId != null ? imageById.get(imageId) || c.image || null : c.image || null;
        return { name, hex, imageId, image };
      })
      .filter((c) => {
        if (!c.name) return false;
        const key = c.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    metaPatch.colors = JSON.stringify(deduped);
  }

  if (patch.noColor !== undefined) {
    metaPatch.no_color = patch.noColor ? "true" : "false";
  }

  // Labels are the one place where "empty" means "switch it off", so those
  // keys are deleted rather than skipped by the blank-value filter.
  const LABEL_KEYS: BumiMetafieldKey[] = ["badge", "is_new", "is_bestseller"];
  const labelPatch: Partial<Record<BumiMetafieldKey, string>> = {};
  for (const key of LABEL_KEYS) {
    if (key in metaPatch) labelPatch[key] = metaPatch[key];
  }
  const blankLabels = LABEL_KEYS.filter(
    (key) => key in labelPatch && !String(labelPatch[key] || "").trim(),
  );
  if (blankLabels.length) {
    const cleared = await clearMetafields(productId, blankLabels);
    if (cleared.length) updated.push(...cleared);
  }

  if (Object.keys(metaPatch).length) {
    updated.push(...(await upsertMetafields(productId, metaPatch)));
  }

  // Bind a colourway image to every variant of that colour in one request.
  if (patch.colorImages?.length) {
    const colorPos = optionPosition(current.options, /^(colou?r|colour|warna)$/i);
    if (!colorPos) {
      warnings.push("Produk tidak punya opsi warna — gambar per warna dilewati.");
    } else {
      const wanted = new Map<string, number | null>();
      for (const entry of patch.colorImages) {
        const key = String(entry.colorName || "").trim().toLowerCase();
        if (key) wanted.set(key, entry.imageId ?? null);
      }
      const variants = current.variants
        .filter((v) => {
          const value = String((v as any)[`option${colorPos}`] || "").trim().toLowerCase();
          return wanted.has(value);
        })
        .map((v) => ({
          id: v.id,
          image_id: wanted.get(
            String((v as any)[`option${colorPos}`] || "").trim().toLowerCase(),
          ) ?? null,
        }))
        .filter((v) => (current.variants.find((x) => x.id === v.id)?.imageId ?? null) !== v.image_id);

      if (variants.length) {
        // IMPORTANT: update each variant through /variants/{id}.json. A
        // product-level PUT with a subset of variants makes Shopify treat the
        // rest as removed — which collapsed Piccolo from 95 variants to 5.
        for (const v of variants) {
          try {
            await adminRest("PUT", `/variants/${v.id}.json`, {
              variant: { id: v.id, image_id: v.image_id },
            });
          } catch (e: any) {
            warnings.push(`Gambar varian ${v.id} gagal diset: ${e?.message || e}`);
          }
        }
        updated.push("colorImages");
      }
    }
  }

  // Flush price/SKU changes via GraphQL bulk update (chunked). Unlike the REST
  // variant endpoint this also works for products with more than 100 variants.
  if (pendingVariantUpdates.length) {
    for (const batch of chunkArray(pendingVariantUpdates, 100)) {
      const variants = batch
        .map((v) => {
          const input: Record<string, unknown> = {
            id: `gid://shopify/ProductVariant/${Number(v.id)}`,
          };
          if (v.price !== undefined) input.price = Number(v.price);
          if (v.compare_at_price !== undefined) {
            input.compareAtPrice =
              v.compare_at_price === null || v.compare_at_price === ""
                ? null
                : Number(v.compare_at_price);
          }
          if (v.sku !== undefined) input.inventoryItem = { sku: String(v.sku) };
          return input;
        })
        .filter((v) => Object.keys(v).length > 1);
      if (!variants.length) continue;
      try {
        const data = await adminGraphQL<any>(
          `mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }`,
          { productId: `gid://shopify/Product/${productId}`, variants },
          { timeoutMs: 60_000 },
        );
        const errs = data?.productVariantsBulkUpdate?.userErrors || [];
        if (errs.length) {
          warnings.push(`Update varian: ${errs.map((e: any) => e.message).join("; ")}`);
        }
      } catch (e: any) {
        warnings.push(`Update varian gagal: ${e?.message || e}`);
      }
    }
  }

  return { productId, updated, warnings };
}

// Derive `bumi.colors` from the product's Color option values.
export async function colorsFromProductVariants(handle: string): Promise<{
  colors: ProductColor[];
  written: boolean;
  reason?: string;
}> {
  const product = await getProduct(handle);
  if (!product) throw new Error(`Produk "${handle}" tidak ditemukan.`);

  const colorPos = optionPosition(product.options, /^(colou?r|colour|warna)$/i);
  if (!colorPos) {
    return { colors: [], written: false, reason: "Produk ini tidak punya opsi warna." };
  }

  const existing = parseColors(product.metafields.colors);
  const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
  const variants = product.variants.map((v) => ({
    options: { Color: String((v as any)[`option${colorPos}`] || "") },
  }));
  const derived = colorsFromVariants(variants, existing);

  // Carry over any image already bound to the colourway (either from the
  // metafield or from the variant images Shopify already stores).
  const imageByColor = new Map<string, { imageId: number | null; image: string | null }>();
  for (const v of product.variants) {
    const name = String((v as any)[`option${colorPos}`] || "").trim().toLowerCase();
    if (!name || imageByColor.has(name)) continue;
    if (v.imageId) imageByColor.set(name, { imageId: v.imageId, image: v.image });
  }
  const enriched: ProductColor[] = derived.map((c) => {
    const stored = existingByName.get(c.name.toLowerCase());
    const bound = imageByColor.get(c.name.toLowerCase());
    return {
      ...c,
      imageId: stored?.imageId ?? bound?.imageId ?? null,
      image: stored?.image ?? bound?.image ?? null,
    };
  });

  if (!enriched.length) {
    return { colors: [], written: false, reason: "Tidak ada warna yang bisa diambil dari varian." };
  }

  await updateProduct(handle, { colors: enriched, noColor: false });
  return { colors: enriched, written: true };
}

// Copy the image already bound to each variant onto its colourway entry, so the
// editor shows the right thumbnails without the admin picking them again.
export async function bindColorImagesFromVariants(handle: string): Promise<{
  bound: { colorName: string; imageId: number | null }[];
  written: boolean;
  reason?: string;
}> {
  const product = await getProduct(handle);
  if (!product) throw new Error(`Produk "${handle}" tidak ditemukan.`);

  const colorPos = optionPosition(product.options, /^(colou?r|colour|warna)$/i);
  if (!colorPos) {
    return { bound: [], written: false, reason: "Produk ini tidak punya opsi warna." };
  }

  // Group by colour and take the first variant that actually has an image —
  // previously a colour whose first variant had no image was reported as
  // unbound even when another size of the same colour had one.
  const byColor = new Map<string, { colorName: string; imageId: number | null }>();
  for (const v of product.variants) {
    const name = String((v as any)[`option${colorPos}`] || "").trim();
    if (!name || v.imageId == null) continue;
    const key = name.toLowerCase();
    const imageValid = product.images.some((img) => img.id === v.imageId);
    if (!imageValid) continue;
    if (!byColor.has(key)) {
      byColor.set(key, { colorName: name, imageId: v.imageId });
    }
  }

  const bound = [...byColor.values()].filter((c) => c.imageId != null);
  if (!bound.length) {
    return { bound: [], written: false, reason: "Belum ada varian yang punya gambar." };
  }

  const existing = parseColors(product.metafields.colors);
  const imageById = new Map(product.images.map((img) => [img.id, img.src]));
  const names = existing.map((c) => c.name.toLowerCase());
  const toWrite: ProductColor[] = [];
  const newlyBound: { colorName: string; imageId: number | null }[] = [];

  for (const entry of bound) {
    const key = entry.colorName.toLowerCase();
    const idx = names.indexOf(key);
    const currentImage = idx >= 0 ? existing[idx].imageId ?? null : null;
    if (currentImage === entry.imageId) continue; // already correct
    const image = entry.imageId != null ? imageById.get(entry.imageId) || null : null;
    if (idx >= 0) {
      toWrite[idx] = { ...existing[idx], imageId: entry.imageId, image };
    } else {
      names.push(key);
      toWrite[names.length - 1] = {
        name: entry.colorName,
        hex: resolveColorHex(entry.colorName),
        imageId: entry.imageId,
        image,
      };
    }
    newlyBound.push(entry);
  }

  if (!newlyBound.length) {
    return { bound: [], written: false, reason: "Semua warna sudah punya gambar yang sesuai." };
  }

  const merged: ProductColor[] = [];
  for (let i = 0; i < Math.max(existing.length, toWrite.length); i++) {
    merged[i] = toWrite[i] || existing[i];
  }
  await updateProduct(handle, { colors: merged.filter(Boolean) });
  return { bound: newlyBound, written: true };
}
