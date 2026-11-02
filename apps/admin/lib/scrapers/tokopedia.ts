// Tokopedia adapter.
//
// Modern Tokopedia PDPs ship a JS shell: product data arrives over GraphQL
// after hydration. So the primary strategy is to capture those JSON responses
// in Playwright and deep-search them for the product object. DOM locators and
// the legacy inline relay-state regexes remain as fallbacks, and JSON-LD is
// used when present.
//
// Images are collected from every media field found in the JSON/HTML and then
// normalised/validated by the shared image pipeline.

import { withPage, readJsonLd, type CapturedResponse } from "./browser";
import {
  toNum,
  type NormalizedColor,
  type NormalizedProduct,
  type ScraperVariant,
  type ScrapeResult,
} from "./base";
import { buildImagePlan, upgradeSwatchUrl } from "./images";
import { dedupeColors, detectColorNames, hexForColorName, looksLikeSize, normalizeHex } from "../colors";
import {
  buildSizeGuide,
  extractMaterialFacts,
  inferAudience,
  inferCategory,
} from "../categorize";
import {
  decodeHtmlEntities,
  hasImageExtension,
  isLikelyAsset,
  isLikelySizeChart,
} from "../image-utils";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function productIdFromUrl(url: string): string | undefined {
  const m = url.match(/(\d{8,})(?:[?#]|$)/);
  if (m) return m[1];
  const digits = url.match(/(\d{8,})/);
  return digits ? digits[1] : undefined;
}

// ── Deep search helpers ────────────────────────────────────────────────────

function findProductObject(root: unknown, id?: string): Record<string, any> | null {
  let best: Record<string, any> | null = null;
  let bestScore = -1;
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length && visited < 200_000) {
    const node = stack.pop();
    visited++;
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const obj = node as Record<string, any>;
    const name = typeof obj.name === "string" ? obj.name : typeof obj.title === "string" ? obj.title : "";
    const idValue = obj.productID ?? obj.productId ?? obj.product_id ?? obj.id ?? obj.productKey;
    const idOk = !id || (idValue != null && String(idValue).includes(id));
    if (name && idOk) {
      const score = [
        "media",
        "images",
        "imageURLs",
        "variants",
        "productVariants",
        "description",
        "price",
        "stock",
        "shop",
        "shopName",
      ].filter((k) => obj[k] != null).length;
      if (score > bestScore && score >= 2) {
        best = obj;
        bestScore = score;
      }
    }
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return best;
}

function collectImageUrls(root: unknown, limit = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack: { node: unknown; depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length && out.length < limit) {
    const { node, depth } = stack.pop()!;
    if (node == null || depth > 6) continue;
    if (typeof node === "string") {
      const s = decodeHtmlEntities(node.trim());
      if (/^https?:\/\//i.test(s) && (hasImageExtension(s) || /\/img\/cache\//i.test(s))) {
        const key = s.split("?")[0];
        if (!seen.has(key)) {
          seen.add(key);
          out.push(s);
        }
      }
      continue;
    }
    if (typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push({ node: item, depth: depth + 1 });
      continue;
    }
    for (const key of Object.keys(node as any)) {
      const value = (node as any)[key];
      if (typeof value === "string" || (value && typeof value === "object")) {
        stack.push({ node: value, depth: depth + 1 });
      }
    }
  }
  return out.filter((u) => !isLikelyAsset(u));
}

function optionKey(raw: string): string | null {
  const k = String(raw || "").toLowerCase();
  if (k === "size" || k === "ukuran") return "Ukuran";
  if (k === "color" || k === "colour" || k === "warna") return "Warna";
  return raw ? String(raw) : null;
}

function optionsFromItem(item: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  const groups =
    item.options ??
    item.optionValues ??
    item.combination ??
    item.variations ??
    item.attributes ??
    item.selectedOptions;

  if (Array.isArray(groups)) {
    for (const g of groups) {
      if (!g || typeof g !== "object") continue;
      const rawKey =
        (g as any).name ?? (g as any).optionName ?? (g as any).groupName ?? (g as any).key;
      const rawValue =
        (g as any).value ??
        (g as any).optionValue ??
        (g as any).valueName ??
        (g as any).nameValue ??
        (g as any).label;
      const key = optionKey(String(rawKey || ""));
      if (key && rawValue != null && String(rawValue).trim()) {
        out[key] = String(rawValue).trim();
      }
    }
  }
  for (const [k, v] of Object.entries(item)) {
    const key = optionKey(k);
    if ((key === "Ukuran" || key === "Warna") && v != null && typeof v !== "object") {
      if (String(v).trim()) out[key] = String(v).trim();
    }
  }
  return out;
}

interface JsonVariantResult {
  variants: ScraperVariant[];
  colors: NormalizedColor[];
  price?: number;
  compareAtPrice?: number;
}

function extractJsonVariants(product: Record<string, any>): JsonVariantResult {
  const arrays: any[][] = [];
  const stack: { node: unknown; depth: number }[] = [{ node: product, depth: 0 }];
  let visited = 0;
  while (stack.length && visited < 50_000) {
    const { node, depth } = stack.pop()!;
    visited++;
    if (!node || typeof node !== "object" || depth > 5) continue;
    if (Array.isArray(node)) {
      if (
        node.length &&
        node.every((x) => x && typeof x === "object") &&
        node.some((x) => x.price != null || x.stock != null || x.quantity != null)
      ) {
        arrays.push(node);
      }
      continue;
    }
    for (const value of Object.values(node as any)) {
      if (value && typeof value === "object") stack.push({ node: value, depth: depth + 1 });
    }
  }

  const bestArray = arrays
    .map((arr) => ({ arr, scored: arr.filter((x) => Object.keys(optionsFromItem(x)).length > 0).length }))
    .sort((a, b) => b.arr.length * 2 + b.scored - (a.arr.length * 2 + a.scored))[0]?.arr;

  if (!bestArray) return { variants: [], colors: [] };

  const variants: ScraperVariant[] = [];
  const colors: NormalizedColor[] = [];
  let minPrice: number | undefined;
  let compareAt: number | undefined;

  for (const item of bestArray) {
    if (!item || typeof item !== "object") continue;
    const options = optionsFromItem(item);
    if (!Object.keys(options).length) continue;
    const price = toNum(
      item.price ?? item.discountedPrice ?? item.finalPrice ?? item.salePrice ?? item.unitPrice,
    );
    const original = toNum(
      item.priceOriginal ?? item.originalPrice ?? item.strikePrice ?? item.priceBeforeDiscount,
    );
    const stock = toNum(item.stock ?? item.quantity ?? item.availableStock ?? item.inventory);
    const sku = item.sku ?? item.productCode ?? item.code;
    const hex = normalizeHex(item.hex ?? item.colorHex ?? item.colourHex) || undefined;
    variants.push({
      options,
      price,
      compareAtPrice: original && price && original > price ? original : undefined,
      stock: stock != null ? stock : undefined,
      sku: sku != null ? String(sku) : undefined,
      hex,
    });
    if (price != null && (minPrice == null || price < minPrice)) minPrice = price;
    if (original != null && price != null && original > price) {
      if (compareAt == null || original > compareAt) compareAt = original;
    }
    const color = options.Warna;
    if (color) colors.push({ name: color, hex: hex || "" });
  }

  return { variants, colors: dedupeColors(colors), price: minPrice, compareAtPrice: compareAt };
}

// ── DOM / regex fallbacks ──────────────────────────────────────────────────

async function getText(page: import("playwright").Page, testid: string): Promise<string> {
  const loc = page.locator(`[data-testid="${testid}"]`);
  if ((await loc.count()) === 0) return "";
  return (await loc.first().textContent())?.trim() || "";
}

async function getMeta(page: import("playwright").Page, prop: string): Promise<string> {
  const loc = page.locator(`meta[property="${prop}"]`);
  if ((await loc.count()) === 0) return "";
  return (await loc.first().getAttribute("content")) || "";
}

function extractRelayImages(html: string): string[] {
  const urls: string[] = [];
  const re = /URLOriginal":"(https[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    urls.push(decodeHtmlEntities(m[1]).replace(/&amp;/g, "&"));
  }
  return urls;
}

function extractBrand(html: string, ogTitle: string): string | undefined {
  const m = html.match(/"shopName":"([^"]+)"/);
  if (m) return decodeHtmlEntities(m[1]);
  if (ogTitle) {
    const beforePipe = ogTitle.split(" | Tokopedia")[0];
    const diMatch = beforePipe.match(/ di (.+)$/);
    if (diMatch) return diMatch[1].trim();
  }
  return undefined;
}

function extractRelayVariants(
  html: string,
  productPrice?: number,
): { variants: ScraperVariant[]; colors: NormalizedColor[] } {
  const empty = { variants: [] as ScraperVariant[], colors: [] as NormalizedColor[] };
  const hasSize = /"identifier":"(?:size|ukuran)"/i.test(html);
  const hasColor = /"identifier":"(?:colou?r|warna)"/i.test(html);
  if (!hasSize && !hasColor) return empty;

  interface RawOption { value: string; hex: string; stock: number }
  const sizes: RawOption[] = [];
  const colorOptions: RawOption[] = [];
  const seenSize = new Set<string>();
  const seenColor = new Set<string>();
  const re = /"value":"([^"]+)","hex":"([^"]*)","stock":"?(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const value = decodeHtmlEntities(m[1]);
    const hex = cleanHex(m[2]);
    const stock = parseInt(m[3], 10);
    if (/^\d{6,}$/.test(value)) continue;
    if (!value.trim()) continue;
    const isColor = hex ? true : !hasSize && hasColor ? true : hasSize && !hasColor ? false : !looksLikeSize(value);
    if (isColor) {
      if (!seenColor.has(value)) {
        seenColor.add(value);
        colorOptions.push({ value, hex, stock });
      }
    } else if (!seenSize.has(value)) {
      seenSize.add(value);
      sizes.push({ value, hex, stock });
    }
  }

  const colors = dedupeColors(colorOptions.map((c) => ({ name: c.value, hex: c.hex })));
  if (sizes.length && !colorOptions.length) {
    return {
      variants: sizes.map((s) => ({ options: { Ukuran: s.value }, price: productPrice, stock: s.stock })),
      colors: [],
    };
  }
  if (colorOptions.length && !sizes.length) {
    return {
      variants: colorOptions.map((c) => ({
        options: { Warna: c.value },
        price: productPrice,
        stock: c.stock,
        hex: c.hex,
      })),
      colors,
    };
  }

  const variants: ScraperVariant[] = [];
  for (const c of colorOptions) {
    for (const s of sizes) {
      variants.push({
        options: { Warna: c.value, Ukuran: s.value },
        price: productPrice,
        stock: c.stock > 0 ? c.stock : s.stock,
        hex: c.hex,
      });
    }
  }
  return { variants, colors };
}

function cleanHex(raw: string): string {
  if (!raw) return "";
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  return normalizeHex(withHash) || normalizeHex(raw) || "";
}

// ── DOM variant chips ──────────────────────────────────────────────────────

interface DomGroup {
  name: string;
  values: string[];
  disabled?: string[];
  // Colour name → swatch/preview image URL (Tokopedia renders these on the
  // colour chips), used for per-variant gallery images.
  images?: Record<string, string>;
}

function normaliseGroupName(name: string): string {
  if (/warna|colou?r/i.test(name)) return "Warna";
  if (/ukuran|size/i.test(name)) return "Ukuran";
  return name.trim();
}

async function readDomGroups(page: import("playwright").Page): Promise<{
  groups: DomGroup[];
  selected: Record<string, string>;
}> {
  try {
    const raw = await page.evaluate(() => {
      const root =
        document.querySelector("#pdpVariantContainer") ||
        document.querySelector("#pdp_comp-new_variant_options") ||
        document.querySelector("#pdp_comp-variant_options");
      if (!root) return { groups: [], selected: {} };
      const groups: { name: string; values: string[]; disabled?: string[]; images?: Record<string, string> }[] = [];
      const selected: Record<string, string> = {};
      const titles = Array.from(
        root.querySelectorAll('[data-testid^="pdpVariantTitle"]'),
      );
      for (const title of titles) {
        const rawName = (title.textContent || "").trim();
        const name = rawName.split(":")[0].replace(/^Pilih\s+/i, "").trim() || rawName;
        const container = title.parentElement;
        if (!container) continue;
        const values: string[] = [];
        const disabled: string[] = [];
        const images: Record<string, string> = {};
        let selectedValue = "";
        for (const chip of Array.from(
          container.querySelectorAll('[data-testid^="btnVariantChip"]'),
        )) {
          const testid = chip.getAttribute("data-testid") || "";
          const text = (chip.textContent || "")
            .replace(/Terpilih:\s*/i, "")
            .trim()
            .split("\n")[0]
            .replace(/\s+/g, " ")
            .trim();
          if (!text) continue;
          if (!values.includes(text)) values.push(text);
          const button = chip.querySelector("button");
          const isDisabled =
            (button && (button as HTMLButtonElement).disabled) ||
            chip.getAttribute("aria-disabled") === "true";
          if (isDisabled && !disabled.includes(text)) disabled.push(text);
          if (testid.includes("ActiveSelected")) selectedValue = text;
          const swatchEl = chip.querySelector("i");
          const bg = swatchEl ? getComputedStyle(swatchEl).backgroundImage : "";
          const match = bg && bg.match(/url\(["']?(.*?)["']?\)/);
          if (match && match[1] && !images[text]) images[text] = match[1];
        }
        if (!values.length) continue;
        groups.push({ name, values, disabled, images });
        if (selectedValue) selected[name] = selectedValue;
      }
      return { groups, selected };
    });
    const groups = (raw.groups || []).map((g: DomGroup) => ({
      name: normaliseGroupName(g.name),
      values: g.values,
      disabled: g.disabled || [],
      images: g.images || {},
    }));
    const selected: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.selected || {})) {
      selected[normaliseGroupName(key)] = String(value);
    }
    return { groups, selected };
  } catch {
    return { groups: [], selected: {} };
  }
}

async function readSelectedNumbers(
  page: import("playwright").Page,
): Promise<{ stock?: number; price?: number; compareAt?: number }> {
  const stockText = await page
    .locator('[data-testid="stock-label"]')
    .first()
    .innerText()
    .catch(() => "");
  const priceText = await page
    .locator('[data-testid="lblPDPDetailProductPrice"]')
    .first()
    .innerText()
    .catch(() => "");
  const slashText = await page
    .locator('[data-testid="pdpSlashPrice"]')
    .first()
    .innerText()
    .catch(() => "");
  const stockMatch = stockText.match(/([\d.]+)/);
  return {
    stock: /habis|kosong/i.test(stockText)
      ? 0
      : stockMatch
        ? Number(stockMatch[1].replace(/\./g, ""))
        : undefined,
    price: toNum(priceText),
    compareAt: toNum(slashText),
  };
}

async function clickChip(
  page: import("playwright").Page,
  value: string,
): Promise<boolean> {
  try {
    const index = await page.evaluate((target) => {
      const chips = Array.from(
        document.querySelectorAll('#pdpVariantContainer [data-testid^="btnVariantChip"]'),
      );
      return chips.findIndex((chip) => {
        const text = (chip.textContent || "")
          .replace(/Terpilih:\s*/i, "")
          .trim()
          .split("\n")[0]
          .trim();
        return text === target;
      });
    }, value);
    if (index < 0) return false;
    await page
      .locator('#pdpVariantContainer [data-testid^="btnVariantChip"]')
      .nth(index)
      .click({ timeout: 2500 });
    await page.waitForTimeout(350);
    return true;
  } catch {
    return false;
  }
}

interface DomVariantResult {
  variants: ScraperVariant[];
  colors: NormalizedColor[];
  colorImages: Record<string, string>;
  compareAtPrice?: number;
  groups: DomGroup[];
  selected: Record<string, string>;
}

async function extractDomVariants(
  page: import("playwright").Page,
  price?: number,
): Promise<DomVariantResult> {
  const { groups: rawGroups, selected } = await readDomGroups(page);
  const groups = rawGroups.filter((g) => g.values.length);
  const empty: DomVariantResult = {
    variants: [],
    colors: [],
    colorImages: {},
    groups: [],
    selected,
  };
  if (!groups.length) return empty;

  const primary =
    groups.find((g) => g.name === "Ukuran") ||
    groups.find((g) => g.name === "Warna") ||
    groups[0];
  const initial = await readSelectedNumbers(page);
  const meta = new Map<string, { stock?: number; price?: number; compareAt?: number }>();
  if (selected[primary.name]) meta.set(selected[primary.name], initial);

  // Click each value of the primary dimension once to read its real stock/price.
  const primaryDisabled = new Set(primary.disabled || []);
  for (const value of primary.values.slice(0, 12)) {
    if (primaryDisabled.has(value)) {
      meta.set(value, { stock: 0, price });
      continue;
    }
    if (value === selected[primary.name] && initial.stock != null) continue;
    const ok = await clickChip(page, value);
    if (!ok) continue;
    meta.set(value, await readSelectedNumbers(page));
  }
  // Restore the original selection.
  if (selected[primary.name]) await clickChip(page, selected[primary.name]).catch(() => false);

  const colors: NormalizedColor[] = [];
  const colorGroup = groups.find((g) => g.name === "Warna");
  if (colorGroup) {
    for (const name of colorGroup.values) {
      colors.push({ name, hex: hexForColorName(name) });
    }
  }

  let compareAtPrice = initial.compareAt;
  const variants: ScraperVariant[] = [];
  const combos: Record<string, string>[] = [{}];
  for (const group of groups) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const value of group.values) next.push({ ...combo, [group.name]: value });
    }
    combos.length = 0;
    combos.push(...next);
    if (combos.length > 100) break;
  }
  for (const combo of combos.slice(0, 100)) {
    const info = meta.get(combo[primary.name]);
    if (info?.compareAt && (!compareAtPrice || info.compareAt > compareAtPrice)) {
      compareAtPrice = info.compareAt;
    }
    const comboDisabled = groups.some((g) => (g.disabled || []).includes(combo[g.name]));
    const colorValue = combo.Warna;
    variants.push({
      options: combo,
      price: info?.price ?? price,
      compareAtPrice:
        info?.compareAt && info.price && info.compareAt > info.price ? info.compareAt : undefined,
      stock: comboDisabled ? 0 : info?.stock != null ? info.stock : 10,
      hex: colorValue ? hexForColorName(colorValue) : undefined,
    });
  }

  const colorImages: Record<string, string> = {};
  if (colorGroup) {
    for (const [name, src] of Object.entries(colorGroup.images || {})) {
      if (src) colorImages[name] = upgradeSwatchUrl(src);
    }
  }

  // When there are few combinations, click every colour × size pair to read the
  // real per-combination stock instead of copying the size-level stock.
  const MAX_SWEEP = 40;
  if (combos.length <= MAX_SWEEP && colorGroup) {
    const sizeGroup = groups.find((g) => g.name === "Ukuran");
    if (sizeGroup) {
      const sizeDisabled = new Set(sizeGroup.disabled || []);
      for (const combo of combos) {
        const color = combo.Warna;
        const size = combo.Ukuran;
        if (!color || !size) continue;
        if ((colorGroup.disabled || []).includes(color) || sizeDisabled.has(size)) {
          const v = variants.find(
            (x) => x.options.Warna === color && x.options.Ukuran === size,
          );
          if (v) v.stock = 0;
          continue;
        }
        const okColor = await clickChip(page, color);
        if (!okColor) continue;
        const okSize = await clickChip(page, size);
        if (!okSize) continue;
        const num = await readSelectedNumbers(page);
        const v = variants.find(
          (x) => x.options.Warna === color && x.options.Ukuran === size,
        );
        if (v && num.stock != null) v.stock = num.stock;
        if (num.compareAt && (!compareAtPrice || num.compareAt > compareAtPrice)) {
          compareAtPrice = num.compareAt;
        }
      }
      // Restore the original selection.
      if (selected.Warna) await clickChip(page, selected.Warna).catch(() => false);
      if (selected.Ukuran) await clickChip(page, selected.Ukuran).catch(() => false);
    }
  }

  return { variants, colors, colorImages, compareAtPrice, groups, selected };
}

function cleanTokpedTitle(
  raw: string,
  groups: DomGroup[],
  selected: Record<string, string>,
): string {
  let title = decodeHtmlEntities(String(raw || ""))
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/^\s*Promo\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const color = selected.Warna || groups.find((g) => g.name === "Warna")?.values[0];
  const size = selected.Ukuran || groups.find((g) => g.name === "Ukuran")?.values[0];
  if (color && size) {
    const suffix = new RegExp(`\\s*[-–]\\s*${escapeRegex(color)}\\s*,\\s*${escapeRegex(size)}\\s*$`, "i");
    title = title.replace(suffix, "");
  }
  return title.trim();
}

function stripBrandPrefix(title: string, brand?: string): string {
  if (!brand) return title;
  const prefix = new RegExp(`^\\s*${escapeRegex(brand)}\\s*[-–|:]\\s*`, "i");
  return title.replace(prefix, "").trim() || title;
}

function escapeRegex(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Click each gallery thumbnail so lazy-loaded originals are fetched, then
// return every large gallery image found in the DOM.
async function sweepGallery(page: import("playwright").Page): Promise<string[]> {
  const count = await page
    .locator('[data-testid="PDPImageThumbnail"]')
    .count()
    .catch(() => 0);
  const collect = () =>
    page
      .evaluate(() =>
        Array.from(document.querySelectorAll("img"))
          .map((img) => ({
            src: img.currentSrc || img.src,
            alt: img.getAttribute("alt") || "",
            w: img.naturalWidth,
            h: img.naturalHeight,
          }))
          .filter(
            (x) =>
              /~tplv|images\.tokopedia\.net/i.test(x.src) &&
              x.w >= 300 &&
              x.h >= 300,
          )
          .map((x) => x.src),
      )
      .catch(() => [] as string[]);

  const found = new Set<string>(await collect());
  const limit = Math.min(count, 30);
  for (let i = 0; i < limit; i++) {
    try {
      await page
        .locator('[data-testid="PDPImageThumbnail"]')
        .nth(i)
        .click({ timeout: 1500 });
      await page.waitForTimeout(250);
    } catch {
      // thumbnail may have re-rendered; keep the images we already have
    }
    for (const src of await collect()) found.add(src);
  }
  return [...found];
}

// Images embedded in the seller description / detail tab.
async function detailImages(page: import("playwright").Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll(
          '[data-testid="lblPDPDescriptionProduk"] img, #pdp_comp-product_detail img, [data-testid="product_detail"] img',
        ),
      );
      return nodes
        .map((n) => (n as HTMLImageElement).currentSrc || (n as HTMLImageElement).src)
        .filter(Boolean);
    })
    .catch(() => [] as string[]);
}

// ── Main adapter ───────────────────────────────────────────────────────────

export async function scrapeTokopedia(url: string): Promise<ScrapeResult> {
  const id = productIdFromUrl(url);
  try {
    return await withPage(
      async (page, captured: CapturedResponse[]) => {
        await page
          .waitForSelector("#pdpVariantContainer, #pdp_comp-variant_options", {
            timeout: 8000,
          })
          .catch(() => {});
        const html = await page.content();
        const pageTitle = await page.title().catch(() => "");
        if (/captcha|access denied|verify you are human|unusual traffic/i.test(pageTitle + html.slice(0, 4000))) {
          return {
            ok: false,
            error:
              "Tokopedia memblokir permintaan (captcha/anti-bot). Coba lagi beberapa saat atau gunakan jalur Affiliate API.",
            raw: { id },
          };
        }

        const jsonProduct =
          captured
            .map((c) => findProductObject(c.json, id))
            .filter(Boolean)
            .sort((a, b) => Object.keys(b as any).length - Object.keys(a as any).length)[0] || null;

        const jsonVariants = jsonProduct ? extractJsonVariants(jsonProduct) : { variants: [], colors: [] };

        const domTitle = await getText(page, "lblPDPDetailProductName");
        const domPrice = await getText(page, "lblPDPDetailProductPrice");
        const domDescription = await getText(page, "lblPDPDescriptionProduk");
        const ogTitle = await getMeta(page, "og:title");
        const ogImage = await getMeta(page, "og:image");

        const title = String(
          jsonProduct?.name ||
            jsonProduct?.title ||
            domTitle ||
            (ogTitle ? ogTitle.split(" | Tokopedia")[0].trim() : "") ||
            pageTitle ||
            "",
        ).trim();
        if (!title) {
          return {
            ok: false,
            error:
              "Data produk tidak ditemukan — halaman mungkin butuh login, anti-bot memblok render, atau struktur halaman berubah.",
            raw: { id, captured: captured.length },
          };
        }

        const descriptionRaw = String(jsonProduct?.description || domDescription || "");
        const description = decodeHtmlEntities(descriptionRaw)
          .replace(/<\s*br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        const price =
          toNum(jsonProduct?.price ?? jsonProduct?.priceValue) ??
          toNum(domPrice) ??
          jsonVariants.price;
        const domResult = await extractDomVariants(page, price);
        const currency = "IDR";
        const compareAtPrice =
          domResult.compareAtPrice ??
          jsonVariants.compareAtPrice ??
          (() => {
            const original = toNum(
              jsonProduct?.priceOriginal ??
                jsonProduct?.originalPrice ??
                jsonProduct?.strikePrice ??
                jsonProduct?.priceBeforeDiscount,
            );
            return original && price && original > price ? original : undefined;
          })();

        const regexVariants = extractRelayVariants(html, price);
        let variants = jsonVariants.variants.length
          ? jsonVariants.variants
          : domResult.variants.length
            ? domResult.variants
            : regexVariants.variants;
        let colors = jsonVariants.variants.length
          ? jsonVariants.colors
          : domResult.colors.length
            ? domResult.colors
            : regexVariants.colors;

        let resolvedTitle = cleanTokpedTitle(title, domResult.groups, domResult.selected);
        const ratingFromDom = toNum(
          await getText(page, "lblPDPDetailProductRatingNumber"),
        );
        const reviewsFromDom = toNum(
          await getText(page, "lblPDPDetailProductRatingCounter"),
        );
        const soldFromDom = toNum(await getText(page, "lblPDPDetailProductSoldCounter"));
        const locationFromTitle =
          pageTitle.match(/\s-\s(Kota\s[^-]+|Kab\.?\s[^-]+)\s-\s/) ?.[1]?.trim() || undefined;

        // Single-color products sometimes only mention the colorway in the title.
        if (!colors.length) {
          const detected = detectColorNames(resolvedTitle);
          if (detected.length === 1) {
            const name = detected[0];
            const hex = hexForColorName(name);
            colors = [{ name, hex }];
            if (variants.length && !variants.some((v) => v.options.Warna)) {
              variants = variants.map((v) => ({
                ...v,
                options: { ...v.options, Warna: name },
                hex: v.hex || hex,
              }));
            }
          }
        }

        const structuredImages = jsonProduct ? collectImageUrls(jsonProduct) : [];
        const relayImages = extractRelayImages(html);
        // The gallery may swap in higher-resolution variants after the option
        // selection settles, so read the DOM again after the chip interactions.
        const htmlAfter = await page.content().catch(() => "");
        const plan = buildImagePlan({
          structured: [...structuredImages, ...relayImages, ogImage].filter(Boolean),
          html: `${html}
${htmlAfter}`,
          pageUrl: url,
        });
        const sizeChartImage =
          plan.sizeChartImage ||
          structuredImages.find((u) => isLikelySizeChart(u)) ||
          undefined;

        const sizeLabels = [
          ...new Set(
            variants
              .map((v) => v.options.Ukuran || v.options.Size)
              .filter((s): s is string => Boolean(s)),
          ),
        ];
        const facts = extractMaterialFacts(description);
        const shop = jsonProduct?.shop || {};
        const brand = String(
          jsonProduct?.shopName || shop.name || extractBrand(html, ogTitle) || "",
        ).trim() || undefined;
        const location =
          shop.location ||
          shop.city ||
          shop.address?.city ||
          jsonProduct?.shopLocation ||
          locationFromTitle;
        const rating =
          toNum(jsonProduct?.stats?.rating ?? jsonProduct?.rating ?? jsonProduct?.ratingValue) ??
          ratingFromDom;
        const reviewsCount =
          toNum(
            jsonProduct?.stats?.countReview ??
              jsonProduct?.countReview ??
              jsonProduct?.reviewCount ??
              jsonProduct?.totalReview,
          ) ?? reviewsFromDom;
        const soldCount =
          toNum(
            jsonProduct?.stats?.countSold ??
              jsonProduct?.countSold ??
              jsonProduct?.sold ??
              jsonProduct?.soldCount,
          ) ?? soldFromDom;

        const normalized: NormalizedProduct = {
          platform: "TOKPED",
          sourceUrl: url,
          title: stripBrandPrefix(resolvedTitle || title, brand),
          description: description || undefined,
          price,
          compareAtPrice,
          currency,
          images: plan.images,
          colorImages: Object.keys(domResult.colorImages).length
            ? domResult.colorImages
            : undefined,
          sizeChartImage,
          variants,
          colors: colors.length ? dedupeColors(colors) : undefined,
          specs: {
            ...(inferCategory(title, description) ? { category: inferCategory(title, description) } : {}),
            audience: inferAudience(title, description),
            ...(description ? { originalDescription: description.slice(0, 4000) } : {}),
          },
          brand,
          rating,
          reviewsCount,
          soldCount,
          location: location ? String(location) : undefined,
          materialCare: facts.materialCare,
          fibre: facts.fibre,
          sizeGuide: buildSizeGuide(sizeLabels, { sizeChartImage }),
          extractionPath: variants.length
            ? jsonVariants.variants.length
              ? "graphql"
              : domResult.variants.length
                ? "dom+chips"
                : "dom+regex"
            : jsonProduct
              ? "graphql-partial"
              : "dom",
        };

        return {
          ok: true,
          raw: {
            id,
            captured: captured.length,
            hasJsonProduct: Boolean(jsonProduct),
            imageCount: normalized.images.length,
            variantCount: variants.length,
            extractionPath: normalized.extractionPath,
          },
          normalized,
        };
      },
      {
        url,
        capture: (u) => /gql\.tokopedia\.com/i.test(u),
        blockAssets: true,
        waitMs: 4000,
      },
    );
  } catch (e) {
    return { ok: false, error: errMsg(e), raw: { id } };
  }
}
