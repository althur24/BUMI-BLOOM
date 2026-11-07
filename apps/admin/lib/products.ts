// Direct Shopify product read/write for the admin "Produk" editor.
//
// The import pipeline is intentionally one-way (source → staging → Shopify).
// This module is the other direction: it lets an admin fix a live product
// (colours, variants, images, metafields) without re-importing it.

import { adminRest, setMetafields } from "./shopify";
import { colorsFromVariants, normalizeHex, resolveColorHex } from "./colors";

export type BumiMetafieldKey =
  | "colors"
  | "material"
  | "fibre"
  | "audience"
  | "size_guide"
  | "size_chart_image"
  | "shipping_returns"
  | "badge"
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
  imageOrder?: number[];
}

const BUMI_FIELDS: BumiMetafieldKey[] = [
  "colors",
  "material",
  "fibre",
  "audience",
  "size_guide",
  "size_chart_image",
  "shipping_returns",
  "badge",
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
  material: "single_line_text_field",
  fibre: "single_line_text_field",
  audience: "single_line_text_field",
  size_guide: "single_line_text_field",
  size_chart_image: "url",
  shipping_returns: "single_line_text_field",
  badge: "single_line_text_field",
  rating: "number_decimal",
  reviews_count: "number_integer",
  sold_count: "number_integer",
  source_url: "single_line_text_field",
  source_platform: "single_line_text_field",
  brand: "single_line_text_field",
  no_color: "boolean",
};

const STORE_CATEGORIES = new Set([
  "tshirts",
  "shorts",
  "dresses",
  "outerwear",
  "accessories",
  "baby",
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

async function fetchMetafields(productId: number | string): Promise<any[]> {
  try {
    const res = await adminRest<any>(
      "GET",
      `/products/${productId}/metafields.json?namespace=bumi`,
    );
    return res?.metafields || [];
  } catch {
    return [];
  }
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

  const products: AdminProductSummary[] = [];
  for (const p of raw) {
    const metafields = await fetchMetafields(p.id);
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
      sourceUrl: metafieldValue(metafields, "source_url") || null,
      sourcePlatform: metafieldValue(metafields, "source_platform") || null,
      issues,
    });
  }

  const nextCursor = linkHeader?.match(/page_info=([^&>]+)/)?.[1] || null;
  return { products, nextCursor };
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

async function upsertMetafields(
  productId: number | string,
  patch: Partial<Record<BumiMetafieldKey, string>>,
): Promise<string[]> {
  const values: { namespace: string; key: string; value: string; type: string }[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const typed = key as BumiMetafieldKey;
    if (!BUMI_FIELDS.includes(typed)) continue;
    if (value == null) continue;
    values.push({
      namespace: "bumi",
      key: typed,
      value: String(value),
      type: FIELD_TYPES[typed],
    });
  }
  if (!values.length) return [];
  await setMetafields(`gid://shopify/Product/${productId}`, values);
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
        const detail = await adminRest<any>("GET", `/variants/${v.id}.json`).catch(() => null);
        const itemId = detail?.variant?.inventory_item_id;
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

  if (patch.imageOrder?.length) {
    for (let i = 0; i < patch.imageOrder.length; i++) {
      await adminRest("PUT", `/product_images/${patch.imageOrder[i]}.json`, {
        image: { id: patch.imageOrder[i], position: i + 1 },
      }).catch((e: any) => warnings.push(`Urutan gambar gagal: ${e?.message || e}`));
    }
    updated.push("imageOrder");
  }

  for (const imageId of patch.removeImageIds || []) {
    try {
      await adminRest("DELETE", `/products/${productId}/images/${imageId}.json`);
    } catch (e: any) {
      warnings.push(`Gambar ${imageId} gagal dihapus: ${e?.message || e}`);
    }
  }
  if (patch.removeImageIds?.length) updated.push("imagesRemoved");

  const metaPatch: Partial<Record<BumiMetafieldKey, string>> = { ...(patch.metafields || {}) };

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

  // Flush price/SKU changes one variant at a time. A product-level PUT with a
  // subset of variants deletes the omitted ones, so this is the only safe path
  // when the product has more variants than the ones being edited.
  if (pendingVariantUpdates.length) {
    for (const v of pendingVariantUpdates) {
      const id = Number(v.id);
      const body: Record<string, unknown> = { id };
      for (const [k, val] of Object.entries(v)) {
        if (k !== "id") body[k] = val;
      }
      if (Object.keys(body).length <= 1) continue;
      try {
        await adminRest("PUT", `/variants/${id}.json`, { variant: body });
      } catch (e: any) {
        warnings.push(`Varian ${id} gagal disimpan: ${e?.message || e}`);
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

  const byColor = new Map<string, { colorName: string; imageId: number | null }>();
  for (const v of product.variants) {
    const name = String((v as any)[`option${colorPos}`] || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const current = byColor.get(key);
    if (!current) {
      byColor.set(key, { colorName: name, imageId: v.imageId ?? null });
    } else if (!current.imageId && v.imageId) {
      current.imageId = v.imageId;
    }
  }

  const bound = [...byColor.values()].filter((c) => c.imageId != null);
  if (!bound.length) {
    return { bound: [], written: false, reason: "Belum ada varian yang punya gambar." };
  }

  const existing = parseColors(product.metafields.colors);
  const names = existing.map((c) => c.name.toLowerCase());
  const merged: ProductColor[] = [...existing];
  for (const entry of bound) {
    const key = entry.colorName.toLowerCase();
    const idx = names.indexOf(key);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], imageId: entry.imageId };
    } else {
      merged.push({ name: entry.colorName, hex: resolveColorHex(entry.colorName), imageId: entry.imageId });
      names.push(key);
    }
  }

  await updateProduct(handle, { colors: merged });
  return { bound, written: true };
}
