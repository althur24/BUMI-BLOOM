// Maps a (possibly admin-edited) NormalizedProduct → a Shopify REST product
// payload + `bumi` metafields. Adapted from backend/scripts/migrate-to-shopify.mjs
// buildShopifyProduct, but driven by the scraper's normalized shape.

import type { NormalizedProduct, ScraperVariant } from "./scrapers/base";
import { colorsFromVariants } from "./colors";
import { inferCategory } from "./categorize";

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

function clip(value: string, max = 255): string {
  const s = String(value || "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function opt(v: ScraperVariant, ...keys: string[]): string | undefined {
  for (const k of keys) {
    for (const key of Object.keys(v.options || {})) {
      if (key.toLowerCase() === k.toLowerCase()) return v.options[key];
    }
  }
  return undefined;
}

function priceStr(cents: number | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "0";
  return cents.toFixed(2);
}

// Plain-text description → safe Shopify body_html, preserving paragraphs and
// bullet lines instead of flattening everything into one paragraph.
function textToHtml(text: string | undefined): string {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return "";
  const blocks = raw.split(/\n{2,}/);
  const html = blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return "";
      if (lines.every((l) => /^[-*•]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${escHtml(l.replace(/^[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map((l) => escHtml(l)).join("<br>")}</p>`;
    })
    .filter(Boolean);
  return html.join("");
}

function normaliseCategory(value: string | undefined): string {
  const v = String(value || "").toLowerCase().trim();
  if (["tshirts", "shorts", "dresses", "outerwear", "accessories", "baby"].includes(v)) {
    return v;
  }
  return inferCategory(v);
}

export function buildShopifyPushInput(
  np: NormalizedProduct,
  opts: { handle?: string } = {},
): ShopifyPushInput {
  const category = normaliseCategory(np.specs?.category);
  const handle = clip(
    opts.handle || slugify(`${np.brand ? np.brand + " " : ""}${np.title}`) || `import-${Date.now()}`,
    80,
  );

  const colorOf = (v: ScraperVariant) => opt(v, "Warna", "Color", "Colour");
  const sizeOf = (v: ScraperVariant) => opt(v, "Ukuran", "Size");

  const colorKey = np.variants.some((v) => colorOf(v)) ? "Color" : null;
  const sizeKey = np.variants.some((v) => sizeOf(v)) ? "Size" : null;

  // If one dimension exists but a variant is missing a value, fill it with the
  // first known value (a real colorway) rather than creating a fake "Default".
  const firstColor = np.variants.map(colorOf).find(Boolean);
  const firstSize = np.variants.map(sizeOf).find(Boolean);
  const variantColor = (v: ScraperVariant) =>
    colorOf(v) || (colorKey ? firstColor : undefined);
  const variantSize = (v: ScraperVariant) =>
    sizeOf(v) || (sizeKey ? firstSize : undefined);

  const productCompareAt = np.compareAtPrice;
  const baseVariants = np.variants.slice(0, 100);
  const variants =
    baseVariants.length > 0
      ? baseVariants.map((v) => {
          const price = v.price ?? np.price;
          const compareAt =
            v.compareAtPrice && price != null && v.compareAtPrice > price
              ? v.compareAtPrice
              : productCompareAt && price != null && productCompareAt > price
                ? productCompareAt
                : undefined;
          const variant: Record<string, unknown> = {
            price: priceStr(price),
            inventory_management: "shopify",
            inventory_quantity: Math.max(0, Math.round(v.stock ?? 0)),
            requires_shipping: true,
          };
          if (compareAt != null) variant.compare_at_price = priceStr(compareAt);
          if (v.sku) variant.sku = clip(v.sku, 100);
          if (v.grams != null) variant.grams = Math.round(v.grams);
          let optIdx = 1;
          if (colorKey) {
            variant[`option${optIdx}`] = clip(variantColor(v) || "Default", 255);
            optIdx++;
          }
          if (sizeKey) {
            variant[`option${optIdx}`] = clip(variantSize(v) || "Default", 255);
            optIdx++;
          }
          return variant;
        })
      : [
          {
            price: priceStr(np.price),
            compare_at_price:
              productCompareAt && np.price != null && productCompareAt > np.price
                ? priceStr(productCompareAt)
                : undefined,
            inventory_management: "shopify",
            inventory_quantity: 0,
            requires_shipping: true,
          },
        ];

  const images = (np.images || []).slice(0, 20).map((src, i) => ({
    src,
    alt: clip(`${np.title}${np.brand ? ` — ${np.brand}` : ""}`, 512),
    position: i + 1,
  }));

  const audience = (np.specs?.audience || "unisex").toLowerCase();
  const tags = [
    np.platform.toLowerCase(),
    np.brand,
    category || null,
    audience,
    ...(np.colors || []).map((c) => c.name),
  ]
    .filter(Boolean)
    .join(", ");

  const uniqueValues = (values: (string | undefined)[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
      if (!value) continue;
      const key = value.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  };
  const colorValues = uniqueValues(np.variants.map((v) => variantColor(v)));
  const sizeValues = uniqueValues(np.variants.map((v) => variantSize(v)));

  const options = [];
  if (colorKey)
    options.push({ name: "Color", values: colorValues.length ? colorValues : ["Default"] });
  if (sizeKey)
    options.push({ name: "Size", values: sizeValues.length ? sizeValues : ["Default"] });

  const productPayload: Record<string, unknown> = {
    title: clip(np.title, 255),
    handle,
    body_html: textToHtml(np.description),
    vendor: clip(np.brand || "", 255),
    product_type: category,
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
      value: clip(np.brand),
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
  if (np.reviewsCount != null)
    metafields.push({
      namespace: "bumi",
      key: "reviews_count",
      value: String(Math.round(np.reviewsCount)),
      type: "number_integer",
    });
  if (np.soldCount != null)
    metafields.push({
      namespace: "bumi",
      key: "sold_count",
      value: String(Math.round(np.soldCount)),
      type: "number_integer",
    });

  const colorsJson = colorsFromVariants(np.variants, np.colors || []);
  if (colorsJson.length)
    metafields.push({
      namespace: "bumi",
      key: "colors",
      value: JSON.stringify(colorsJson),
      type: "json",
    });

  if (np.materialCare)
    metafields.push({
      namespace: "bumi",
      key: "material",
      value: np.materialCare,
      type: "multi_line_text_field",
    });
  if (np.sizeGuide)
    metafields.push({
      namespace: "bumi",
      key: "size_guide",
      value: np.sizeGuide,
      type: "multi_line_text_field",
    });
  if (np.sizeChartImage)
    metafields.push({
      namespace: "bumi",
      key: "size_chart_image",
      value: np.sizeChartImage,
      type: "url",
    });
  if (np.shippingReturns)
    metafields.push({
      namespace: "bumi",
      key: "shipping_returns",
      value: np.shippingReturns,
      type: "multi_line_text_field",
    });
  if (np.fibre)
    metafields.push({
      namespace: "bumi",
      key: "fibre",
      value: clip(np.fibre),
      type: "single_line_text_field",
    });

  metafields.push({
    namespace: "bumi",
    key: "audience",
    value: audience,
    type: "single_line_text_field",
  });
  metafields.push({ namespace: "bumi", key: "is_new", value: "true", type: "boolean" });
  metafields.push({
    namespace: "bumi",
    key: "badge",
    value: "new",
    type: "single_line_text_field",
  });
  metafields.push({
    namespace: "bumi",
    key: "added_at_rank",
    value: String(Date.now()),
    type: "number_integer",
  });

  return { handle, productPayload, metafields };
}
