import type { ScraperVariant } from "./scrapers/base";

// Color helpers for the import pipeline.
// Marketplaces often return color *names* without a hex (e.g. Tokopedia
// "MAHESA", "OCEAN"), and some pages return only a hex for one dimension.
// These helpers give us a deterministic fallback so `bumi.colors` can always be
// built, plus a shared notion of what a size value looks like (used by the
// Tokopedia parser to stop misclassifying colours as sizes).

export interface NormalizedColor {
  name: string;
  hex: string;
}

// English + Indonesian color names → representative hex. Keys are normalized
// (lowercase, punctuation stripped, whitespace collapsed).
const COLOR_HEX: Record<string, string> = {
  // neutrals
  black: "#111111",
  hitam: "#111111",
  white: "#FFFFFF",
  putih: "#FFFFFF",
  "broken white": "#F2EEE9",
  "off white": "#F7F3EE",
  "offwhite": "#F7F3EE",
  cream: "#F2EEE9",
  krem: "#F2EEE9",
  ivory: "#F7F3EE",
  beige: "#E4D5C1",
  sand: "#D9C6A5",
  tan: "#C19A6B",
  khaki: "#B9A88A",
  brown: "#7B4B2A",
  coklat: "#7B4B2A",
  cokelat: "#7B4B2A",
  chocolate: "#5A3A22",
  grey: "#8A8A8A",
  gray: "#8A8A8A",
  abu: "#8A8A8A",
  "abu abu": "#8A8A8A",
  silver: "#C0C0C0",
  charcoal: "#36454F",
  slate: "#708090",
  // blues
  blue: "#96ADD6",
  biru: "#96ADD6",
  "light blue": "#B8D4E8",
  "biru muda": "#B8D4E8",
  "dark blue": "#1F3D68",
  "biru tua": "#1F3D68",
  navy: "#00408C",
  denim: "#4A6FA5",
  teal: "#2F7F7F",
  turquoise: "#40C4C4",
  tosca: "#40C4C4",
  // greens
  green: "#7BA05B",
  hijau: "#7BA05B",
  "light green": "#B7D3A8",
  "hijau muda": "#B7D3A8",
  "dark green": "#3F5F3A",
  "hijau tua": "#3F5F3A",
  army: "#57652D",
  olive: "#6B704A",
  sage: "#A8BBA2",
  mint: "#A8E6CF",
  moss: "#7B8B4A",
  // reds / pinks
  red: "#D7263D",
  merah: "#D7263D",
  maroon: "#7B2D26",
  marun: "#7B2D26",
  burgundy: "#6D1A36",
  pink: "#F2D7D3",
  "hot pink": "#E45A8A",
  fuchsia: "#C2185B",
  magenta: "#C2185B",
  coral: "#FF6F61",
  peach: "#F9B8AF",
  rose: "#E8A2A2",
  // yellows / oranges
  yellow: "#F4C95D",
  kuning: "#F4C95D",
  mustard: "#D4A017",
  gold: "#C9A227",
  orange: "#F08A3C",
  oranye: "#F08A3C",
  jingga: "#F08A3C",
  // purples
  purple: "#8B6BB1",
  ungu: "#8B6BB1",
  lilac: "#C7B6DE",
  lavender: "#B9A7D1",
  plum: "#6A3D6B",
  violet: "#8B6BB1",
  // multi
  multicolor: "#CCCCCC",
  "multi color": "#CCCCCC",
  rainbow: "#CCCCCC",
  // fashion / seasonal names common on Indonesian brand stores
  butter: "#F3E3A3",
  buttercream: "#F6E7B8",
  lemon: "#F7E36B",
  mango: "#F2B24C",
  papaya: "#F2A65A",
  apricot: "#F4BE9A",
  blush: "#F2C9C2",
  "dusty pink": "#D9A6A6",
  "rose gold": "#D9A0A0",
  terracotta: "#C96F4A",
  rust: "#A9552F",
  brick: "#9C4A3C",
  mahogany: "#6F2B26",
  wine: "#6D1A36",
  clay: "#B07A5E",
  cocoa: "#5A3A2A",
  espresso: "#4A2C20",
  chestnut: "#7A4A2B",
  caramel: "#B57B45",
  camel: "#C19A6B",
  honey: "#D9A441",
  wheat: "#E3CFA3",
  oat: "#E6D8BF",
  oatmeal: "#E8DCC8",
  stone: "#CFC7B8",
  taupe: "#B3A394",
  mauve: "#B784A7",
  "dusty rose": "#C9A0A0",
  "forest green": "#2F4F3A",
  emerald: "#2E7D5B",
  pistachio: "#C7D8A8",
  avocado: "#9BAE5C",
  ocean: "#3A6B8A",
  "baby blue": "#BFD8E8",
  "powder blue": "#C9DDE8",
  "sky blue": "#9FC8E8",
  cobalt: "#2B4C9B",
  "royal blue": "#2A4B9B",
  indigo: "#3F4C8A",
  grape: "#6F4A8E",
  // additional neutrals
  graphite: "#4A4A4A",
  "dark grey": "#4F4F4F",
  "light grey": "#D3D3D3",
  "light gray": "#D3D3D3",
  "dark gray": "#4F4F4F",
  natural: "#E8DDC8",
  nude: "#E3C4B4",
  "dusty blue": "#9DB4C0",
};

const NEUTRAL_FALLBACK = "#CCCCCC";

export function normalizeColorName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

// Expand #abc → #AABBCC and uppercase; returns null when invalid.
export function normalizeHex(value: unknown): string | null {
  if (!isHexColor(value)) return null;
  let hex = value.trim().toUpperCase();
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

// Best-effort hex for a color name. Tries exact match, then individual tokens
// (e.g. "navy blue"), then the longest dictionary key contained in the name.
export function hexForColorName(
  name: string | null | undefined,
  fallback: string = NEUTRAL_FALLBACK,
): string {
  const key = normalizeColorName(name || "");
  if (!key) return fallback;
  if (COLOR_HEX[key]) return COLOR_HEX[key];

  const tokens = key.split(" ").filter(Boolean);
  for (const token of tokens) {
    if (COLOR_HEX[token]) return COLOR_HEX[token];
  }

  const keys = Object.keys(COLOR_HEX).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (key.includes(k)) return COLOR_HEX[k];
  }
  return fallback;
}

// A color value we can trust: explicit hex wins, otherwise the dictionary.
export function resolveColorHex(
  name: string,
  hex?: string | null,
  fallback: string = NEUTRAL_FALLBACK,
): string {
  return normalizeHex(hex) || hexForColorName(name, fallback);
}

export function dedupeColors(
  colors: NormalizedColor[],
  fallback: string = NEUTRAL_FALLBACK,
): NormalizedColor[] {
  const out: NormalizedColor[] = [];
  const seen = new Map<string, number>();
  for (const c of colors) {
    const name = String(c?.name || "").trim();
    if (!name) continue;
    const key = normalizeColorName(name);
    if (!key) continue;
    const hex = resolveColorHex(name, c.hex, fallback);
    const idx = seen.get(key);
    if (idx == null) {
      seen.set(key, out.length);
      out.push({ name, hex });
    } else if (isHexColor(c.hex) && out[idx].hex === fallback) {
      // Prefer a real scraped/AI hex over the dictionary fallback.
      out[idx].hex = hex;
    }
  }
  return out;
}

// Shopify uses "Default"/"Default Title" when a product has no real option.
// These must never become storefront swatches.
export function isPlaceholderColor(name: string | null | undefined): boolean {
  return /^(default|default title)$/i.test(String(name || "").trim());
}

// Source of truth for the storefront palette: the variant Color options.
// `explicit` (scraper/AI/admin) only supplies hex values, looked up by name.
// This prevents metafield-only colors that cannot be added to the cart.
export function colorsFromVariants(
  variants: { options: Record<string, string>; hex?: string }[],
  explicit: NormalizedColor[] = [],
  fallback: string = NEUTRAL_FALLBACK,
): NormalizedColor[] {
  const hexByName = new Map<string, string>();
  for (const c of explicit || []) {
    const key = normalizeColorName(c?.name || "");
    if (!key) continue;
    const hex = resolveColorHex(c.name, c.hex, fallback);
    // A real hex beats a dictionary fallback if duplicates are supplied.
    if (!hexByName.has(key) || (isHexColor(c.hex) && hexByName.get(key) === fallback)) {
      hexByName.set(key, hex);
    }
  }

  const out: NormalizedColor[] = [];
  const seen = new Set<string>();
  for (const v of variants || []) {
    const color = colorOptionOf(v.options);
    if (!color) continue;
    const name = String(color.value || "").trim();
    if (!name || isPlaceholderColor(name)) continue;
    const key = normalizeColorName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      hex: hexByName.get(key) || resolveColorHex(name, v.hex, fallback),
    });
  }

  // Single-colour products (e.g. "BIM Ribbed Shirt - Butter") have no Color
  // option on their variants, so fall back to the explicitly detected colours
  // — the colour filter on the storefront must still surface them.
  if (!out.length) {
    for (const c of explicit || []) {
      const name = String(c?.name || "").trim();
      if (!name || isPlaceholderColor(name)) continue;
      const key = normalizeColorName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        hex: resolveColorHex(name, c.hex, fallback),
      });
    }
  }
  return out;
}

// The first color added to a product that only had sizes must be applied to
// the existing variants (keeping their stock) instead of appending duplicates
// that leave the old variants without a Color value.
export function applyColorToVariants<T extends { options: Record<string, string> }>(
  variants: T[],
  colorName: string,
  colorKey = "Warna",
): T[] {
  return (variants || []).map((v) => ({
    ...v,
    options: { ...v.options, [colorKey]: colorName },
  }));
}

export interface SizeEntry {
  key: string;
  value: string;
}

export function sizeOptionOf(
  options: Record<string, string>,
): SizeEntry | null {
  for (const [key, value] of Object.entries(options || {})) {
    if (/^(size|ukuran)$/i.test(key) && value) return { key, value };
  }
  return null;
}

// Pure logic behind the admin "Add color" button. Kept here (instead of inside
// the React component) so it can be tested without a browser/login.
export function addColorToVariants(
  variants: ScraperVariant[],
  name: string,
  hex: string,
  removed: Set<number> = new Set(),
  price?: number,
): { variants: ScraperVariant[]; colorKey: string } {
  const kept = variants.filter((_, i) => !removed.has(i));
  const colorKey =
    (kept.length ? kept : variants)
      .map((v) => colorOptionOf(v.options))
      .find(Boolean)?.key || "Warna";
  const hasColor = kept.some((v) => Boolean(colorOptionOf(v.options)));

  if (!hasColor && kept.length > 0) {
    // Product only had sizes so far: apply the first color to the existing
    // variants (keeping stock) instead of appending duplicate size combos.
    const converted = applyColorToVariants(kept, name, colorKey);
    let idx = 0;
    return {
      colorKey,
      variants: variants.map((v, i) =>
        removed.has(i)
          ? v
          : { ...converted[idx++], hex: v.hex || hex },
      ),
    };
  }

  // A new color on top of existing colors: one variant per size, stock 0.
  const sizes = [
    ...new Map(
      kept
        .map((v) => sizeOptionOf(v.options))
        .filter((s): s is SizeEntry => Boolean(s))
        .map((s) => [s.value, s]),
    ).values(),
  ];
  const added: ScraperVariant[] = sizes.length
    ? sizes.map((s) => ({
        options: { [colorKey]: name, [s.key]: s.value },
        price,
        stock: 0,
        hex,
      }))
    : [{ options: { [colorKey]: name }, price, stock: 0, hex }];

  return { colorKey, variants: [...variants, ...added] };
}

// Finds the color option on a variant, regardless of the source language.
export function colorOptionOf(options: Record<string, string>): {
  key: string;
  value: string;
} | null {
  for (const [key, value] of Object.entries(options || {})) {
    const k = key.toLowerCase();
    if (k === "color" || k === "colour" || k === "warna") {
      if (value) return { key, value };
    }
  }
  return null;
}

export function looksLikeSize(value: string): boolean {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return false;
  if (/^(one|all|free)\s*size$/.test(s)) return true;
  if (/\b(size|ukuran)\b/.test(s)) return true;
  // Sizes are short codes optionally followed by an age/height range:
  // "S", "XL", "2T", "1Y", "3-6M", "S (1-2 YO)", "110cm", "12-18 months".
  return /^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|5xl|\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?)\s*(?:\(|$|y|yo|t\b|m\b|cm\b|months?\b|yrs?\b|years?\b)/.test(
    s,
  );
}

// Detect known color names inside free text (title/description/variant data).
// Whole-token matching avoids false positives (e.g. "sage" inside "message").
// Longest matches win, and matches fully contained in a longer one are dropped.
export function detectColorNames(...texts: (string | undefined | null)[]): string[] {
  const text = normalizeColorName(texts.filter(Boolean).join(" "));
  if (!text) return [];
  const keys = Object.keys(COLOR_HEX)
    .filter((k) => k.length >= 3)
    .sort((a, b) => b.length - a.length);

  const matches: { key: string; start: number; end: number }[] = [];
  for (const key of keys) {
    const re = new RegExp(`(?:^| )${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`);
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index + (m[0].startsWith(" ") ? 1 : 0);
    matches.push({ key, start, end: start + key.length });
  }

  const kept = matches.filter(
    (m) =>
      !matches.some(
        (other) =>
          other !== m &&
          other.start <= m.start &&
          other.end >= m.end &&
          other.end - other.start > m.end - m.start,
      ),
  );

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of kept.sort((a, b) => a.start - b.start)) {
    if (seen.has(m.key)) continue;
    seen.add(m.key);
    out.push(toTitleCase(m.key));
  }
  return out;
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
