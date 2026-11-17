// Size-label normalisation for the storefront (BUMI/BLOOM, AU market).
//
// Marketplace imports (Tokopedia, Shopee, brand sites) ship size option
// values in Indonesian ("S (1-2 TAHUN)", "S (1-2 Thn BB 5-12 KG)") or as
// bare height codes ("100", "110"). The storefront is English/metric, so we
// translate them to age labels ("S (1–2 yrs)") and keep weight/height data for
// the Size Guide table.
//
// This module is the SINGLE SOURCE OF TRUTH. It is imported directly by the
// admin (import pipeline, product editor, migration) and its pure functions are
// mirrored verbatim into apps/storefront/public/js/data.js so the storefront
// renders identical labels. Keep the two in sync.

export type SizeLabelMode = "age" | "height" | "manual";

export const SIZE_LABEL_MODES: SizeLabelMode[] = ["age", "height", "manual"];

export function normaliseSizeLabelMode(value: unknown): SizeLabelMode {
  const v = String(value == null ? "" : value).trim().toLowerCase();
  return (SIZE_LABEL_MODES as string[]).includes(v) ? (v as SizeLabelMode) : "age";
}

// European/AU kids' clothing height → approximate age band. Values follow the
// conventions used by Childrensalon and Seed Heritage (metric, AU-facing).
const HEIGHT_AGE_BANDS: { min: number; max: number; age: string }[] = [
  { min: 80, max: 86, age: "1–2 yrs" },
  { min: 87, max: 92, age: "2–3 yrs" },
  { min: 93, max: 98, age: "2–3 yrs" },
  { min: 99, max: 104, age: "3–4 yrs" },
  { min: 105, max: 110, age: "4–5 yrs" },
  { min: 111, max: 116, age: "5–6 yrs" },
  { min: 117, max: 122, age: "6–7 yrs" },
  { min: 123, max: 128, age: "7–8 yrs" },
  { min: 129, max: 134, age: "8–9 yrs" },
  { min: 135, max: 140, age: "9–10 yrs" },
  { min: 141, max: 146, age: "10–11 yrs" },
  { min: 147, max: 152, age: "11–12 yrs" },
];

// Exact height codes commonly used by Indonesian kids' apparel (90, 100, …).
const HEIGHT_EXACT_AGE: Record<string, string> = {
  "90": "2–3 yrs",
  "100": "3–4 yrs",
  "110": "4–5 yrs",
  "120": "5–6 yrs",
  "130": "6–7 yrs",
  "140": "7–8 yrs",
  "150": "8–9 yrs",
  "160": "9–10 yrs",
};

// Approved label prefixes so casing is consistent ("Xl" → "XL"). Anything not
// listed is left untouched.
const KNOWN_PREFIXES = [
  "XXXXL",
  "XXXL",
  "XXL",
  "XL",
  "XS",
  "XXS",
  "XXXS",
  "L",
  "M",
  "S",
];

function normaliseDash(s: string): string {
  // en/em dash and the unicode minus → simple hyphen first, then collapse
  // numeric ranges to an en dash for a consistent look ("1-2" → "1–2").
  return s
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
}

function upperSizePrefix(s: string): string {
  // Only touches a leading alphabetic size token, e.g. "Xl (4-5 tahun)" → "XL (...)"
  const m = s.match(/^([A-Za-z]{1,4})(\b|\s|\()/);
  if (!m) return s;
  const up = m[1].toUpperCase();
  if (!KNOWN_PREFIXES.includes(up)) return s;
  return up + s.slice(m[1].length);
}

export interface ParsedSize {
  // Cleaned label appropriate for a button/table cell after translation.
  label: string;
  age?: string; // "3–4 yrs" | "12–18 months"
  heightCm?: number;
  weightKg?: { min?: number; max?: number };
  adult?: boolean;
  // True when the label was a bare height code (no age text in the source).
  bareHeight?: boolean;
}

// Extract structured fields from ANY size label (Indonesian or English).
export function parseSizeMeta(raw: string): ParsedSize {
  const original = String(raw == null ? "" : raw).trim();
  const out: ParsedSize = { label: original };
  if (!original) return out;

  const s = normaliseDash(original);

  // Adult sizes ("S-ADULT", "XL ADULT") — keep a readable marker, no age.
  if (/(?:^|[\s\-])adult(?:$|[\s\-])/i.test(s)) {
    out.adult = true;
  }

  // Weight range: "BB 5-12 KG" / "BB 5-12KG" / "5-12 kg".
  const weight = s.match(/\b(?:BB\s*)?(\d{1,3})\s*[–-]\s*(\d{1,3})\s*KG\b/i);
  const weightSingle = s.match(/\b(?:BB\s*)?(\d{1,3})\s*KG\b/i);
  if (weight) {
    out.weightKg = { min: Number(weight[1]), max: Number(weight[2]) };
  } else if (weightSingle) {
    out.weightKg = { min: Number(weightSingle[1]), max: Number(weightSingle[1]) };
  }

  // Years range: "1-2 TAHUN" / "3-4 Tahun" / "1-2 YO" / "1-2 yrs".
  const years = s.match(/(\d+)\s*[–-]\s*(\d+)\s*(?:TAHUN|THN|Y|YO|YRS?|YEARS?|T(?![a-z]))/i);
  if (years) {
    out.age = `${years[1]}–${years[2]} yrs`;
  } else {
    const singleYear = s.match(/(\d+)\s*(?:TAHUN|THN|Y|YO|YRS?|YEARS?)/i);
    if (singleYear) out.age = `${singleYear[1]} ${Number(singleYear[1]) === 1 ? "yr" : "yrs"}`;
  }

  // Months range: "3-6 BLN" / "3-6 bulan" / "6-12 M".
  if (!out.age) {
    const months = s.match(/(\d+)\s*[–-]\s*(\d+)\s*(?:BLN|BULAN|MONTHS?|MTH|M(?![a-z]))\b/i);
    if (months) out.age = `${months[1]}–${months[2]} months`;
    else {
      const singleMonth = s.match(/(\d+)\s*(?:BLN|BULAN|MONTHS?|MTH)\b/i);
      if (singleMonth) out.age = `${singleMonth[1]} months`;
    }
  }

  // Toddler "2T" → 2–3 yrs (only when nothing else matched).
  if (!out.age && !out.adult) {
    const toddler = s.match(/^(\d+)\s*T$/i);
    if (toddler) out.age = `${toddler[1]}–${Number(toddler[1]) + 1} yrs`;
  }

  // Height in cm (explicit "110cm" or a bare numeric code "110").
  const cm = s.match(/\b(\d{2,3})\s*CM\b/i);
  if (cm) {
    out.heightCm = Number(cm[1]);
  } else {
    const bare = s.match(/^(\d{2,3})$/);
    if (bare) {
      out.heightCm = Number(bare[1]);
      out.bareHeight = true;
    }
  }

  // If there is a numeric height with no age text, derive an age band.
  if (!out.age && out.heightCm != null) {
    out.age = heightToAge(out.heightCm);
  }

  return out;
}

// Height (cm) → approximate age band. Unknown values return "{n} cm".
export function heightToAge(cm: number | string): string | undefined {
  const n = typeof cm === "number" ? cm : Number(String(cm).trim());
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (HEIGHT_EXACT_AGE[String(n)]) return HEIGHT_EXACT_AGE[String(n)];
  const band = HEIGHT_AGE_BANDS.find((b) => n >= b.min && n <= b.max);
  if (band) return band.age;
  return `${n} cm`;
}

// Translate a single size label to English age/height text. Idempotent: an
// already-English label ("S (1–2 yrs)") is returned essentially unchanged.
export function translateSizeLabel(raw: string): string {
  const original = String(raw == null ? "" : raw).trim();
  if (!original) return "";

  const parsed = parseSizeMeta(original);
  const s = normaliseDash(original);

  // Adult marker ("S-ADULT") → "S (Adult)".
  if (parsed.adult) {
    const prefix = s.replace(/[\s-]*adult[\s-]*/i, "").trim();
    const cleaned = upperSizePrefix(prefix) || prefix;
    return cleaned ? `${cleaned} (Adult)` : "Adult";
  }

  // Build the age phrase from parsed parts.
  const age = parsed.age || "";

  // Rebuild the label: keep the size prefix (S/M/L/XL or numeric height) and
  // append the age in parentheses. Drop weight (BB … KG) and raw cm clutter.
  // The prefix is whatever appears before "(" OR before the age phrase,
  // so both "S (1-2 TAHUN)" and "L 4-5 TAHUN" keep their letter.
  const prefixMatch = s.match(/^([A-Za-z]{1,4}|\d{2,3})(?=\s*\(|\s|\d|$)/);
  const prefix = prefixMatch ? upperSizePrefix(prefixMatch[1]) : "";

  if (age) {
    if (prefix) {
      // Bare numeric height keeps its cm context so it is not mistaken for an
      // age number: "100" → "100 cm (3–4 yrs)". Also keep "cm" when the source
      // already labelled it ("100 cm (3–4 yrs)") so re-running is idempotent.
      if (parsed.heightCm != null && (parsed.bareHeight || /\d\s*CM\b/i.test(s))) {
        return `${parsed.heightCm} cm (${age})`;
      }
      return `${prefix} (${age})`;
    }
    return age;
  }

  // No age derivable: drop the weight portion but keep the rest readable.
  const withoutWeight = s
    .replace(/\bBB\s*\d{1,3}\s*[–-]\s*\d{1,3}\s*KG\b/i, "")
    .replace(/\bBB\s*\d{1,3}\s*KG\b/i, "")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return upperSizePrefix(withoutWeight) || withoutWeight;
}

// Display label for a size given the product's configured mode.
export function displaySize(raw: string, mode: SizeLabelMode = "age"): string {
  const original = String(raw == null ? "" : raw).trim();
  if (!original) return "";
  if (mode === "manual") return original;
  if (mode === "height") {
    const parsed = parseSizeMeta(original);
    if (parsed.heightCm != null) return `${parsed.heightCm} cm`;
    return translateSizeLabel(original);
  }
  return translateSizeLabel(original);
}

export interface SizeGuideRow {
  size: string; // display prefix (S / M / 100 …)
  age?: string;
  weight?: string;
  height?: string;
  raw: string;
}

// Rows for the storefront Size Guide table, honouring the display mode.
export function buildSizeGuideRows(
  sizes: string[],
  mode: SizeLabelMode = "age",
): SizeGuideRow[] {
  return (sizes || []).map((raw) => {
    const parsed = parseSizeMeta(raw);
    const display = displaySize(raw, mode);
    const prefix = display.replace(/\s*\([^)]*\)\s*$/, "").trim() || display;
    const weight =
      parsed.weightKg && parsed.weightKg.min != null
        ? parsed.weightKg.min === parsed.weightKg.max
          ? `${parsed.weightKg.min} kg`
          : `${parsed.weightKg.min}–${parsed.weightKg.max} kg`
        : undefined;
    return {
      size: prefix,
      age: mode === "age" ? parsed.age : undefined,
      weight,
      height: parsed.heightCm != null ? `${parsed.heightCm} cm` : undefined,
      raw,
    };
  });
}
