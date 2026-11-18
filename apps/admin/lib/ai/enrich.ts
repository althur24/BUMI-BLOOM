// Product enrichment. Two layers:
//   1. Rule-based cleaning (always runs): strip marketplace noise from titles,
//      decode/clean HTML descriptions.
//   2. AI layer (env-gated): if GEMINI_API_KEY is set, translate ID→EN, write a
//      clean SEO description, and suggest a product category via Google Gemini
//      (free tier). Failures fall back to rule-based output silently.
//
// Pluggable: swap the provider in `aiEnrich` without touching the queue/routes.

import type { NormalizedProduct } from "../scrapers/base";
import { normaliseAudience } from "../audience";
import {
  colorOptionOf,
  colorsFromVariants,
  normalizeColorName,
  normalizeHex,
  sizeOptionOf,
} from "../colors";
import { normaliseSizeLabelMode, translateSizeLabel } from "../size-labels";

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

Return JSON: {"title_en": clean English title (keep the colourway, no marketing fluff), "description_en": detailed English product description (translate, keep ALL real details from the source: design, material, features, fit, size notes; use short paragraphs or dash bullets separated by newlines; 3-8 sentences; never invent facts), "category": one of ["BUSY-BOOK","TSHIRTS","SHORTS","DRESSES","OUTERWEAR","ACCESSORIES"] or "" (use "BUSY-BOOK" for busy/quiet/soft/activity/cloth books — even if the title mentions babies or ages; baby/infant garments are NOT a category, assign them to the closest real one, e.g. a baby romper is TSHIRTS), "material_care": "Material: ... Care: ... (use the material stated in the source; care instructions may be standard kids clothing care)", "size_guide": "ONLY format the size/age/height data that is present in the source (one line per size, e.g. 'S — 1–2 yrs'). NEVER invent measurements. Use an empty string if no size data exists.", "sizes": [{"original":"S (1-2 TAHUN)","name":"S (1–2 yrs)"}] (translate EVERY size/ukuran option value to an English age label in the form 'S (1–2 yrs)' / 'M (3–4 yrs)'; if the source only has a numeric height like '100', convert to an approximate age '100 cm (3–4 yrs)'; translate words tahun/tahun/thn→yrs, bulan/bln→months; if a label is already English return it unchanged; use [] if no sizes), "size_label_mode": one of ["age","height","manual"] (choose "age" when size labels carry ages, "height" when they are numeric heights only, otherwise "age"), "colors": [{"original":"Hitam","name":"Black","hex":"#111111"}] (translate EVERY color name found in the variant data or title to English and infer a representative 6-digit CSS hex for it. Only colors, never sizes. Use [] if no colors), "audience": one of ["girls","boys","unisex"] (infer from title/description — e.g. "anak perempuan"=girls, "anak laki-laki"=boys; use "unisex" when the item is for babies or the audience is unclear, there is no Baby category), "fibre": "short material tag from the source (e.g. 100% Cotton, Ribbed cotton), empty string if unknown"}`;

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

  // ── Size labels + display mode ──────────────────────────────────────────
  // Translate size option values to English age labels so Shopify stores clean
  // values. Trust the AI mapping but validate it (must still contain a size
  // token from the source), and fall back to the deterministic translator so a
  // missing/failed AI response never leaves Indonesian on the product.
  const aiSizeMap = new Map<string, string>();
  if (Array.isArray((parsed as any).sizes)) {
    for (const entry of (parsed as any).sizes) {
      if (!entry || typeof entry !== "object") continue;
      const original = String(entry.original || "").trim();
      const name = String(entry.name || "").trim();
      if (original && name) aiSizeMap.set(original, name);
    }
  }
  if (np.variants?.length) {
    const used = new Set<string>();
    product.variants = np.variants.map((v) => {
      const sizeOpt = sizeOptionOf(v.options);
      if (!sizeOpt || !sizeOpt.value) return v;
      const raw = sizeOpt.value;
      let label = aiSizeMap.get(raw) || translateSizeLabel(raw);
      if (!label) label = raw;
      // Never let two different raw sizes collapse to one Shopify option value.
      if (used.has(label) && label !== raw) label = `${label} · ${raw}`;
      used.add(label);
      return label === raw
        ? v
        : { ...v, options: { ...v.options, [sizeOpt.key]: label } };
    });
  }
  product.sizeLabelMode = normaliseSizeLabelMode((parsed as any).size_label_mode);

  if (parsed.audience) {
    // The model may still answer "baby" on an older prompt; normalise so only
    // the three real audiences ever reach Shopify.
    product.specs = { ...(product.specs || {}), audience: normaliseAudience(parsed.audience) };
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
    const usedEnglish = new Set<string>();
    const finalName = new Map<string, string>();
    // Translate one source colour to its English name. Returns undefined when
    // the source colour isn't in the AI output, or when its translation would
    // collapse two different source colours into one (e.g. "Putih" and
    // "pure/white" both → "White") — that would duplicate variants and lose a
    // distinct, differently-priced SKU, so the source name is kept.
    const translate = (original: string): string | undefined => {
      const key = normalizeColorName(original);
      if (finalName.has(key)) return finalName.get(key);
      const candidate = originalToEnglish.get(key);
      if (!candidate) return undefined;
      const translatedKey = normalizeColorName(candidate);
      if (translatedKey !== key && usedEnglish.has(translatedKey)) return undefined;
      usedEnglish.add(translatedKey);
      finalName.set(key, candidate);
      return candidate;
    };

    product.variants = product.variants.map((v) => {
      const color = colorOptionOf(v.options);
      if (!color) return v;
      const translated = translate(color.value);
      return translated
        ? { ...v, options: { ...v.options, [color.key]: translated } }
        : v;
    });

    // The per-colourway images are keyed by the SOURCE colour name. Rename them
    // with the same translation so they still match the (English) Color option
    // values when the push attaches variant images.
    if (product.colorImages) {
      const remapped: Record<string, string> = {};
      for (const [name, src] of Object.entries(product.colorImages)) {
        const final = translate(name) || name;
        if (!remapped[final]) remapped[final] = src;
      }
      product.colorImages = remapped;
    }
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
    const prompt = `A scraped marketplace shop name needs to be mapped to an existing Shopify vendor list.

Scraped brand: "${brand}"
Existing vendors:
${existingVendors.map((v) => "- " + v).join("\n")}

Rules:
- Only return a vendor from the list if it is CLEARLY the same brand (same name, ignoring case, spaces, punctuation, or suffixes like "official"/"shop").
- If the scraped brand is a DIFFERENT company/store, return "NEW" — do NOT force a match.
- When in doubt, return "NEW".

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
