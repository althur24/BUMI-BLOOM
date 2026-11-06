// BUMI / BLOOM — Shopify Admin API transport.
// Ported from backend/scripts/migrate-to-shopify.mjs (client credentials grant,
// token caching, leaky-bucket rate-limit respect). Server-only — secrets in env.

import { canonicalizeUrl } from "./urls";

const SHOP = () => process.env.SHOPIFY_SHOP!;
const CLIENT_ID = () => process.env.SHOPIFY_CLIENT_ID!;
const CLIENT_SECRET = () => process.env.SHOPIFY_CLIENT_SECRET!;
const API_VERSION = () => process.env.SHOPIFY_API_VERSION || "2026-10";

function requireEnv(): void {
  if (!SHOP() || !CLIENT_ID() || !CLIENT_SECRET()) {
    throw new Error(
      "Shopify Admin env missing: SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET",
    );
  }
}

// Admin API calls must not hang a request forever. 10s is comfortably above
// normal GraphQL latency while keeping the tracking page responsive.
const REQUEST_TIMEOUT_MS = 10_000;

// ── Admin token (client credentials grant, cached + auto-refresh) ───────────
let _adminToken: string | null = null;
let _adminTokenExp = 0;

export async function getAdminToken(): Promise<string> {
  requireEnv();
  if (_adminToken && Date.now() < _adminTokenExp - 60_000) return _adminToken;
  const res = await fetch(`https://${SHOP()}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Admin token gagal: HTTP ${res.status} ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  _adminToken = access_token;
  _adminTokenExp = Date.now() + expires_in * 1000;
  return _adminToken;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── REST (used for product create/delete — JSON bodies are simpler) ─────────
export async function adminRest<T = any>(
  method: string,
  path: string,
  body?: any,
): Promise<T> {
  const token = await getAdminToken();
  const res = await fetch(
    `https://${SHOP()}.myshopify.com/admin/api/${API_VERSION()}${path}`,
    {
      method,
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const callLimit = res.headers.get("x-shopify-shop-api-call-limit");
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const msg = json?.errors ? JSON.stringify(json.errors) : text.slice(0, 300);
    throw new Error(`REST ${method} ${path} → HTTP ${res.status}: ${msg}`);
  }
  // Respect Shopify leaky-bucket rate limit.
  if (callLimit) {
    const [used, bucket] = callLimit.split("/").map(Number);
    if (bucket - used < 5) await sleep(500);
  }
  return json as T;
}

// ── GraphQL (used for metafields + publications) ────────────────────────────
export async function adminGraphQL<T = any>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await getAdminToken();
  const res = await fetch(
    `https://${SHOP()}.myshopify.com/admin/api/${API_VERSION()}/graphql.json`,
    {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length)
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

// ── Headless publication (so products appear on the storefront channel) ─────
export async function findHeadlessPublicationId(): Promise<string> {
  const data = await adminGraphQL<{ publications: { edges: { node: { id: string; name: string; app?: { title?: string } } }[] } }>(
    `{ publications(first: 30) { edges { node { id name app { title } } } } }`,
  );
  const pubs = data.publications.edges.map((e) => e.node);
  const headless = pubs.find(
    (n) => /headless/i.test(n.name) || /headless/i.test(n.app?.title || ""),
  );
  if (!headless) {
    throw new Error(
      'Channel "Headless" tidak ditemukan. Pastikan channel Headless ter-install.',
    );
  }
  return headless.id;
}

export async function publishToHeadless(
  productId: number | string,
  publicationId: string,
): Promise<void> {
  const gid = `gid://shopify/Product/${productId}`;
  await adminGraphQL(
    `mutation Publish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable { resourcePublicationsCount { count } }
        userErrors { field message }
      }
    }`,
    { id: gid, input: [{ publicationId }] },
  );
}

// ── Product CRUD helpers ────────────────────────────────────────────────────
// `payload` = Shopify REST product object ({ title, handle, body_html, variants, images, ... }).

export async function findProductByHandle(handle: string): Promise<{ id: number } | null> {
  const res = await adminRest<any>(
    "GET",
    `/products.json?handle=${encodeURIComponent(handle)}&limit=1`,
  );
  const list = res?.products;
  return list && list.length ? { id: list[0].id } : null;
}

export async function createProduct(payload: Record<string, unknown>): Promise<{
  id: number;
  variants: any[];
  images: any[];
}> {
  const res = await adminRest<any>("POST", "/products.json", { product: payload });
  if (!res?.product) throw new Error("Shopify product create tidak mengembalikan objek produk");
  return {
    id: res.product.id,
    variants: res.product.variants || [],
    images: res.product.images || [],
  };
}

export async function deleteProduct(id: number | string): Promise<void> {
  await adminRest("DELETE", `/products/${id}.json`);
}

// Fetch existing vendor names from Shopify (unique list from all products).
export async function fetchExistingVendors(): Promise<string[]> {
  const res = await adminRest<{ products: { vendor: string }[] }>(
    "GET",
    "/products.json?limit=250&fields=vendor",
  );
  const vendors = new Set<string>();
  for (const p of res?.products || []) {
    if (p.vendor) vendors.add(p.vendor);
  }
  return [...vendors];
}

// Normalize vendor string for fuzzy matching: lowercase, remove common
// suffixes (official/shop/store), strip non-alphanumeric.
function normalizeVendor(s: string): string {
  return s
    .toLowerCase()
    .replace(/official|shop|store|officialshop/g, "")
    .replace(/and/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Resolve scraped brand → existing Shopify vendor (case-insensitive fuzzy).
// 1) Simple normalization match (fast, free).
// 2) Partial containment match.
// Returns the exact existing vendor string if matched, or the original brand.
export function resolveVendorSimple(
  brand: string,
  existingVendors: string[],
): string {
  if (!brand) return "";
  const normBrand = normalizeVendor(brand);
  if (!normBrand) return brand;
  // exact normalized match
  for (const v of existingVendors) {
    if (normalizeVendor(v) === normBrand) return v;
  }
  // Partial containment is only safe when the shorter side is a substantial
  // fraction of the longer side (>= 70%). Without this guard, "Heem" would
  // match "Sabine and Heem" and unrelated brands get absorbed.
  for (const v of existingVendors) {
    const nv = normalizeVendor(v);
    if (nv.length < 3 || normBrand.length < 3) continue;
    if (nv.includes(normBrand) || normBrand.includes(nv)) {
      const shorter = Math.min(nv.length, normBrand.length);
      const longer = Math.max(nv.length, normBrand.length);
      if (shorter / longer >= 0.7) return v;
    }
  }
  return brand; // no match → new vendor
}

export async function setMetafields(
  ownerId: string,
  metafields: { namespace: string; key: string; value: string; type: string }[],
): Promise<void> {
  // single_line_text_field rejects line breaks, and one bad item rejects the
  // whole metafieldsSet batch. Normalize text and drop blanks before sending.
  const cleaned = metafields
    .map((m) =>
      m.type === "single_line_text_field"
        ? {
            ...m,
            // Shopify rejects newlines in single-line fields; join lines with
            // a separator so "S — 1-2 yrs\nM — 3-4 yrs" stays readable.
            value: String(m.value || "")
              .replace(/\s*[\r\n]+\s*/g, " · ")
              .replace(/\t+/g, " ")
              .replace(/ {2,}/g, " ")
              .trim(),
          }
        : m,
    )
    .filter(
      (m) =>
        !(
          (m.type === "single_line_text_field" ||
            m.type === "multi_line_text_field" ||
            m.type === "url") &&
          !String(m.value || "").trim()
        ),
    );
  if (!cleaned.length) return;
  const data = await adminGraphQL<{
    metafieldsSet: {
      metafields: { namespace: string; key: string }[];
      userErrors: { field?: string[] | null; message: string; code?: string }[];
    };
  }>(
    `mutation SetMeta($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { namespace key }
        userErrors { field message code }
      }
    }`,
    { metafields: cleaned.map((m) => ({ ownerId, ...m })) },
  );
  // metafieldsSet is a batch: one bad item (e.g. a type mismatch with an
  // existing definition) rejects the whole batch. Surface it instead of
  // reporting a successful push that silently stored nothing.
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    const detail = errors
      .map((e) => {
        const field = (e.field || []).filter(Boolean).join(".");
        return [field, e.message].filter(Boolean).join(": ");
      })
      .join("; ");
    throw new Error(`metafieldsSet gagal: ${detail}`);
  }
}

// ── Product update-in-place helpers ────────────────────────────────────────

type MetafieldInput = { namespace: string; key: string; value: string; type: string };

export interface PushOptions {
  // Existing Shopify product id (stored on the import job) or discovered by handle.
  existingId?: number | string | null;
  // Canonical source URL — guards against overwriting a different product that
  // happens to share the same handle.
  sourceUrl?: string;
}

export interface PushResult {
  productId: number;
  shopifyAdminUrl: string;
  warnings: string[];
}

function productAdminUrl(id: number | string): string {
  return `https://${SHOP()}.myshopify.com/admin/products/${id}`;
}

function normaliseSig(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function getProductById(id: number | string): Promise<any | null> {
  try {
    const res = await adminRest<any>("GET", `/products/${id}.json`);
    return res?.product || null;
  } catch {
    return null;
  }
}

async function findProductByHandleFull(handle: string): Promise<any | null> {
  const res = await adminRest<any>(
    "GET",
    `/products.json?handle=${encodeURIComponent(handle)}&limit=1`,
  );
  return res?.products?.[0] || null;
}

async function getProductMetafield(
  productId: number | string,
  namespace: string,
  key: string,
): Promise<{ id: number; value: string; type: string } | null> {
  try {
    const res = await adminRest<any>(
      "GET",
      `/products/${productId}/metafields.json?namespace=${encodeURIComponent(namespace)}&key=${encodeURIComponent(key)}`,
    );
    const mf = (res?.metafields || [])[0];
    return mf ? { id: mf.id, value: mf.value, type: mf.type } : null;
  } catch {
    return null;
  }
}

// Shopify rejects a metafieldsSet batch when an existing key has a different
// type (e.g. size_guide moved from single_line to multi_line). Delete the old
// definition first so the new one can be written.
async function ensureMetafieldTypes(
  productId: number | string,
  metafields: MetafieldInput[],
): Promise<void> {
  let existing: any[] = [];
  try {
    const res = await adminRest<any>("GET", `/products/${productId}/metafields.json`);
    existing = res?.metafields || [];
  } catch {
    return;
  }
  for (const incoming of metafields) {
    const match = existing.find(
      (m) => m.namespace === incoming.namespace && m.key === incoming.key,
    );
    if (match && match.type !== incoming.type) {
      await adminRest("DELETE", `/metafields/${match.id}.json`).catch(() => {});
    }
  }
}

function optionPosition(options: any[] | undefined, names: RegExp): number {
  const list = options || [];
  for (let i = 0; i < list.length; i++) {
    if (names.test(String(list[i]?.name || ""))) return i + 1;
  }
  return 0;
}

function existingVariantSignature(variant: any, options: any[] | undefined): string {
  const colorPos = optionPosition(options, /^(colou?r|warna)$/i);
  const sizePos = optionPosition(options, /^(size|ukuran)$/i);
  const color = colorPos ? variant[`option${colorPos}`] : "";
  const size = sizePos ? variant[`option${sizePos}`] : "";
  return `${normaliseSig(color)}|${normaliseSig(size)}`;
}

function payloadVariantSignature(
  variant: Record<string, any>,
  payloadOptions: { name: string }[] | undefined,
): string {
  const list = payloadOptions || [];
  const colorIdx = list.findIndex((o) => /^color$/i.test(String(o?.name || "")));
  const sizeIdx = list.findIndex((o) => /^size$/i.test(String(o?.name || "")));
  const color = colorIdx >= 0 ? variant[`option${colorIdx + 1}`] : "";
  const size = sizeIdx >= 0 ? variant[`option${sizeIdx + 1}`] : "";
  return `${normaliseSig(color)}|${normaliseSig(size)}`;
}

function indexVariants(variants: any[], options: any[] | undefined): Map<string, any> {
  const map = new Map<string, any>();
  for (const v of variants || []) {
    // Option signature first: a feed may repeat one SKU across every variant
    // (e.g. a single product-level code), which must not collapse them.
    map.set(`sig:${existingVariantSignature(v, options)}`, v);
    if (v?.sku) {
      const skuKey = `sku:${normaliseSig(v.sku)}`;
      if (!map.has(skuKey)) map.set(skuKey, v);
    }
  }
  return map;
}

let _primaryLocationId: number | string | null | undefined;

async function getPrimaryLocationId(): Promise<number | string | null> {
  if (_primaryLocationId !== undefined) return _primaryLocationId;
  try {
    const res = await adminRest<any>("GET", "/locations.json");
    const list = res?.locations || [];
    const active = list.find((l: any) => l.active) || list[0];
    _primaryLocationId = active?.id ?? null;
  } catch {
    _primaryLocationId = null;
  }
  return _primaryLocationId;
}

async function applyInventory(
  productId: number | string,
  payloadVariants: Record<string, any>[],
  payloadOptions: { name: string }[] | undefined,
  warnings: string[],
): Promise<void> {
  const product = await getProductById(productId);
  if (!product) return;
  const index = indexVariants(product.variants || [], product.options);
  const locationId = await getPrimaryLocationId();
  if (!locationId) {
    warnings.push("Lokasi inventory tidak ditemukan — stok tidak disinkronkan.");
    return;
  }

  const changes: { inventoryItemId: string; locationId: string; delta: number }[] = [];
  const restTargets: { inventoryItemId: number | string; qty: number; label: string }[] = [];
  for (const incoming of payloadVariants) {
    const sig = `sig:${payloadVariantSignature(incoming, payloadOptions)}`;
    const skuKey = incoming.sku ? `sku:${normaliseSig(incoming.sku)}` : "";
    const existing = index.get(sig) || (skuKey ? index.get(skuKey) : undefined);
    if (!existing?.inventory_item_id) continue;
    const qty = Math.max(0, Math.round(Number(incoming.inventory_quantity) || 0));
    const current =
      typeof existing.inventory_quantity === "number" ? existing.inventory_quantity : null;
    const delta = current == null ? qty : qty - current;
    if (delta === 0) continue;
    changes.push({
      inventoryItemId: `gid://shopify/InventoryItem/${existing.inventory_item_id}`,
      locationId: `gid://shopify/Location/${locationId}`,
      delta,
    });
    restTargets.push({
      inventoryItemId: existing.inventory_item_id,
      qty,
      label: incoming.sku || existing.sku || String(existing.id),
    });
  }
  if (!changes.length) return;

  // One bulk mutation instead of one request per variant (important for
  // products with dozens of colour × size combinations).
  try {
    const data = await adminGraphQL<{
      inventoryAdjustQuantities: {
        userErrors: { field?: string[] | null; message: string }[];
      };
    }>(
      `mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          userErrors { field message }
        }
      }`,
      {
        input: {
          name: "available",
          reason: "correction",
          changes: changes.map((c) => ({ ...c, changeFromQuantity: 0 })),
        },
      },
    );
    const errors = data?.inventoryAdjustQuantities?.userErrors || [];
    if (!errors.length) return;
    warnings.push(`Bulk inventory gagal: ${errors.map((e) => e.message).join("; ")}`);
  } catch (e: any) {
    warnings.push(`Bulk inventory gagal: ${e?.message || e}`);
  }

  // Fallback: set each level individually (slower, but reliable).
  for (const target of restTargets) {
    try {
      await adminRest("POST", "/inventory_levels/set.json", {
        location_id: Number(locationId),
        inventory_item_id: target.inventoryItemId,
        available: target.qty,
      });
    } catch (e: any) {
      warnings.push(`Stok varian ${target.label} gagal diset: ${e?.message || e}`);
    }
  }
}

async function addMissingImages(
  productId: number | string,
  existingImages: any[],
  payloadImages: Record<string, any>[],
  warnings: string[],
): Promise<void> {
  // Shopify rewrites src to its own CDN, so dedupe by basename as well —
  // otherwise every re-import appends a duplicate copy of the whole gallery.
  const seen = new Set<string>();
  for (const img of existingImages || []) {
    seen.add(String(img?.src || "").split("?")[0]);
    seen.add(imageBasename(img?.src));
  }
  let position = (existingImages || []).length + 1;
  for (const img of payloadImages) {
    const src = String(img.src || "");
    if (!src) continue;
    const key = src.split("?")[0];
    const base = imageBasename(src);
    if (seen.has(key) || (base && seen.has(base))) continue;
    try {
      const created = await adminRest<any>(
        "POST",
        `/products/${productId}/images.json`,
        { image: { src, alt: img.alt, position: position++ } },
      );
      seen.add(key);
      if (base) seen.add(base);
      if (created?.image?.src) {
        seen.add(String(created.image.src).split("?")[0]);
        const createdBase = imageBasename(created.image.src);
        if (createdBase) seen.add(createdBase);
      }
    } catch (e: any) {
      warnings.push(`Gambar gagal ditambahkan: ${e?.message || e}`);
    }
  }
}

// Shopify copies the source image to its CDN and rewrites the URL
// (cdn.shopify.com/s/files/.../<basename>_<uuid>.<ext>?v=...), so an exact URL
// match never works. Compare the file basename (without extension/uuid) instead.
function imageBasename(url: string | undefined): string {
  if (!url) return "";
  const withoutQuery = String(url).split("?")[0];
  const file = withoutQuery.split("/").pop() || "";
  return file
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "")
    .toLowerCase();
}

// Map a src URL → Shopify image id (for variant images / featured image).
function imageIdForSrc(
  images: any[],
  src: string | undefined,
): number | undefined {
  if (!src) return undefined;
  const target = String(src).split("?")[0];
  const exact = (images || []).find(
    (img) => String(img?.src || "").split("?")[0] === target,
  );
  if (exact) return exact.id;
  const key = imageBasename(src);
  if (!key) return undefined;
  const fuzzy = (images || []).find((img) => imageBasename(img?.src) === key);
  return fuzzy ? fuzzy.id : undefined;
}

// Attach the per-colour image to each variant (Shopify uses this as the
// variant image and the storefront swaps the gallery when the colour changes).
async function applyVariantImages(
  productId: number | string,
  payloadVariants: Record<string, any>[],
  payloadOptions: { name: string }[] | undefined,
  colorImages: Record<string, string> | undefined,
  warnings: string[],
): Promise<void> {
  const mapped = Object.values(colorImages || {}).filter(Boolean);
  if (!mapped.length) return;
  const product = await getProductById(productId);
  if (!product) return;
  const index = indexVariants(product.variants || [], product.options);
  const list = payloadOptions || [];
  const colorIdx = list.findIndex((o) => /^color$/i.test(String(o?.name || "")));

  const updates: Record<string, any>[] = [];
  for (const incoming of payloadVariants) {
    const color =
      colorIdx >= 0 ? String(incoming[`option${colorIdx + 1}`] || "") : "";
    const src = colorImages[color.trim().toLowerCase()];
    if (!src) continue;
    const imageId = imageIdForSrc(product.images || [], src);
    if (!imageId) continue;
    const sig = `sig:${payloadVariantSignature(incoming, payloadOptions)}`;
    const skuKey = incoming.sku ? `sku:${normaliseSig(incoming.sku)}` : "";
    const match = index.get(sig) || (skuKey ? index.get(skuKey) : undefined);
    if (!match) continue;
    if (match.image_id === imageId) continue;
    updates.push({ id: match.id, image_id: imageId });
  }
  if (!updates.length) return;

  try {
    await adminRest("PUT", `/products/${productId}.json`, {
      product: { id: productId, variants: updates },
    });
  } catch (e: any) {
    warnings.push(`Gambar varian gagal diset: ${e?.message || e}`);
  }
}

async function createProductPush(
  input: {
    handle: string;
    productPayload: Record<string, unknown>;
    metafields?: MetafieldInput[];
    publicationId?: string;
    colorImages?: Record<string, string>;
  },
  publicationId: string,
  warnings: string[],
): Promise<PushResult> {
  const created = await createProduct(input.productPayload);
  const metafields = (input.metafields || []).filter((m) => String(m.value || "").trim());
  if (metafields.length) {
    await ensureMetafieldTypes(created.id, metafields);
    await setMetafields(`gid://shopify/Product/${created.id}`, metafields);
  }
  await publishToHeadless(created.id, publicationId);

  const payloadVariants = (input.productPayload.variants as Record<string, any>[]) || [];
  const payloadOptions = input.productPayload.options as { name: string }[] | undefined;
  await applyVariantImages(created.id, payloadVariants, payloadOptions, input.colorImages, warnings);
  await applyInventory(created.id, payloadVariants, payloadOptions, warnings);

  return { productId: created.id, shopifyAdminUrl: productAdminUrl(created.id), warnings };
}

async function updateProductPush(
  existing: any,
  input: {
    handle: string;
    productPayload: Record<string, unknown>;
    metafields?: MetafieldInput[];
    publicationId?: string;
    colorImages?: Record<string, string>;
  },
  publicationId: string,
  warnings: string[],
): Promise<PushResult> {
  const productId = existing.id;
  const payload = input.productPayload;

  // 1) Basic fields (options are intentionally not sent: variant option values
  //    are reconciled individually below to avoid Shopify recreating variants).
  await adminRest("PUT", `/products/${productId}.json`, {
    product: {
      id: productId,
      title: payload.title,
      handle: input.handle,
      body_html: payload.body_html,
      vendor: payload.vendor,
      product_type: payload.product_type,
      tags: payload.tags,
      status: payload.status || existing.status || "active",
    },
  });

  const payloadVariants = (payload.variants as Record<string, any>[]) || [];
  const payloadOptions = payload.options as { name: string }[] | undefined;
  const index = indexVariants(existing.variants || [], existing.options);

  // Batch updates for variants that already exist (one request instead of N),
  // then create genuinely new variants individually.
  const matchedUpdates: Record<string, any>[] = [];
  const newVariants: Record<string, any>[] = [];
  for (const incoming of payloadVariants) {
    const sig = `sig:${payloadVariantSignature(incoming, payloadOptions)}`;
    const skuKey = incoming.sku ? `sku:${normaliseSig(incoming.sku)}` : "";
    const match = index.get(sig) || (skuKey ? index.get(skuKey) : undefined);
    const body: Record<string, any> = {
      price: incoming.price,
      sku: incoming.sku || match?.sku || "",
      compare_at_price:
        incoming.compare_at_price != null && incoming.compare_at_price !== ""
          ? incoming.compare_at_price
          : null,
    };
    if (incoming.grams) body.grams = incoming.grams;
    if (match) {
      matchedUpdates.push({ id: match.id, ...body });
    } else {
      // New variants need their option values, otherwise Shopify creates a
      // duplicate "Default" variant.
      for (const i of [1, 2, 3]) {
        if (incoming[`option${i}`] != null) body[`option${i}`] = incoming[`option${i}`];
      }
      newVariants.push(body);
    }
  }

  if (matchedUpdates.length) {
    try {
      await adminRest("PUT", `/products/${productId}.json`, {
        product: { id: productId, variants: matchedUpdates },
      });
    } catch (e: any) {
      warnings.push(`Update varian batch gagal: ${e?.message || e}`);
    }
  }

  for (const body of newVariants) {
    try {
      const created = await adminRest<any>("POST", `/products/${productId}/variants.json`, {
        variant: body,
      });
      if (created?.variant) {
        index.set(`sig:${payloadVariantSignature(body, payloadOptions)}`, created.variant);
      }
    } catch (e: any) {
      warnings.push(`Varian baru gagal dibuat (${body.sku || "-"}): ${e?.message || e}`);
    }
  }

  // 2) Images — add new ones, never delete the merchant's existing gallery.
  await addMissingImages(
    productId,
    existing.images || [],
    (payload.images as Record<string, any>[]) || [],
    warnings,
  );

  // 3) Metafields (upsert by namespace+key).
  const metafields = (input.metafields || []).filter((m) => String(m.value || "").trim());
  if (metafields.length) {
    await ensureMetafieldTypes(productId, metafields);
    await setMetafields(`gid://shopify/Product/${productId}`, metafields);
  }

  // 4) Variant images (colour → image) after the new images exist.
  await applyVariantImages(productId, payloadVariants, payloadOptions, input.colorImages, warnings);

  // 5) Inventory — verify/enforce the requested quantities.
  await applyInventory(productId, payloadVariants, payloadOptions, warnings);

  await publishToHeadless(productId, publicationId);

  return { productId, shopifyAdminUrl: productAdminUrl(productId), warnings };
}

// Full import push: update the existing product when it belongs to the same
// source URL, otherwise create a new one. Product IDs/reviews are preserved.
export async function pushProductToShopify(
  input: {
    handle: string;
    productPayload: Record<string, unknown>;
    metafields?: MetafieldInput[];
    publicationId?: string;
    colorImages?: Record<string, string>;
  },
  options: PushOptions = {},
): Promise<PushResult> {
  const publicationId = input.publicationId ?? (await findHeadlessPublicationId());
  const warnings: string[] = [];

  let existing: any = null;
  if (options.existingId) existing = await getProductById(options.existingId);
  if (!existing && input.handle) existing = await findProductByHandleFull(input.handle);

  if (existing) {
    if (options.sourceUrl) {
      const sourceMf = await getProductMetafield(existing.id, "bumi", "source_url");
      if (sourceMf?.value && canonicalizeUrl(sourceMf.value) !== options.sourceUrl) {
        throw new Error(
          `Handle "${input.handle}" sudah dipakai produk lain (${sourceMf.value}). ` +
            "Ubah judul produk atau hapus produk lama sebelum push.",
        );
      }
      if (!sourceMf) {
        throw new Error(
          `Handle "${input.handle}" sudah ada di Shopify tetapi bukan hasil import. ` +
            "Ubah judul produk atau hapus produk lama sebelum push.",
        );
      }
    }
    return updateProductPush(existing, input, publicationId, warnings);
  }

  return createProductPush(input, publicationId, warnings);
}
