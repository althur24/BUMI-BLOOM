// Product enrichment. Two layers:
//   1. Rule-based cleaning (always runs): strip marketplace noise from titles,
//      decode/clean HTML descriptions.
//   2. AI layer (env-gated): if OPENAI_API_KEY is set, translate ID→EN, write a
//      clean SEO description, and suggest a product category. Failures fall back
//      to rule-based output silently.
//
// Pluggable: swap the provider in `aiEnrich` (Gemini/etc.) without touching the
// queue or routes.

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
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { enriched: cleaned, aiUsed: false };

  try {
    const ai = await openAIEnrich(cleaned, key);
    return {
      enriched: ai.product,
      aiUsed: true,
      aiMeta: {
        provider: "openai",
        original: { title: np.title, description: np.description },
      },
    };
  } catch (e) {
    return {
      enriched: cleaned,
      aiUsed: false,
      aiMeta: { provider: "openai", error: errMsg(e) },
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
  // Drop bracketed noise: [COD], (Ready Stock), {Promo}
  s = s.replace(/[\[(<{].*?[\])>}]/g, " ");
  // Drop common marketplace fluff phrases
  s = s.replace(
    /\b(ready stock|ready|stok ready|garansi|gratis ongkir|free shipping|cod|cash on delivery|termurah|promo|diskon|sale|hot sale|best seller|bpjs|original 100%)\b/gi,
    " ",
  );
  // Strip emoji & pictographs
  s = s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || t;
}

function cleanDescription(d?: string): string {
  if (!d) return "";
  let s = String(d);
  s = s.replace(/<[^>]+>/g, " "); // strip HTML
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

// ── OpenAI enrichment (fetch-based, no SDK dep) ─────────────────────────────
async function openAIEnrich(
  np: NormalizedProduct,
  key: string,
): Promise<{ product: NormalizedProduct; raw: unknown }> {
  const messages = [
    {
      role: "system",
      content:
        "You clean and translate marketplace product data for a kids' fashion store (BUMI/BLOOM, English storefront). Return STRICT JSON only.",
    },
    {
      role: "user",
      content: `Product data:
Title: ${np.title}
Brand: ${np.brand || ""}
Description: ${(np.description || "").slice(0, 1000)}

Return JSON: {"title_en": concise clean English title (no fluff), "description_en": clean English SEO description (1-2 sentences, no marketing spam), "category": one of ["TSHIRTS","SHORTS","DRESSES","OUTERWEAR","ACCESSORIES","BABY"] or ""}`,
    },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 400,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json: any = await res.json();
  const content = json.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);

  const product: NormalizedProduct = { ...np };
  if (parsed.title_en) product.title = String(parsed.title_en);
  if (parsed.description_en) product.description = String(parsed.description_en);
  if (parsed.category) {
    product.specs = { ...(product.specs || {}), category: String(parsed.category) };
  }
  return { product, raw: parsed };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
