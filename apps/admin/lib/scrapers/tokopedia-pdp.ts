// Tokopedia PDP component mapper (pure, no Playwright).
//
// The PDPMainInfo GraphQL response contains the complete product snapshot under
// `data.pdpMainInfo.components`:
//   - product_content     → name, displayed price, campaign slash price, stock
//   - new_variant_options → option groups, sizeChart and `children` (every
//                           colour × size combination with its OWN price,
//                           slash price and stock)
//   - product_media       → gallery images
//   - product_detail      → description
//
// Reading those directly avoids the DOM fallbacks, which applied a single
// product-level price to every variant, capped cross-products at 100 and
// mis-parsed "1,2 jt" stock as "1".

import { toNum, type NormalizedColor, type ScraperVariant } from "./base";
import { dedupeColors, hexForColorName } from "../colors";
import { upgradeSwatchUrl } from "./images";
import { decodeHtmlEntities } from "../image-utils";

export interface PdpStructured {
  title?: string;
  basePrice?: number;
  compareAtPrice?: number;
  totalStock?: number;
  description?: string;
  sizeChart?: string;
  images: string[];
  colorImages: Record<string, string>;
  variants: ScraperVariant[];
  colors: NormalizedColor[];
}

function asRecordArray(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value.filter((x) => x && typeof x === "object") as any[];
  if (value && typeof value === "object") {
    // Apollo custom JSON scalars arrive as { type: "json", json: [...] }.
    const json = (value as any).json;
    if (Array.isArray(json)) return json.filter((x) => x && typeof x === "object") as any[];
    return [value as any];
  }
  return [];
}

function groupKey(name: string, identifier: string): string {
  const k = `${identifier} ${name}`.toLowerCase();
  if (/size|ukuran/.test(k)) return "Ukuran";
  if (/colou?r|warna/.test(k)) return "Warna";
  return name || identifier || "Opsi";
}

// The raw GraphQL response uses camelCase media fields (`urlOriginal`) while the
// server-rendered Apollo cache uses the uppercase CDN names (`URLOriginal`).
function pickMediaUrl(obj: Record<string, any> | undefined, ...keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

// og:title ends with "… di <shop> | Tokopedia". Anchor on that trailing
// segment: matching the first " di " hits text like "(Bayar di Tempat)" and
// returns the whole product title as the brand.
export function brandFromOgTitle(raw: string): string | undefined {
  const title = decodeHtmlEntities(String(raw || "")).trim();
  if (!title) return undefined;
  // Drop the "| Tokopedia" suffix, then take the segment after the LAST " di "
  // (shop names live there; an earlier " di " may appear inside the title,
  // e.g. "(Bayar di Tempat)").
  const beforePipe = title.split("|")[0].trim();
  const lastDi = beforePipe.lastIndexOf(" di ");
  if (lastDi === -1) return undefined;
  const tail = beforePipe.slice(lastDi + 4).trim();
  if (!tail || tail.length > 60) return undefined;
  return tail;
}

function findComponents(payloads: unknown[]): Record<string, any>[] | null {
  for (const payload of payloads) {
    for (const envelope of asRecordArray(payload)) {
      const components = envelope?.data?.pdpMainInfo?.components;
      if (Array.isArray(components) && components.length) {
        return components as Record<string, any>[];
      }
    }
  }
  return null;
}

export function extractPdpStructured(payloads: unknown[]): PdpStructured | null {
  const components = findComponents(payloads);
  if (!components) return null;

  const componentData = (name: string): Record<string, any> | undefined =>
    components.find((c) => c?.name === name)?.data?.[0];

  const content = componentData("product_content");
  const variantComp = componentData("new_variant_options") || componentData("variant_options");
  const mediaComp = componentData("product_media");
  const detailComp = componentData("product_detail");

  const groups = asRecordArray(variantComp?.variants).map((group) => ({
    key: groupKey(String(group?.name || ""), String(group?.identifier || "")),
    values: asRecordArray(group?.option)
      .map((opt) => String(opt?.value ?? opt?.name ?? "").trim())
      .filter(Boolean),
  }));
  const groupKeys = groups.map((g) => g.key);

  const variants: ScraperVariant[] = [];
  const colorImages: Record<string, string> = {};
  const seen = new Set<string>();

  for (const child of asRecordArray(variantComp?.children)) {
    // Tokopedia pads the children list with placeholder rows (negative
    // productID, stock 0, not buyable) repeated under the default option.
    if (String(child?.productID ?? "").startsWith("-")) continue;

    // optionName is a plain array in the raw GraphQL response but the SSR
    // Apollo cache stores it as a custom JSON scalar ({ type: "json", json: [...] }).
    const rawNames = child?.optionName;
    const names = Array.isArray(rawNames)
      ? rawNames.map((x: unknown) => String(x))
      : Array.isArray(rawNames?.json)
        ? rawNames.json.map((x: unknown) => String(x))
        : [];
    if (!names.length) continue;
    const signature = names.join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);

    const options: Record<string, string> = {};
    names.forEach((value, index) => {
      const key = groupKeys[index];
      if (key && value) options[key] = value;
    });
    if (!Object.keys(options).length) continue;

    const price = toNum(child?.price);
    const compareAt = toNum(child?.slashPriceFmt);
    const stock = toNum(child?.stock?.stock);
    const color = options.Warna;

    variants.push({
      options,
      price,
      compareAtPrice:
        compareAt != null && price != null && compareAt > price ? compareAt : undefined,
      stock: stock != null ? Math.max(0, Math.round(stock)) : undefined,
      hex: color ? hexForColorName(color) : undefined,
    });

    if (color && !colorImages[color]) {
      const src = pickMediaUrl(child?.picture, "urlOriginal", "URLOriginal");
      if (src) colorImages[color] = upgradeSwatchUrl(src);
    }
  }

  // Fallback: Tokopedia labels each gallery media with its colour in
  // `description` (e.g. "Merah-jambu"). Use it to map colour → image when the
  // per-child `picture` fields are unavailable.
  if (!Object.keys(colorImages).length && variants.length) {
    const colorNames = [...new Set(variants.map((v) => v.options.Warna).filter(Boolean))] as string[];
    for (const media of asRecordArray(mediaComp?.media)) {
      const label = String(media?.description || "").trim();
      if (!label) continue;
      const color = colorNames.find((name) => name.toLowerCase() === label.toLowerCase());
      if (!color || colorImages[color]) continue;
      const src =
        pickMediaUrl(media, "urlOriginal", "URLOriginal") ||
        pickMediaUrl(media, "urlMaxRes", "URLMaxRes");
      if (src) colorImages[color] = upgradeSwatchUrl(src);
    }
  }

  const colors = dedupeColors(
    variants
      .map((v) => v.options.Warna)
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ name, hex: hexForColorName(name) })),
  );

  const images = [
    ...new Set(
      asRecordArray(mediaComp?.media)
        .filter((m) => !m?.type || /image/i.test(String(m.type)))
        .flatMap((m) => [
          pickMediaUrl(m, "urlOriginal", "URLOriginal"),
          pickMediaUrl(m, "urlMaxRes", "URLMaxRes"),
        ])
        .filter((u): u is string => Boolean(u)),
    ),
  ];

  const rawDetail = detailComp?.productDetailDescription ?? detailComp?.content;
  const description =
    String(
      typeof rawDetail === "string"
        ? rawDetail
        : typeof rawDetail?.text === "string"
          ? rawDetail.text
          : typeof rawDetail?.json === "string"
            ? rawDetail.json
            : "",
    ).trim() || undefined;

  const basePrice =
    toNum(content?.price?.value) ??
    toNum(content?.price?.priceFmt) ??
    variants.reduce<number | undefined>(
      (min, v) => (v.price != null && (min == null || v.price < min) ? v.price : min),
      undefined,
    );

  if (!variants.length && !basePrice) return null;

  return {
    title: typeof content?.name === "string" ? content.name : undefined,
    basePrice,
    compareAtPrice: toNum(content?.campaign?.originalPrice),
    totalStock: toNum(content?.stock?.value),
    description,
    sizeChart: typeof variantComp?.sizeChart === "string" ? variantComp.sizeChart : undefined,
    images,
    colorImages,
    variants,
    colors,
  };
}

// ── Server-rendered HTML (no browser) ──────────────────────────────────────
//
// Tokopedia embeds the whole PDP Apollo cache in the SSR HTML as
// `window.__cache = { ... }`. Parsing it directly lets the import work even when
// the headless browser is blocked by anti-bot / connection resets.

function extractWindowCache(html: string): Record<string, any> | null {
  const marker = "window.__cache=";
  const markerAt = html.indexOf(marker);
  if (markerAt === -1) return null;
  const start = html.indexOf("{", markerAt + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as Record<string, any>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function resolveCacheNode(
  node: unknown,
  cache: Record<string, any>,
  depth: number,
  path: Set<string>,
): any {
  if (depth > 25) return null;
  if (Array.isArray(node)) return node.map((n) => resolveCacheNode(n, cache, depth + 1, path));
  if (!node || typeof node !== "object") return node;
  const ref = node as Record<string, any>;
  if (ref.type === "id" && typeof ref.id === "string" && cache[ref.id]) {
    if (path.has(ref.id)) return {};
    const next = new Set(path);
    next.add(ref.id);
    return resolveCacheNode(cache[ref.id], cache, depth + 1, next);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(ref)) out[key] = resolveCacheNode(ref[key], cache, depth + 1, path);
  return out;
}

export function extractPdpFromHtml(html: string): PdpStructured | null {
  const cache = extractWindowCache(html);
  if (!cache) return null;
  const keys = Object.keys(cache)
    .filter((key) => /pdpMainInfo\(/.test(key) && /\.components\.\d+$/.test(key))
    .sort((a, b) => {
      const ai = Number((a.match(/\.components\.(\d+)$/) || [])[1] || 0);
      const bi = Number((b.match(/\.components\.(\d+)$/) || [])[1] || 0);
      return ai - bi;
    });
  if (!keys.length) return null;
  const components = keys.map((key) => resolveCacheNode(cache[key], cache, 0, new Set([key])));
  return extractPdpStructured([{ data: { pdpMainInfo: { components } } }]);
}
