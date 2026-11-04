// Rule-based product categorisation for the storefront taxonomy
// (busy-book | tshirts | shorts | dresses | outerwear | accessories | baby)
// and audience (girls | boys | baby | unisex). AI enrichment can refine
// these, but imports must be usable when GEMINI_API_KEY is not configured.

export type StoreCategory =
  | "busy-book"
  | "tshirts"
  | "shorts"
  | "dresses"
  | "outerwear"
  | "accessories"
  | "baby"
  | "";

const CATEGORY_RULES: { category: Exclude<StoreCategory, "">; re: RegExp }[] = [
  // Busy books are toys, not clothing — and their titles almost always also
  // mention ages/babies ("...usia 0 bulan... bayi"), so this rule must run
  // before the baby rule or every busy book would be miscategorised as baby.
  {
    category: "busy-book",
    re: /\b(busy ?books?|quiet ?books?|activity ?books?|soft ?books?|cloth ?books?|fabric ?books?|felt ?books?|contrast ?books?|buku (?:mainan|maianan|edukasi|aktivitas|activity)|softbook)\b/i,
  },
  {
    category: "baby",
    re: /\b(baby|bayi|newborn|infant|romper|bodysuit|sleepsuit|onesie|0-?24\s*m)\b/i,
  },
  {
    category: "outerwear",
    re: /\b(jacket|jaket|coat|blazer|hoodie|cardigan|windbreaker|parka|bomber|vest|sweater|jumper|outer)\b/i,
  },
  {
    category: "dresses",
    re: /\b(dress|gaun|jumpsuit|romper dress|overall dress)\b/i,
  },
  {
    category: "shorts",
    re: /\b(shorts|celana|pants|trousers|jogger|skirt|rok|legging|overalls?)\b/i,
  },
  {
    category: "accessories",
    re: /\b(hat|cap|topi|socks|kaos kaki|bag|tas|shoes|sepatu|sandal|belt|aksesoris|accessory)\b/i,
  },
  {
    category: "tshirts",
    re: /\b(shirt|tee|t-shirt|tshirt|top|atasan|kaos|blouse|polo|longsleeve|long sleeve|short sleeve)\b/i,
  },
];

export function inferCategory(...texts: (string | undefined | null)[]): StoreCategory {
  const title = String(texts[0] || "");
  const full = texts.filter(Boolean).join(" ");
  if (!full) return "";
  // The title is more reliable than the description ("Collared Sweater" in a
  // shirt description must not override "Shirt" in the title).
  for (const rule of CATEGORY_RULES) {
    if (title && rule.re.test(title)) return rule.category;
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(full)) return rule.category;
  }
  return "";
}

export function inferAudience(
  ...texts: (string | undefined | null)[]
): "girls" | "boys" | "baby" | "unisex" {
  const text = texts.filter(Boolean).join(" ");
  if (/\bunisex\b/i.test(text)) return "unisex";
  if (/\b(baby|bayi|newborn|infant)\b/i.test(text)) return "baby";
  if (/\b(girl|girls|perempuan|anak perempuan)\b/i.test(text)) return "girls";
  if (/\b(boy|boys|laki-?laki|anak laki)\b/i.test(text)) return "boys";
  return "unisex";
}

// Extract material/fibre hints from a description without inventing facts.
export function extractMaterialFacts(description?: string): {
  materialCare?: string;
  fibre?: string;
} {
  const text = String(description || "");
  if (!text) return {};
  const lines: string[] = [];

  const material = text.match(/MATERIAL\s*:\s*([^\n\r]+)/i);
  if (material) lines.push(`Material: ${material[1].trim()}`);
  if (!lines.length) {
    const bahan = text.match(/(?:menggunakan\s+)?material\s+([^.,\n\r]{3,80})/i);
    if (bahan) lines.push(`Material: ${bahan[1].trim()}`);
  }
  const features = text.match(/FEATURES\s*:\s*([^\n\r]+)/i);
  if (features) lines.push(features[1].trim().slice(0, 300));

  const fibreMatch =
    text.match(/\b(\d{1,3}%\s*)?(cotton|polyester|linen|wool|viscose|rayon|elastane|spandex|nylon|silk)\b/i) ||
    text.match(/\b(cotton|polyester|linen|wool|viscose|rayon|elastane|spandex|nylon|silk)\b/i);
  const fibre = fibreMatch
    ? `${fibreMatch[1] ? fibreMatch[1].trim() + " " : ""}${fibreMatch[2][0].toUpperCase()}${fibreMatch[2].slice(1).toLowerCase()}`
    : undefined;

  return {
    materialCare: lines.length ? lines.join("\n") : undefined,
    fibre,
  };
}

// "S (1-2 YO)" → "1–2 yrs"; "12-18M" → "12–18 months"; "2T" → "2–3 yrs".
export function sizeGuideLine(label: string): string | null {
  const s = String(label || "").trim();
  if (!s) return null;
  const years = s.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:Y|YO|YRS?|YEARS?|TAHUN)/i);
  if (years) return `${s} — ${years[1]}–${years[2]} yrs`;
  const singleYear = s.match(/(\d+)\s*(?:Y|YO|YRS?|YEARS?|TAHUN)/i);
  if (singleYear) return `${s} — ${singleYear[1]} yrs`;
  const months = s.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:M(?:O|ONTHS?)?|BLN|BULAN)\b/i);
  if (months) return `${s} — ${months[1]}–${months[2]} months`;
  const toddler = s.match(/^(\d+)T$/i);
  if (toddler) return `${s} — ${toddler[1]}–${Number(toddler[1]) + 1} yrs`;
  const cm = s.match(/(\d+)\s*cm/i);
  if (cm) return `${s} — ${cm[1]} cm`;
  return null;
}

export function buildSizeGuide(
  sizeLabels: string[],
  opts: { sizeChartImage?: string; extraText?: string } = {},
): string | undefined {
  const lines = sizeLabels
    .map((label) => sizeGuideLine(label))
    .filter((line): line is string => Boolean(line));
  const extra = String(opts.extraText || "").trim();
  if (extra) lines.push(extra);
  if (opts.sizeChartImage) lines.push(`Size chart: ${opts.sizeChartImage}`);
  return lines.length ? lines.join("\n") : undefined;
}
