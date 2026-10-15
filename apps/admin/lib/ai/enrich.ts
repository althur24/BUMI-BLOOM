// Product enrichment. Two layers:
//   1. Rule-based cleaning (always runs): strip marketplace noise from titles,
//      decode/clean HTML descriptions.
//   2. AI layer (env-gated): if GEMINI_API_KEY is set, translate ID→EN, write a
//      clean SEO description, and suggest a product category via Google Gemini
//      (free tier). Failures fall back to rule-based output silently.
//
// Pluggable: swap the provider in `aiEnrich` without touching the queue/routes.

import type { NormalizedProduct } from "../scrapers/base";

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
  const prompt = `You clean and translate marketplace product data for a kids' fashion store (BUMI/BLOOM, English storefront). Return STRICT JSON only.

Product data:
Title: ${np.title}
Brand: ${np.brand || ""}
Description: ${(np.description || "").slice(0, 1000)}
Sizes: ${np.variants.map(v => Object.values(v.options).join(", ")).join(" | ")}

Return JSON: {"title_en": concise clean English title (no fluff), "description_en": clean English SEO description (1-2 sentences, no marketing spam), "category": one of ["TSHIRTS","SHORTS","DRESSES","OUTERWEAR","ACCESSORIES","BABY"] or "", "material_care": "Material: ... Care: ... (infer from description, standard kids clothing care)", "size_guide": "Size chart with height/weight measurements per size", "shipping_returns": "Short shipping + returns policy text", "colors_en": {"Hitam":"Black","Merah":"Red"} (translate ALL color names found in variant data to English — only include colors that appear, empty object {} if no colors), "audience": one of ["girls","boys","baby","unisex"] (infer from title/description — e.g. "anak perempuan"=girls, "anak laki-laki"=boys, "bayi"=baby), "fibre": "short material tag (e.g. 100% Cotton, 95% Cotton 5% Elastane — extract from description, empty string if unknown)"}`;

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
          maxOutputTokens: 1000,
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
    product.specs = { ...(product.specs || {}), category: String(parsed.category) };
  }
  if (parsed.material_care) product.materialCare = String(parsed.material_care);
  if (parsed.size_guide) product.sizeGuide = String(parsed.size_guide);
  if (parsed.shipping_returns) product.shippingReturns = String(parsed.shipping_returns);
  if (parsed.fibre) product.fibre = String(parsed.fibre);
  if (parsed.audience) {
    product.specs = { ...(product.specs || {}), audience: String(parsed.audience).toLowerCase() };
  }
  if (parsed.colors_en && typeof parsed.colors_en === 'object') {
    const colorMap = parsed.colors_en as Record<string, string>;
    product.variants = product.variants.map(v => {
      const newOptions: Record<string, string> = {};
      for (const [key, val] of Object.entries(v.options)) {
        newOptions[key] = colorMap[val] || val;
      }
      return { ...v, options: newOptions };
    });
  }
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
