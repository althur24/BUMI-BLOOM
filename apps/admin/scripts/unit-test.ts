// Unit tests for the pure import helpers. Run: npx tsx apps/admin/scripts/unit-test.ts
import assert from "node:assert/strict";
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
import { colorsFromVariants, detectColorNames, hexForColorName } from "../lib/colors";
import { canonicalizeUrl } from "../lib/urls";

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
  assert.equal(inferCategory("Baby Romper"), "baby");
  assert.equal(inferAudience("Unisex kids longsleeved top"), "unisex");
  assert.equal(inferAudience("Dress untuk anak perempuan"), "girls");
});

console.log(`\n${passed} tests passed.`);
