// Unit tests for the pure import helpers. Run: npx tsx apps/admin/scripts/unit-test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  imageUrlCandidates,
  imageIdentity,
  imageQualityScore,
  parseSrcset,
  isLikelySizeChart,
  isLikelyAsset,
  sniffImage,
} from "../lib/image-utils";
import { buildSizeGuide, inferAudience, inferCategory, sizeGuideLine } from "../lib/categorize";
import { buildShopifyPushInput } from "../lib/import-mapper";
import { cleanMetafields } from "../lib/shopify";
import {
  classifyScrapeFailure,
  createScrapeGuard,
  hostOf,
} from "../lib/scrape-guard";
import { buildContentPatch, deriveColors } from "../lib/generate-content";
import { colorsFromVariants, detectColorNames, hexForColorName } from "../lib/colors";
import { normaliseAudience, parseAudience } from "../lib/audience";
import {
  buildSizeGuideRows,
  displaySize,
  heightToAge,
  normaliseSizeLabelMode,
  parseSizeMeta,
  translateSizeLabel,
} from "../lib/size-labels";
import { canonicalizeUrl } from "../lib/urls";
import { brandFromOgTitle, extractPdpStructured } from "../lib/scrapers/tokopedia-pdp";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e: any) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("canonicalizeUrl strips tracking params and hash", () => {
  const a = canonicalizeUrl(
    "https://Example.com/products/1?utm_source=x&extParam=abc&aff_unique_id=&channel=others&id=42#reviews",
  );
  const b = canonicalizeUrl("https://example.com/products/1?id=42");
  assert.equal(a, b);
});

test("canonicalizeUrl keeps meaningful query params", () => {
  assert.ok(canonicalizeUrl("https://shop.test/p?id=99").includes("id=99"));
});

test("CloudFront resized image is upgraded to the original", () => {
  const candidates = imageUrlCandidates(
    "https://cdn.test/vendor/11218/product/1273-artboard_49_1791432827732_resized1024-jpeg.webp",
  );
  assert.equal(
    candidates[0],
    "https://cdn.test/vendor/11218/product/1273-artboard_49_1791432827732.jpeg",
  );
});

test("Tokopedia image cache candidates prefer the largest usable size", () => {
  const candidates = imageUrlCandidates(
    "https://images.tokopedia.net/img/cache/700/product-1/abc.jpg",
  );
  assert.ok(candidates[0].includes("/img/cache/original/"));
  assert.ok(candidates.some((u) => u.includes("/img/cache/1500/")));
  assert.ok(candidates.some((u) => u.includes("/img/cache/1000/")));
});

test("Tokopedia signed CDN transform is upgraded to a larger width", () => {
  const small =
    "https://p16-images-sign-sg.tokopedia-static.net/tos-alisg-i-aphluv4xwc-sg/1234567890abcdef1234567890abcdef~tplv-aphluv4xwc-resize-jpeg:200:0.webp?ect=4g";
  const best = imageUrlCandidates(small)[0];
  assert.ok(best.includes(":1600:0."));
  assert.ok(imageQualityScore(small) >= 1600);
});

test("Shopee image resize query is stripped", () => {
  const candidates = imageUrlCandidates(
    "https://down-id.img.susercontent.com/file/abc?imageView2/2/w/700",
  );
  assert.equal(candidates[0], "https://down-id.img.susercontent.com/file/abc");
});

test("imageIdentity ignores CDN transform variants", () => {
  const a = imageIdentity("https://cdn.test/a_1791_resized128-jpeg.webp");
  const b = imageIdentity("https://cdn.test/a_1791.jpeg");
  assert.equal(a, b);
});

test("imageIdentity folds Tokopedia mirror hosts and transforms", () => {
  const cdn =
    "https://p16-images-sign-sg.tokopedia-static.net/tos-alisg-i-aphluv4xwc-sg/c38e6ad648b74ecf86b6afc12101c2ef~tplv-aphluv4xwc-resize-jpeg:700:0.webp";
  const mirror =
    "https://images.tokopedia.net/img/cache/1000/aphluv/1997/1/1/c38e6ad648b74ecf86b6afc12101c2ef~.jpeg.webp";
  assert.equal(imageIdentity(cdn), imageIdentity(mirror));
  assert.ok(imageQualityScore(mirror) > imageQualityScore(cdn));
});

test("tokopedia pwa icons and ad assets are rejected", () => {
  assert.equal(isLikelyAsset("https://tokopedia.net/icons/icon192.png"), true);
  assert.equal(
    isLikelyAsset("https://images.tokopedia.net/img/pdp/icons/shopcredibility/action-star-light.jpg"),
    true,
  );
  assert.equal(isLikelyAsset("https://cdn.test/product/1273-artboard.jpeg"), false);
});

test("parseSrcset chooses the widest candidate", () => {
  const parsed = parseSrcset("a.jpg 128w, b.jpg 1024w, c.jpg 512w");
  assert.equal(parsed.best, "b.jpg");
});

test("size chart detection", () => {
  assert.equal(isLikelySizeChart("https://cdn.test/1273-size_chart_bim.jpeg"), true);
  assert.equal(isLikelySizeChart("https://cdn.test/artboard_49.jpeg"), false);
});

test("asset filtering", () => {
  assert.equal(isLikelyAsset("https://cdn.test/assets/logo.png"), true);
  assert.equal(isLikelyAsset("https://cdn.test/product/1273-artboard.jpeg"), false);
});

test("sniffImage reads PNG dimensions", () => {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const dv = new DataView(png.buffer);
  dv.setUint32(16, 1319);
  dv.setUint32(20, 1760);
  const info = sniffImage(png);
  assert.equal(info?.mime, "image/png");
  assert.equal(info?.width, 1319);
  assert.equal(info?.height, 1760);
});

test("size guide parses age ranges and toddler sizes", () => {
  assert.equal(sizeGuideLine("S (1-2 YO)"), "S (1-2 YO) — 1–2 yrs");
  assert.equal(sizeGuideLine("12-18M"), "12-18M — 12–18 months");
  assert.equal(sizeGuideLine("2T"), "2T — 2–3 yrs");
  const guide = buildSizeGuide(["S (1-2 YO)", "M (3-4 YO)"], {
    sizeChartImage: "https://cdn.test/chart.jpeg",
  });
  assert.ok(guide?.includes("S (1-2 YO) — 1–2 yrs"));
  assert.ok(guide?.includes("Size chart:"));
});

test("color detection avoids substrings and finds fashion names", () => {
  assert.deepEqual(detectColorNames("Message from us"), []);
  assert.deepEqual(detectColorNames("BIM Ribbed Shirt - Butter - Kids Tops"), ["Butter"]);
  assert.equal(hexForColorName("Butter"), "#F3E3A3");
});

test("colorsFromVariants surfaces single-colour products without a Color option", () => {
  // A product like "BIM Ribbed Shirt - Butter" has no Color option on its
  // variants (Size only) but still has a detected colourway.
  const result = colorsFromVariants(
    [
      { options: { Size: "S (1-2 YO)" } },
      { options: { Size: "M (3-4 YO)" } },
    ],
    [{ name: "Butter", hex: "#F3E3A3" }],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Butter");
  assert.equal(result[0].hex, "#F3E3A3");

  // Multi-colour variants still take priority over the explicit list.
  const multi = colorsFromVariants(
    [
      { options: { Color: "Blue", Size: "S" } },
      { options: { Color: "Pink", Size: "S" } },
    ],
    [{ name: "Butter", hex: "#F3E3A3" }],
  );
  assert.equal(multi.length, 2);
  assert.equal(multi[0].name, "Blue");
  assert.equal(multi[1].name, "Pink");
});

test("colours keep their bound image through the metafield round-trip", () => {
  const stored = JSON.stringify([
    { name: "Navy", hex: "#00408C", imageId: 123, image: "https://cdn/navy.jpg" },
    { name: "Butter", hex: "#F3E3A3", imageId: null, image: null },
  ]);
  const parsed = JSON.parse(stored);
  assert.equal(parsed[0].imageId, 123);
  assert.equal(parsed[0].image, "https://cdn/navy.jpg");
  assert.equal(parsed[1].imageId, null);
});

test("category and audience inference", () => {
  assert.equal(inferCategory("Anakmu Piccolo Jacket windbreaker"), "outerwear");
  assert.equal(inferCategory("BIM Ribbed Shirt Kids Longsleeved Tops"), "tshirts");
  // There is no Baby category on the storefront: baby basics fall back to the
  // closest real category (tops), while a specific garment keyword still wins.
  assert.equal(inferCategory("Baby Romper"), "tshirts");
  assert.equal(inferCategory("Newborn Onesie"), "tshirts");
  assert.equal(inferCategory("Baby Jacket"), "outerwear");
  assert.equal(inferCategory("Baby Dress"), "dresses");
  assert.equal(inferCategory("Baby Busy Book"), "busy-book");
  assert.equal(inferAudience("Unisex kids longsleeved top"), "unisex");
  assert.equal(inferAudience("Dress untuk anak perempuan"), "girls");
  assert.equal(inferAudience("Kaos anak laki-laki"), "boys");
  assert.equal(inferAudience("Anak Perempuan Set"), "girls");
  // No Baby collection on the storefront: baby-only wording is unisex.
  assert.equal(inferAudience("Baju bayi newborn set"), "unisex");
  assert.equal(inferAudience("Newborn Romper Set"), "unisex");
  assert.equal(inferAudience("Balita Set"), "unisex");
  // A gender term still wins when it appears alongside baby wording.
  assert.equal(inferAudience("Baju bayi anak perempuan"), "girls");
  // Colour words must not be mistaken for an audience.
  assert.equal(inferAudience("Baby Blue Stripe Shirt"), "unisex");
  assert.equal(inferAudience("Baby Pink Tee"), "unisex");
  assert.equal(inferAudience("Boyfriend Jeans"), "unisex");
  assert.equal(inferAudience("Baby Romper"), "unisex");
});

// Audience is mandatory on the storefront: Girls/Boys routing depends on it and
// a blank value would hide the product from both collections. These guard the
// fallbacks used by the editor, the importer and the storefront reader.
test("audience normalisation never yields a blank value", () => {
  assert.equal(normaliseAudience(""), "unisex");
  assert.equal(normaliseAudience(null), "unisex");
  assert.equal(normaliseAudience(undefined), "unisex");
  assert.equal(normaliseAudience("unknown"), "unisex");
  assert.equal(normaliseAudience("  GIRLS "), "girls");
  assert.equal(normaliseAudience("Boys"), "boys");
  // Legacy "baby" metafields read back as unisex, matching the storefront.
  assert.equal(normaliseAudience("baby"), "unisex");
  assert.equal(parseAudience("baby"), "unisex");
  assert.equal(parseAudience(""), null);
  assert.equal(parseAudience("girls"), "girls");
  assert.equal(normaliseAudience("GIRLS"), "girls");
  // Text with no gender/baby hint still resolves to a usable value.
  assert.equal(inferAudience("Striped Daily Set for Kids"), "unisex");
  assert.equal(inferAudience(undefined, null, ""), "unisex");
});

// ── Tokopedia PDP structured extraction ─────────────────────────────────────
// Real PDPMainInfo payload for a listing with 10 colours × 13 sizes where the
// adult sizes and the "pure/white" colourway are priced DIFFERENTLY from the
// kids sizes. Regression guard for: one price for all variants, the 100-variant
// cap, and stock "1,2 jt" being parsed as 1.
const PDP_FIXTURE: unknown = JSON.parse(
  readFileSync(join(__dirname, "../lib/scrapers/__fixtures__/tokopedia-pdp.json"), "utf8"),
);
const pdp = extractPdpStructured([PDP_FIXTURE]);

test("PDP extraction keeps every real colour × size combination", () => {
  assert.ok(pdp);
  // 130 combinations minus 7 that the seller does not stock
  // (Ungu has no adult sizes; pure/white has no XXXL-ADULT).
  assert.equal(pdp!.variants.length, 123);
});

test("PDP extraction preserves the per-variant price tiers", () => {
  const prices = [...new Set(pdp!.variants.map((v) => v.price))].sort((a, b) => a! - b!);
  assert.deepEqual(prices, [32000, 56200, 60000, 92000]);
});

test("PDP adult sizes keep their own (higher) price and compare-at", () => {
  const adult = pdp!.variants.find((v) => v.options.Ukuran === "S-ADULT");
  assert.ok(adult);
  assert.equal(adult!.price, 92000);
  assert.equal(adult!.compareAtPrice, 230000);
});

test("PDP pure/white colourway keeps its distinct cheaper price", () => {
  const cheap = pdp!.variants.find(
    (v) => v.options.Warna === "pure/white" && v.options.Ukuran === "90",
  );
  assert.ok(cheap);
  assert.equal(cheap!.price, 32000);
  assert.equal(cheap!.compareAtPrice, 80000);
});

test("PDP extraction reads real per-variant stock (not the DOM '1,2 jt' bug)", () => {
  assert.ok(pdp!.variants.every((v) => (v.stock ?? 0) > 0));
  assert.ok(pdp!.variants.some((v) => (v.stock ?? 0) > 100));
  assert.equal(pdp!.totalStock, 9402);
});

test("PDP extraction exposes the size chart, colours and per-colour images", () => {
  assert.ok(pdp!.sizeChart?.includes("sizechart") || /^https?:/.test(pdp!.sizeChart || ""));
  assert.equal(pdp!.colors.length, 10);
  assert.equal(Object.keys(pdp!.colorImages).length, 10);
  assert.ok(Object.values(pdp!.colorImages).every((u) => /^https?:/.test(u)));
});

test("brand comes from the trailing 'di <shop> | Tokopedia' segment", () => {
  const og =
    "Promo (Bayar di Tempat) Kaos Musim Panas Unisex untuk Anak Laki-laki dan Perempuan, cocok untuk tinggi 90-150cm, usia 3-15 tahun. di 495 Lucu Anak | Tokopedia";
  assert.equal(brandFromOgTitle(og), "495 Lucu Anak");
});

// ── Size-label normalisation (Indonesian → English age) ─────────────────────
test("translateSizeLabel converts Indonesian size labels to English age", () => {
  assert.equal(translateSizeLabel("S (1-2 TAHUN)"), "S (1–2 yrs)");
  assert.equal(translateSizeLabel("M (2-3 tahun)"), "M (2–3 yrs)");
  assert.equal(translateSizeLabel("Xl (4-5 tahun)"), "XL (4–5 yrs)");
  assert.equal(translateSizeLabel("L 4-5 TAHUN"), "L (4–5 yrs)");
  assert.equal(translateSizeLabel("XXL 9-12 TAHUN"), "XXL (9–12 yrs)");
});

test("translateSizeLabel drops weight (BB … KG) and keeps the age", () => {
  assert.equal(translateSizeLabel("S (1-2 Thn BB 5-12 KG)"), "S (1–2 yrs)");
  assert.equal(translateSizeLabel("XX (9-12 Thn BB 27-35 KG)"), "XX (9–12 yrs)");
});

test("translateSizeLabel handles height codes, adult and English input", () => {
  assert.equal(translateSizeLabel("100"), "100 cm (3–4 yrs)");
  assert.equal(translateSizeLabel("90"), "90 cm (2–3 yrs)");
  assert.equal(translateSizeLabel("S-ADULT"), "S (Adult)");
  assert.equal(translateSizeLabel("1 Years"), "1 yr");
  assert.equal(translateSizeLabel("3-4 Years"), "3–4 yrs");
  assert.equal(translateSizeLabel("S (1-2 YO)"), "S (1–2 yrs)");
});

test("translateSizeLabel is idempotent on already-English labels", () => {
  const once = translateSizeLabel("S (1-2 TAHUN)");
  assert.equal(translateSizeLabel(once), once);
  assert.equal(translateSizeLabel("12-18M"), "12–18 months");
  // "cm" must survive a second pass (height labels stay stable).
  assert.equal(translateSizeLabel("100 cm (3–4 yrs)"), "100 cm (3–4 yrs)");
  assert.equal(translateSizeLabel(translateSizeLabel("100")), "100 cm (3–4 yrs)");
});

test("heightToAge maps AU height codes to age bands", () => {
  assert.equal(heightToAge(90), "2–3 yrs");
  assert.equal(heightToAge(100), "3–4 yrs");
  assert.equal(heightToAge(150), "8–9 yrs");
  assert.equal(heightToAge(155), "155 cm");
});

test("parseSizeMeta extracts age/weight/height from a raw label", () => {
  const p = parseSizeMeta("S (1-2 Thn BB 5-12 KG)");
  assert.equal(p.age, "1–2 yrs");
  assert.deepEqual(p.weightKg, { min: 5, max: 12 });
});

test("displaySize honours height + manual modes", () => {
  assert.equal(displaySize("S (1-2 TAHUN)", "age"), "S (1–2 yrs)");
  assert.equal(displaySize("100", "height"), "100 cm");
  assert.equal(displaySize("S (1-2 TAHUN)", "manual"), "S (1-2 TAHUN)");
});

test("normaliseSizeLabelMode defaults unknown values to age", () => {
  assert.equal(normaliseSizeLabelMode("height"), "height");
  assert.equal(normaliseSizeLabelMode(""), "age");
  assert.equal(normaliseSizeLabelMode("nonsense"), "age");
});

test("buildSizeGuideRows yields Size · Age · Weight for the storefront table", () => {
  const rows = buildSizeGuideRows(["S (1-2 Thn BB 5-12 KG)", "M (3-4 Thn BB 12-17 KG)"], "age");
  assert.equal(rows[0].size, "S");
  assert.equal(rows[0].age, "1–2 yrs");
  assert.equal(rows[0].weight, "5–12 kg");
});

test("sizeGuideLine handles Indonesian tokens and bare heights", () => {
  assert.equal(sizeGuideLine("S (1-2 TAHUN)"), "S (1-2 TAHUN) — 1–2 yrs");
  assert.equal(sizeGuideLine("L 4-5 TAHUN"), "L 4-5 TAHUN — 4–5 yrs");
  assert.equal(sizeGuideLine("100"), "100 — 3–4 yrs");
});

test("storefront size-label mirror matches the admin module", async () => {
  // Guard against drift: the storefront copy lives in data.js so it must
  // produce exactly the same output as the canonical TS module.
  const src = readFileSync(
    join(__dirname, "../../storefront/public/js/data.js"),
    "utf8",
  );
  const start = src.indexOf("const SIZE_LABEL_MODES");
  const end = src.indexOf("function optionValue(options, names)");
  assert.ok(start >= 0 && end > start, "storefront size-label block not found");
  const block = src.slice(start, end);
  const factory = new Function(
    block + "\nreturn { translateSizeLabel, displaySize };",
  ) as () => { translateSizeLabel: (s: string) => string; displaySize: (s: string, m?: string) => string };
  const mirror = factory();
  const samples = [
    "S (1-2 TAHUN)", "M (2-3 tahun)", "Xl (4-5 tahun)", "L 4-5 TAHUN",
    "S (1-2 Thn BB 5-12 KG)", "XX (9-12 Thn BB 27-35 KG)", "100", "110",
    "S-ADULT", "1 Years", "3-4 Years", "S (1-2 YO)", "12-18M", "2T",
  ];
  for (const s of samples) {
    assert.equal(mirror.translateSizeLabel(s), translateSizeLabel(s), `drift on "${s}"`);
  }
  assert.equal(mirror.displaySize("100", "height"), displaySize("100", "height"));
});

test("import mapper keeps lifecycle fields out of the update payload", () => {
  // badge / is_new / is_bestseller / added_at_rank describe a product's first
  // appearance. They must ride on lifecycleMetafields (create only) so a
  // re-import never resets an admin's badge or re-ranks the homepage.
  const input = buildShopifyPushInput({
    platform: "SHOPEE",
    sourceUrl: "https://shopee.test/item/1",
    title: "Ribbed Tee",
    price: 25,
    currency: "IDR",
    images: ["https://cdn.test/a.jpg"],
    variants: [{ price: 25, stock: 3, options: { Size: "S (1-2 TAHUN)" } }],
    specs: { category: "tshirts", audience: "unisex" },
    brand: "Anakmu",
  });

  const keys = input.metafields.map((m) => m.key);
  for (const key of ["badge", "is_new", "is_bestseller", "added_at_rank"]) {
    assert.ok(!keys.includes(key), `${key} must not be in update metafields`);
  }

  const lifecycle = input.lifecycleMetafields || [];
  const byKey = new Map(lifecycle.map((m) => [m.key, m]));
  assert.equal(byKey.get("is_new")?.value, "true");
  assert.equal(byKey.get("is_new")?.type, "boolean");
  assert.equal(byKey.get("is_bestseller")?.value, "false");
  assert.equal(byKey.get("is_bestseller")?.type, "boolean");
  assert.equal(byKey.get("badge")?.value, "new");
  assert.ok(Number(byKey.get("added_at_rank")?.value) > 0);
});

test("import mapper maps legacy baby category to the closest storefront type", () => {
  const input = buildShopifyPushInput({
    platform: "SHOPEE",
    sourceUrl: "https://shopee.test/item/2",
    title: "Baby Romper Set",
    price: 20,
    currency: "IDR",
    images: [],
    variants: [],
    specs: { category: "baby", audience: "unisex" },
    brand: "Anakmu",
  });
  assert.equal(input.productPayload.product_type, "tshirts");
});

test("import mapper never emits a baby product_type", () => {
  const input = buildShopifyPushInput({
    platform: "TOKPED",
    sourceUrl: "https://tokopedia.test/item/3",
    title: "Busy Book Bayi",
    price: 15,
    currency: "IDR",
    images: [],
    variants: [],
    specs: { category: "busy-book", audience: "unisex" },
    brand: "Bumi",
  });
  assert.equal(input.productPayload.product_type, "busy-book");
});

test("storefront age buckets place sizes into year ranges", () => {
  // Guards the storefront "Shop by Age" filter: the age bucketing lives in
  // data.js/products.js, so we run the real block against the shared parser.
  const src = readFileSync(
    join(__dirname, "../../storefront/public/js/products.js"),
    "utf8",
  );
  const start = src.indexOf("const AGE_BUCKETS");
  const end = src.indexOf("function renderAgeFilter");
  assert.ok(start >= 0 && end > start, "storefront age-filter block not found");
  const block = src.slice(start, end);
  const factory = new Function(
    "BumiData",
    block + "\nreturn { bbAgeBucketsFor, bbYearsFromAge };",
  ) as (bd: unknown) => {
    bbAgeBucketsFor: (p: { sizesRaw?: string[] }) => { key: string }[];
    bbYearsFromAge: (a: string) => [number, number] | null;
  };
  const api = factory({ parseSizeMeta });

  const keys = (sizesRaw: string[]) => api.bbAgeBucketsFor({ sizesRaw }).map((b) => b.key);
  assert.deepEqual(keys(["S (1-2 TAHUN)"]), ["1-2"]);
  assert.deepEqual(keys(["100"]), ["3-4"]); // bare height code → 3–4 yrs
  assert.deepEqual(keys(["12-18M"]), ["1-2"]); // months → years
  assert.deepEqual(keys(["2T"]), ["2-3"]);
  assert.deepEqual(keys(["6-7 TAHUN"]), ["6-8"]);
  assert.deepEqual(keys(["XL"]), []); // letter size carries no age
  assert.deepEqual(keys(["S-ADULT"]), []); // adult sizes are excluded
  // Single-year sizes are widened per size, so a product offering "1 yr" and
  // "2 yr" covers 1–3 yrs and shows under both the 1–2 and 2–3 buckets.
  assert.deepEqual(keys(["1 yr", "2 yr"]), ["1-2", "2-3"]);
  assert.deepEqual(api.bbYearsFromAge("10–12 yrs"), [10, 12]);
});

test("import mapper dedupes identical variant option combinations", () => {
  // Shopify rejects duplicate Color+Size combos with 422 "invalid variant".
  const input = buildShopifyPushInput({
    platform: "SHOPEE",
    sourceUrl: "https://shopee.test/item/dup",
    title: "Dup Tee",
    price: 20,
    currency: "IDR",
    images: [],
    variants: [
      { price: 20, stock: 3, options: { Size: "S (1-2 TAHUN)" } },
      { price: 20, stock: 5, options: { Size: "S (1-2 TAHUN)" } },
    ],
    specs: { category: "tshirts", audience: "unisex" },
    brand: "Anakmu",
  });
  assert.equal((input.productPayload.variants as any[]).length, 1);
});

test("import mapper collapses option-less variants to a single variant", () => {
  // More than one variant with no Color/Size option is invalid on Shopify.
  const input = buildShopifyPushInput({
    platform: "SHOPEE",
    sourceUrl: "https://shopee.test/item/noopt",
    title: "No Option Item",
    price: 20,
    currency: "IDR",
    images: [],
    variants: [
      { price: 20, stock: 1, options: {} },
      { price: 21, stock: 2, options: {} },
    ],
    specs: { category: "accessories", audience: "unisex" },
    brand: "Anakmu",
  });
  assert.equal((input.productPayload.variants as any[]).length, 1);
  assert.equal(input.productPayload.options, undefined);
});

test("PDP ignores a cosmetic colour when variants have no Color option", () => {
  // Real case: "Girl Cardigan 4.0 Mauve Purple" has Size-only variants (color
  // "") plus a bumi.colors metafield naming "mauve purple". Treating that as a
  // selectable colour made every size look Sold Out despite stock.
  const src = readFileSync(
    join(__dirname, "../../storefront/public/js/page-pdp.js"),
    "utf8",
  );
  const start = src.indexOf("const colorIsSelectable");
  const end = src.indexOf("function firstAvailableSize");
  assert.ok(start >= 0 && end > start, "PDP colour/availability block not found");
  const factory = new Function(
    "product",
    src.slice(start, end) + "\nreturn { colorIsSelectable, variantFor, sizeAvailable, colorAvailable };",
  ) as (p: unknown) => {
    colorIsSelectable: boolean;
    variantFor: (c: string, s: string) => { size: string } | null;
    sizeAvailable: (c: string, s: string) => boolean;
    colorAvailable: (c: string) => boolean;
  };

  const sizeOnly = factory({
    variants: [
      { color: "", size: "6–12 months", available: true },
      { color: "", size: "1 yr", available: true },
    ],
  });
  assert.equal(sizeOnly.colorIsSelectable, false);
  assert.equal(sizeOnly.variantFor("mauve purple", "1 yr")?.size, "1 yr");
  assert.equal(sizeOnly.sizeAvailable("mauve purple", "1 yr"), true);
  assert.equal(sizeOnly.colorAvailable("mauve purple"), true);

  // A real Color option still filters by colour.
  const withColor = factory({
    variants: [
      { color: "Mauve Purple", size: "1 yr", available: true },
      { color: "Army Green", size: "1 yr", available: false },
    ],
  });
  assert.equal(withColor.colorIsSelectable, true);
  assert.equal(withColor.sizeAvailable("Mauve Purple", "1 yr"), true);
  assert.equal(withColor.sizeAvailable("Army Green", "1 yr"), false);
});

test("cleanMetafields drops blank values for every type", () => {
  // A blank string is invalid for number/boolean/json fields, and one bad item
  // rejects the whole metafieldsSet batch — the bug that made "add stock" fail.
  const out = cleanMetafields([
    { namespace: "bumi", key: "material", value: "   ", type: "single_line_text_field" },
    { namespace: "bumi", key: "fibre", value: "", type: "single_line_text_field" },
    { namespace: "bumi", key: "rating", value: "", type: "number_decimal" },
    { namespace: "bumi", key: "sold_count", value: "", type: "number_integer" },
    { namespace: "bumi", key: "colors", value: "", type: "json" },
    { namespace: "bumi", key: "is_new", value: "true", type: "boolean" },
    { namespace: "bumi", key: "audience", value: "unisex", type: "single_line_text_field" },
    { namespace: "bumi", key: "sold_count", value: "0", type: "number_integer" },
  ]);
  assert.deepEqual(out.map((m) => m.key), ["is_new", "audience", "sold_count"]);
  assert.equal(out[2].value, "0"); // "0" is a valid value, not blank

  const one = cleanMetafields([
    { namespace: "bumi", key: "material", value: "a\nb", type: "single_line_text_field" },
  ]);
  assert.equal(one[0].value, "a · b"); // newlines joined for single_line
});

test("scrape guard throttles, caps hourly volume and opens a cooldown", () => {
  let now = 1_000_000;
  const guard = createScrapeGuard(
    { minIntervalMs: 30_000, maxPerHour: 2, cooldownMs: 60_000 },
    () => now,
  );

  // First request allowed, then recorded.
  assert.equal(guard.check("x.com").ok, true);
  guard.record("x.com");

  // Immediately after → interval block.
  const interval = guard.check("x.com");
  assert.equal(interval.ok, false);
  assert.equal(interval.reason, "interval");
  assert.ok(interval.retryAfterMs > 0 && interval.retryAfterMs <= 30_000);

  // After the interval → allowed, recorded (2nd of the hour).
  now += 30_000;
  assert.equal(guard.check("x.com").ok, true);
  guard.record("x.com");

  // Hourly cap (2/hour) reached.
  now += 30_000;
  const hourly = guard.check("x.com");
  assert.equal(hourly.ok, false);
  assert.equal(hourly.reason, "hourly");

  // A reset/abuse signal trips the cooldown breaker.
  guard.noteFailure("x.com", "read ECONNRESET");
  const cooldown = guard.check("x.com");
  assert.equal(cooldown.ok, false);
  assert.equal(cooldown.reason, "cooldown");
  assert.ok(cooldown.message && cooldown.message.length > 0);

  // Cooldown expires; the hourly cap is still the active limiter.
  now += 61_000;
  assert.equal(guard.check("x.com").reason, "hourly");

  // Another domain is unaffected by x.com's state.
  assert.equal(guard.check("y.com").ok, true);
});

test("scrape failure classification and host normalisation", () => {
  assert.equal(classifyScrapeFailure("read ECONNRESET"), "block");
  assert.equal(classifyScrapeFailure("Tokopedia memblokir permintaan (captcha/anti-bot)"), "block");
  assert.equal(classifyScrapeFailure("fetch failed"), "network");
  assert.equal(classifyScrapeFailure("The operation was aborted due to timeout"), "network");
  assert.equal(classifyScrapeFailure("Data produk tidak ditemukan"), "other");
  assert.equal(hostOf("https://WWW.Tokopedia.com/a/b?x=1"), "www.tokopedia.com");
  assert.equal(hostOf("https://tk.tokopedia.com/abc"), "www.tokopedia.com");
  assert.equal(hostOf("https://tokopedia.com/abc"), "www.tokopedia.com");
  assert.equal(hostOf("not a url"), "unknown");

  // Explicit failure kinds also open the breaker.
  let now = 0;
  const guard = createScrapeGuard(
    { minIntervalMs: 0, maxPerHour: 100, cooldownMs: 10_000 },
    () => now,
  );
  assert.equal(guard.noteFailureKind("z.com", "network"), "network");
  assert.equal(guard.check("z.com").reason, "cooldown");
});

function mkProduct(overrides: Record<string, unknown>): any {
  return {
    id: 1,
    handle: "h",
    title: "T",
    bodyHtml: "",
    vendor: "",
    productType: "",
    status: "active",
    tags: "",
    options: [],
    variants: [],
    images: [],
    metafields: {},
    manuallyEdited: false,
    ...overrides,
  };
}

test("generate fills colors, material, fibre and size guide from the product", () => {
  const product = mkProduct({
    bodyHtml: "<p>Material: 100% cotton. Care: machine wash cold.</p>",
    options: [
      { name: "Color", values: ["Mauve", "Navy"] },
      { name: "Size", values: ["1-2 TAHUN", "3-4 TAHUN"] },
    ],
    variants: [
      { option1: "Mauve", option2: "1-2 TAHUN", imageId: null, image: null },
      { option1: "Navy", option2: "3-4 TAHUN", imageId: null, image: null },
    ],
  });

  const colors = deriveColors(product);
  assert.equal(colors.length, 2);
  assert.ok(colors.every((c) => c.hex && /^#/.test(c.hex)));

  const patch = buildContentPatch(product, colors);
  assert.ok(patch.colors && patch.colors.length === 2);
  const stored = JSON.parse(patch.metafields.colors);
  assert.equal(stored.length, 2);
  assert.match(patch.metafields.material, /Material:/);
  assert.ok(patch.metafields.fibre);
  assert.ok(patch.metafields.size_guide);
  assert.equal(patch.metafields.size_label_mode, "age");
  assert.ok(patch.filled.some((f) => f.startsWith("warna")));
});

test("generate never overwrites existing metafields", () => {
  const product = mkProduct({
    bodyHtml: "<p>Material: 100% linen.</p>",
    options: [{ name: "Size", values: ["1-2 TAHUN"] }],
    variants: [{ option1: "1-2 TAHUN" }],
    metafields: {
      colors: '[{"name":"Black","hex":"#111111"}]',
      material: "Existing material",
      fibre: "Cotton",
      size_guide: "S — 1-2 yrs",
      size_label_mode: "height",
    },
  });
  const patch = buildContentPatch(product, []);
  assert.equal(patch.colors, null);
  assert.equal(patch.metafields.material, undefined);
  assert.equal(patch.metafields.fibre, undefined);
  assert.equal(patch.metafields.size_guide, undefined);
  assert.equal(patch.metafields.colors, undefined);
  assert.ok(patch.skipped.some((s) => /material sudah ada/.test(s)));
});

test("generate leaves material/size guide empty when there is no source", () => {
  const product = mkProduct({
    bodyHtml: "<p>Soft and comfy everyday piece.</p>",
    options: [{ name: "Size", values: ["S", "M", "L"] }],
    variants: [{ option1: "S" }, { option1: "M" }],
  });
  const patch = buildContentPatch(product, []);
  assert.equal(patch.metafields.material, undefined);
  assert.equal(patch.metafields.size_guide, undefined);
  assert.ok(patch.skipped.some((s) => /material: tidak ada info bahan/.test(s)));
  assert.ok(patch.skipped.some((s) => /size guide: ukuran tanpa info umur\/tinggi/.test(s)));
});

test("deriveColors returns nothing without a Color option", () => {
  const product = mkProduct({
    options: [{ name: "Size", values: ["1 yr"] }],
    variants: [{ option1: "1 yr" }],
  });
  assert.deepEqual(deriveColors(product), []);
});

console.log(`\n${passed} tests passed.`);