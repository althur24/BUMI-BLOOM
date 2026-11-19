// Generate missing content for a Shopify product in ONE click.
//
// Fills ONLY empty fields, so it is idempotent and never overwrites an admin's
// work:
//   - bumi.colors          ← the product's Color variant option (+ variant images)
//   - bumi.material/fibre  ← the product description ("Material: …")
//   - bumi.size_guide      ← the Size variant option values (age/height/weight)
//   - bumi.size_label_mode ← "age" when unset
//
// buildContentPatch() and deriveColors() are pure (no network), so the decisions
// are unit-testable. products.ts is imported as a TYPE only; the write path is
// dynamically imported so importing this module never pulls Shopify transport.

import { hexForColorName } from "./colors";
import { extractMaterialFacts, buildSizeGuide } from "./categorize";
import {
  buildSizeGuideRows,
  normaliseSizeLabelMode,
  translateSizeLabel,
} from "./size-labels";
import type { AdminProductDetail, ProductColor, ProductPatch } from "./products";

export interface ContentPatch {
  metafields: Record<string, string>;
  colors: ProductColor[] | null; // null = leave colours untouched
  filled: string[]; // human notes for what was filled
  skipped: string[]; // human notes for what was left alone / had no source
}

function isBlank(value: string | undefined | null): boolean {
  return !String(value ?? "").trim();
}

// Plain text from a Shopify body_html description.
function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Option position (1-based) of the first option whose name matches.
function optionIndex(
  options: { name: string; values: string[] }[],
  re: RegExp,
): number {
  const idx = (options || []).findIndex((o) => re.test(String(o?.name || "")));
  return idx < 0 ? -1 : idx + 1;
}

// Colour values + their variant images, derived from the variants themselves.
export function deriveColors(product: AdminProductDetail): ProductColor[] {
  const colorPos = optionIndex(product.options, /^(colou?r|colour|warna)$/i);
  if (!colorPos) return [];

  const byName = new Map<string, ProductColor>();
  for (const v of product.variants || []) {
    const opts = v as unknown as Record<string, unknown>;
    const raw = String(opts[`option${colorPos}`] ?? "").trim();
    if (!raw || /^(default|default title)$/i.test(raw)) continue;
    const key = raw.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, {
        name: raw,
        hex: hexForColorName(raw),
        imageId: v.imageId ?? null,
        image: v.image ?? null,
      });
    }
  }
  return [...byName.values()];
}

// Decide what to fill. Everything here is pure: same input → same output.
export function buildContentPatch(
  product: AdminProductDetail,
  resolvedColors: ProductColor[],
): ContentPatch {
  const meta = product.metafields || {};
  const metafields: Record<string, string> = {};
  const filled: string[] = [];
  const skipped: string[] = [];

  // — Colours —
  let colors: ProductColor[] | null = null;
  if (!isBlank(meta.colors)) {
    skipped.push("warna sudah ada");
  } else if (!resolvedColors.length) {
    skipped.push("warna: produk tanpa opsi Color");
  } else {
    colors = resolvedColors;
    metafields.colors = JSON.stringify(resolvedColors);
    filled.push(`warna (${resolvedColors.length})`);
  }

  // — Material & fibre from the description —
  const facts = extractMaterialFacts(stripHtml(product.bodyHtml));
  if (!isBlank(meta.material)) {
    skipped.push("material sudah ada");
  } else if (facts.materialCare) {
    metafields.material = facts.materialCare;
    filled.push("material");
  } else {
    skipped.push("material: tidak ada info bahan di deskripsi");
  }
  if (!isBlank(meta.fibre)) {
    skipped.push("fibre sudah ada");
  } else if (facts.fibre) {
    metafields.fibre = facts.fibre;
    filled.push("fibre");
  } else {
    skipped.push("fibre: tidak terdeteksi di deskripsi");
  }

  // — Size guide from the Size option values —
  const sizePos = optionIndex(product.options, /^(size|ukuran)$/i);
  const sizeValues = (product.options || [])
    .filter((o) => /^(size|ukuran)$/i.test(String(o?.name || "")))
    .flatMap((o) => o.values || []);
  const mode = normaliseSizeLabelMode(meta.size_label_mode);

  if (!isBlank(meta.size_guide)) {
    skipped.push("size guide sudah ada");
  } else if (!sizePos || !sizeValues.length) {
    skipped.push("size guide: produk tanpa opsi Size");
  } else {
    // Translate to the storefront display label first so the guide matches what
    // shoppers see on the PDP ("S (1–2 yrs)" rather than "S (1-2 TAHUN)").
    const labels = sizeValues
      .map((raw) => (mode === "manual" ? raw : translateSizeLabel(raw)))
      .filter((s) => Boolean(String(s || "").trim()));
    const guide = buildSizeGuide(labels);
    if (guide) {
      metafields.size_guide = guide;
      filled.push("size guide");
    } else {
      // No age/height/weight info (e.g. pure S/M/L) — leave it empty rather
      // than inventing measurements.
      const rows = buildSizeGuideRows(sizeValues, mode);
      const hasExtra = rows.some((r) => r.age || r.height || r.weight);
      skipped.push(
        hasExtra ? "size guide: tidak bisa dibentuk" : "size guide: ukuran tanpa info umur/tinggi",
      );
    }
  }

  // — Size label mode (drives how the storefront renders sizes) —
  if (isBlank(meta.size_label_mode)) {
    metafields.size_label_mode = mode;
    filled.push(`mode label: ${mode}`);
  }

  return { metafields, colors, filled, skipped };
}

export interface GenerateResult {
  handle: string;
  filled: string[];
  skipped: string[];
  colors: number;
  updated: string[];
  warnings: string[];
  message: string;
}

// Decide what is missing for this product and write it back in one update.
export async function generateProductContent(
  handle: string,
  product: AdminProductDetail,
): Promise<GenerateResult> {
  const patch = buildContentPatch(product, deriveColors(product));
  const hasMetafields = Object.keys(patch.metafields).length > 0;

  if (!hasMetafields && !patch.colors) {
    return {
      handle,
      filled: [],
      skipped: patch.skipped,
      colors: 0,
      updated: [],
      warnings: [],
      message: "Semua sudah terisi — tidak ada yang perlu dibuat.",
    };
  }

  // Dynamic import keeps this module free of the Shopify transport for tests.
  const { updateProduct } = await import("./products");
  const patchBody: ProductPatch = {};
  if (patch.colors) {
    patchBody.colors = patch.colors;
    patchBody.noColor = false;
  }
  if (hasMetafields) {
    patchBody.metafields = patch.metafields as ProductPatch["metafields"];
  }
  const result = await updateProduct(handle, patchBody);

  return {
    handle,
    filled: patch.filled,
    skipped: patch.skipped,
    colors: patch.colors ? patch.colors.length : 0,
    updated: result.updated,
    warnings: result.warnings,
    message: patch.filled.length
      ? `Diisi: ${patch.filled.join(", ")}.`
      : "Tidak ada yang bisa diisi otomatis.",
  };
}
