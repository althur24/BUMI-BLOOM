// Maps a (possibly admin-edited) NormalizedProduct → a Shopify REST product
// payload + `bumi` metafields. Adapted from backend/scripts/migrate-to-shopify.mjs
// buildShopifyProduct, but driven by the scraper's normalized shape instead of
// the old Supabase Product rows.

import type { NormalizedProduct, ScraperVariant } from "./scrapers/base";

export interface ShopifyPushInput {
  handle: string;
  productPayload: Record<string, unknown>;
  metafields: { namespace: string; key: string; value: string; type: string }[];
}

function slugify(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function escHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function opt(v: ScraperVariant, ...keys: string[]): string | undefined {
  for (const k of keys) {
    for (const key of Object.keys(v.options)) {
      if (key.toLowerCase() === k.toLowerCase()) return v.options[key];
    }
  }
  return undefined;
}

function priceStr(cents: number | undefined): string {
  // Price is in major units (e.g. 499000). Shopify wants a decimal string.
  // NOTE: store currency may differ from source currency (IDR vs AUD) — the
  // admin is expected to set the correct price in the editable preview.
  if (cents == null || !Number.isFinite(cents)) return "0";
  return cents.toFixed(2);
}

export function buildShopifyPushInput(np: NormalizedProduct): ShopifyPushInput {
  const handle = slugify(np.title) || `import-${Date.now()}`;

  const colorKey = np.variants.some((v) => opt(v, "Warna", "Color"))
    ? "Color"
    : null;
  const sizeKey = np.variants.some((v) => opt(v, "Ukuran", "Size"))
    ? "Size"
    : null;

  const variants =
    np.variants.length > 0
      ? np.variants.map((v) => {
          const variant: Record<string, unknown> = {
            price: priceStr(v.price ?? np.price),
            inventory_management: "shopify",
            inventory_quantity: v.stock ?? 0,
          };
          // Assign options in order: option1 FIRST (Shopify requires option1
          // before option2). If only size (no color), size goes to option1.
          let optIdx = 1;
          if (colorKey) {
            variant[`option${optIdx}`] = opt(v, "Warna", "Color") || "Default";
            optIdx++;
          }
          if (sizeKey) {
            variant[`option${optIdx}`] = opt(v, "Ukuran", "Size");
            optIdx++;
          }
          if (v.sku) variant.sku = v.sku;
          return variant;
        })
      : [
          {
            price: priceStr(np.price),
            inventory_management: "shopify",
            inventory_quantity: 0,
          },
        ];

  const images = np.images.slice(0, 20).map((src) => ({ src }));

  const tags = [
    np.platform.toLowerCase(),
    np.brand,
    np.location ? `loc:${np.location}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const colorValues = [
    ...new Set(
      np.variants
        .map((v) => opt(v, "Warna", "Color"))
        .filter(Boolean) as string[],
    ),
  ];
  const sizeValues = [
    ...new Set(
      np.variants
        .map((v) => opt(v, "Ukuran", "Size"))
        .filter(Boolean) as string[],
    ),
  ];

  const options = [];
  if (colorKey)
    options.push({ name: "Color", values: colorValues.length ? colorValues : ["Default"] });
  if (sizeKey)
    options.push({ name: "Size", values: sizeValues.length ? sizeValues : ["Default"] });

  const body_html = `<p>${escHtml(np.description || "")}</p>`;

  const productPayload: Record<string, unknown> = {
    title: np.title,
    handle,
    body_html,
    vendor: np.brand || "",
    product_type: (np.specs?.category || "").toLowerCase(),
    tags,
    status: "active",
    variants,
    images,
  };
  if (options.length) productPayload.options = options;

  const metafields: ShopifyPushInput["metafields"] = [
    {
      namespace: "bumi",
      key: "source_platform",
      value: np.platform.toLowerCase(),
      type: "single_line_text_field",
    },
    {
      namespace: "bumi",
      key: "source_url",
      value: np.sourceUrl,
      type: "single_line_text_field",
    },
  ];
  if (np.brand)
    metafields.push({
      namespace: "bumi",
      key: "brand",
      value: np.brand,
      type: "single_line_text_field",
    });
  if (np.currency)
    metafields.push({
      namespace: "bumi",
      key: "source_currency",
      value: np.currency,
      type: "single_line_text_field",
    });
  if (np.rating != null)
    metafields.push({
      namespace: "bumi",
      key: "rating",
      value: String(np.rating),
      type: "number_decimal",
    });
  if (np.soldCount != null)
    metafields.push({
      namespace: "bumi",
      key: "sold_count",
      value: String(np.soldCount),
      type: "number_integer",
    });

  // Colors metafield — JSON array of {name, hex} for storefront swatches.
  const colorHexMap: Record<string, string> = {};
  for (const v of np.variants) {
    const name = opt(v, "Warna", "Color");
    if (name && v.hex && !colorHexMap[name]) colorHexMap[name] = v.hex;
  }
  const colorsJson = Object.entries(colorHexMap)
    .map(([name, hex]) => ({ name, hex }))
    .filter(c => c.hex);
  if (colorsJson.length)
    metafields.push({
      namespace: "bumi",
      key: "colors",
      value: JSON.stringify(colorsJson),
      type: "json",
    });

  // AI-generated fields — key "material" matches storefront data.js query.
  if (np.materialCare)
    metafields.push({ namespace: "bumi", key: "material", value: np.materialCare, type: "single_line_text_field" });
  if (np.sizeGuide)
    metafields.push({ namespace: "bumi", key: "size_guide", value: np.sizeGuide, type: "single_line_text_field" });
  if (np.shippingReturns)
    metafields.push({ namespace: "bumi", key: "shipping_returns", value: np.shippingReturns, type: "single_line_text_field" });
  if (np.fibre)
    metafields.push({ namespace: "bumi", key: "fibre", value: np.fibre, type: "single_line_text_field" });

  // Audience — for Girls/Boys/Baby storefront filters.
  const audience = np.specs?.audience || "unisex";
  metafields.push({ namespace: "bumi", key: "audience", value: audience, type: "single_line_text_field" });

  // New product defaults.
  metafields.push({ namespace: "bumi", key: "is_new", value: "true", type: "true_false" });
  metafields.push({ namespace: "bumi", key: "badge", value: "new", type: "single_line_text_field" });
  metafields.push({ namespace: "bumi", key: "reviews_count", value: "0", type: "number_integer" });

  // Sort rank — newest first on homepage.
  metafields.push({ namespace: "bumi", key: "added_at_rank", value: String(Date.now()), type: "number_integer" });

  return { handle, productPayload, metafields };
}
