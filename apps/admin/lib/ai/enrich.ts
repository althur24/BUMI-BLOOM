// Product enrichment. Two layers:
//   1. Rule-based cleaning (always runs): strip marketplace noise from titles,
//      decode/clean HTML descriptions.
//   2. AI layer (env-gated): if GEMINI_API_KEY is set, translate ID→EN, write a
//      clean SEO description, and suggest a product category via Google Gemini
//      (free tier). Failures fall back to rule-based output silently.
//
// Pluggable: swap the provider in `aiEnrich` without touching the queue/routes.

import type { NormalizedProduct } from "../scrapers/base";
import {
  colorOptionOf,
  colorsFromVariants,
  normalizeColorName,
  normalizeHex,
  sizeOptionOf,
} from "../colors";

export interface EnrichResult {
  enriched: NormalizedProduct;
  aiUsed: boolean;
  aiMeta?: { provider?: string; error?: string; original?: { title?: string; description?: string } };
}

export async function enrichProduct(
  np: NormalizedProduct,
): Promise<EnrichResult> {
  const cleaned = ruleBased(np);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { enriched: cleaned, aiUsed: false };

  try {
    const ai = await geminiEnrich(cleaned, key);
    return {
      enriched: ai.product,
      aiUsed: true,
      aiMeta: {
        provider: "gemini",
        original: { title: np.title, description: np.description },
      },
    };
  } catch (e) {
    return {
      enriched: cleaned,
      aiUsed: false,
      aiMeta: { provider: "gemini", error: errMsg(e) },
    };
  }
}

// ── Rule-based cleaning ─────────────────────────────────────────────────────
function ruleBased(np: NormalizedProduct): NormalizedProduct {
  return {
    ...np,
    title: cleanTitle(np.title),
    description: cleanDescription(np.description),
  };
}

function cleanTitle(t: string): string {
  let s = String(t || "");
  s = s.replace(/[\[(<{].*?[\])>}]/g, " ");
  s = s.replace(
    /\b(ready stock|ready|stok ready|garansi|gratis ongkir|free shipping|cod|cash on delivery|termurah|promo|diskon|sale|hot sale|best seller|bpjs|original 100%)\b/gi,
    " ",
  );
  s = s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || t;
}

function cleanDescription(d?: string): string {
  if (!d) return "";
  let s = String(d);
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 2000);
}

// ── Gemini enrichment (fetch-based, no SDK dep) ─────────────────────────────
async function geminiEnrich(
  np: NormalizedProduct,
  key: string,
): Promise<{ product: NormalizedProduct; raw: unknown }> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const sizeValues = [
    ...new Set(
      np.variants
        .map((v) => sizeOptionOf(v.options)?.value)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const colorValues = [
    ...new Set(
      np.variants
        .map((v) => colorOptionOf(v.options)?.value)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const prompt = `You clean and translate marketplace product data for a kids' fashion store (BUMI/BLOOM, English storefront). Return STRICT JSON only.

Product data:
Title: ${np.title}
Brand: ${np.brand || ""}
Description: ${(np.description || "").slice(0, 2000)}
Sizes: ${sizeValues.join(", ") || "-"}
Colors: ${colorValues.join(", ") || "-"}

Return JSON: {"title_en": clean English title (keep the colourway, no marketing fluff), "description_en": detailed English product description (translate, keep ALL real details from the source: design, material, features, fit, size notes; use short paragraphs or dash bullets separated by newlines; 3-8 sentences; never invent facts), "category": one of ["BUSY-BOOK","TSHIRTS","SHORTS","DRESSES","OUTERWEAR","ACCESSORIES","BABY"] or "" (use "BUSY-BOOK" for busy/quiet/soft/activity/cloth books — even if the title mentions babies or ages), "material_care": "Material: ... Care: ... (use the material stated in the source; care instructions may be standard kids clothing care)", "size_guide": "ONLY format the size/age/height data that is present in the source (one line per size, e.g. 'S — 1–2 yrs'). NEVER invent measurements. Use an empty string if no size data exists.", "colors": [{"original":"Hitam","name":"Black","hex":"#111111"}] (translate EVERY color name found in the variant data or title to English and infer a representative 6-digit CSS hex for it. Only colors, never sizes. Use [] if no colors), "audience": one of ["girls","boys","baby","unisex"] (infer from title/description — e.g. "anak perempuan"=girls, "anak laki-laki"=boys, "bayi"=baby), "fibre": "short material tag from the source (e.g. 100% Cotton, Ribbed cotton), empty string if unknown"}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.3,
          maxOutputTokens: 2400,
          // Gemini 2.5 Flash is a "thinking" model — disable thinking so the
          // token budget goes to the JSON output (otherwise it gets truncated).
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json: any = await res.json();
  const content =
    json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = JSON.parse(content);

  const product: NormalizedProduct = { ...np };
  if (parsed.title_en) product.title = String(parsed.title_en);
  if (parsed.description_en) product.description = String(parsed.description_en);
  if (parsed.category) {
    // Lowercase so the value matches the admin dropdown options and the
    // normaliseCategory allow-list ("BUSY-BOOK" → "busy-book").
    product.specs = { ...(product.specs || {}), category: String(parsed.category).toLowerCase() };
  }
  if (parsed.material_care) product.materialCare = String(parsed.material_care);
  if (parsed.size_guide) {
    const guide = String(parsed.size_guide).trim();
    // Guard against invented charts: accept only if it references at least one
    // real size label from the source.
    const mentionsRealSize =
      !sizeValues.length ||
      sizeValues.some((size) => guide.toLowerCase().includes(size.toLowerCase()));
    if (guide && mentionsRealSize) product.sizeGuide = guide;
  }
  if (parsed.fibre) product.fibre = String(parsed.fibre);
  if (parsed.audience) {
    product.specs = { ...(product.specs || {}), audience: String(parsed.audience).toLowerCase() };
  }
  // Colors: translate names to English AND infer a hex per color. The hex is
  // essential — Tokopedia often ships color names (OCEAN, MAHESA, …) with an
  // empty hex, which previously dropped the whole bumi.colors metafield.
  const aiColorHex = new Map<string, string>();
  const originalToEnglish = new Map<string, string>();
  if (Array.isArray(parsed.colors)) {
    for (const entry of parsed.colors) {
      if (!entry || typeof entry !== "object") continue;
      const original = String((entry as any).original || "").trim();
      const name = String((entry as any).name || original).trim();
      if (!name) continue;
      if (original) originalToEnglish.set(normalizeColorName(original), name);
      const rawHex = String((entry as any).hex || "").trim();
      const hex = rawHex
        ? normalizeHex(rawHex.startsWith("#") ? rawHex : `#${rawHex}`)
        : null;
      if (hex) aiColorHex.set(normalizeColorName(name), hex);
    }
  }
  if (originalToEnglish.size) {
    product.variants = product.variants.map((v) => {
      const color = colorOptionOf(v.options);
      if (!color) return v;
      const translated = originalToEnglish.get(normalizeColorName(color.value));
      return translated
        ? { ...v, options: { ...v.options, [color.key]: translated } }
        : v;
    });
  }

  // Derive the final palette from the (possibly translated) variants, using the
  // AI hex when available and the deterministic dictionary as last resort.
  // Variants are the source of truth: colors without a variant are dropped so
  // every swatch on the storefront maps to something that can be bought.
  const explicitColors = [
    ...Array.from(aiColorHex, ([name, hex]) => ({ name, hex })),
    ...(np.colors || []),
  ];
  product.colors = colorsFromVariants(product.variants, explicitColors);

  return { product, raw: parsed };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// AI-powered vendor matching via Gemini. Given a scraped brand + existing
// Shopify vendors, returns the exact matching vendor name or null (no match / new).
export async function aiMatchVendor(
  brand: string,
  existingVendors: string[],
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || existingVendors.length === 0) return null;
  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const prompt = `Match the scraped brand "${brand}" to one of these existing Shopify vendors (case-insensitive, fuzzy match — account for missing spaces, punctuation, suffixes like "official"):

${existingVendors.map((v) => "- " + v).join("\n")}

Return JSON: {"vendor": "<exact vendor name from the list>" or "NEW"}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0,
            maxOutputTokens: 100,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    const content =
      json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(content);
    const match = parsed.vendor;
    if (match && match !== "NEW" && existingVendors.includes(match)) {
      return match;
    }
    return null;
  } catch {
    return null;
  }
}
