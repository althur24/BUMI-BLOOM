/* ============================================
   BUMI / BLOOM — Product Catalog (Kids)
   Storefront data facade.

   Sumber produk & brand: Shopify Storefront API (public token).
   Produk & brand di-fetch terpisah (Promise.allSettled) agar kegagalan
   satu tidak mengosongkan yang lain.

   Memetakan Shopify → bentuk {id,name,brand,price,colors,sizes,image,
   gallery,...} yang SAMA dengan konsumen PLP/PDP/cart/wishlist/homepage.
   `id` === product.handle (sebelumnya === Product.slug), tetap stabil
   supaya cart/wishlist dan ?id= URLs jalan. Load-time renderers harus
   `await BumiData.ready()` sebelum baca; click-time consumers aman setelah load.
   ============================================ */

const PLACEHOLDER_IMG = '/images/placeholder.png';

// ── Color helpers ───────────────────────────────────────────────────────────
// The storefront renders swatches from the optional `bumi.colors` metafield.
// Products created/edited directly in Shopify Admin (or pushed before the
// metafield existed) only have Color variant options, so we derive the palette
// from those and fill hexes from this dictionary.
const COLOR_HEX = {
  black: '#111111', hitam: '#111111', white: '#FFFFFF', putih: '#FFFFFF',
  'broken white': '#F2EEE9', 'off white': '#F7F3EE', cream: '#F2EEE9', krem: '#F2EEE9',
  ivory: '#F7F3EE', beige: '#E4D5C1', sand: '#D9C6A5', tan: '#C19A6B', khaki: '#B9A88A',
  brown: '#7B4B2A', coklat: '#7B4B2A', cokelat: '#7B4B2A', chocolate: '#5A3A22',
  grey: '#8A8A8A', gray: '#8A8A8A', abu: '#8A8A8A', 'abu abu': '#8A8A8A',
  silver: '#C0C0C0', charcoal: '#36454F', slate: '#708090',
  blue: '#96ADD6', biru: '#96ADD6', 'light blue': '#B8D4E8', 'biru muda': '#B8D4E8',
  'dark blue': '#1F3D68', 'biru tua': '#1F3D68', navy: '#00408C', denim: '#4A6FA5',
  teal: '#2F7F7F', turquoise: '#40C4C4', tosca: '#40C4C4',
  green: '#7BA05B', hijau: '#7BA05B', 'light green': '#B7D3A8', 'hijau muda': '#B7D3A8',
  'dark green': '#3F5F3A', 'hijau tua': '#3F5F3A', army: '#57652D', olive: '#6B704A',
  sage: '#A8BBA2', mint: '#A8E6CF', moss: '#7B8B4A',
  red: '#D7263D', merah: '#D7263D', maroon: '#7B2D26', marun: '#7B2D26', burgundy: '#6D1A36',
  pink: '#F2D7D3', 'hot pink': '#E45A8A', fuchsia: '#C2185B', magenta: '#C2185B',
  coral: '#FF6F61', peach: '#F9B8AF', rose: '#E8A2A2',
  yellow: '#F4C95D', kuning: '#F4C95D', mustard: '#D4A017', gold: '#C9A227',
  orange: '#F08A3C', oranye: '#F08A3C', jingga: '#F08A3C',
  purple: '#8B6BB1', ungu: '#8B6BB1', lilac: '#C7B6DE', lavender: '#B9A7D1',
  plum: '#6A3D6B', violet: '#8B6BB1',
  multicolor: '#CCCCCC', 'multi color': '#CCCCCC', rainbow: '#CCCCCC'
};

function normalizeColorName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHex(hex) {
  if (typeof hex !== 'string') return '';
  const value = hex.trim();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return '';
  if (value.length === 4) {
    return '#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3];
  }
  return value.toUpperCase();
}

function hexForColorName(name) {
  const key = normalizeColorName(name);
  if (!key) return '#CCCCCC';
  if (COLOR_HEX[key]) return COLOR_HEX[key];
  for (const token of key.split(' ')) if (COLOR_HEX[token]) return COLOR_HEX[token];
  const keys = Object.keys(COLOR_HEX).sort((a, b) => b.length - a.length);
  for (const k of keys) if (key.includes(k)) return COLOR_HEX[k];
  return '#CCCCCC';
}

const COLOR_OPTION_NAMES = ['color', 'colour', 'warna'];
const SIZE_OPTION_NAMES = ['size', 'ukuran'];

// ── Size-label normalisation (mirror of apps/admin/lib/size-labels.ts) ──────
// Marketplace imports ship Indonesian size values ("S (1-2 TAHUN)") or bare
// height codes ("100"). The storefront is English/metric, so labels are shown
// as age ("S (1–2 yrs)") honouring each product's `bumi.size_label_mode`
// metafield. Keep this block in sync with the admin module.
const SIZE_LABEL_MODES = ['age', 'height', 'manual'];

function normaliseSizeLabelMode(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return SIZE_LABEL_MODES.includes(v) ? v : 'age';
}

const HEIGHT_AGE_BANDS = [
  { min: 80, max: 86, age: '1–2 yrs' },
  { min: 87, max: 98, age: '2–3 yrs' },
  { min: 99, max: 104, age: '3–4 yrs' },
  { min: 105, max: 110, age: '4–5 yrs' },
  { min: 111, max: 116, age: '5–6 yrs' },
  { min: 117, max: 122, age: '6–7 yrs' },
  { min: 123, max: 128, age: '7–8 yrs' },
  { min: 129, max: 134, age: '8–9 yrs' },
  { min: 135, max: 140, age: '9–10 yrs' },
  { min: 141, max: 146, age: '10–11 yrs' },
  { min: 147, max: 152, age: '11–12 yrs' },
];

const HEIGHT_EXACT_AGE = {
  '90': '2–3 yrs', '100': '3–4 yrs', '110': '4–5 yrs', '120': '5–6 yrs',
  '130': '6–7 yrs', '140': '7–8 yrs', '150': '8–9 yrs', '160': '9–10 yrs',
};

const KNOWN_SIZE_PREFIXES = ['XXXXL', 'XXXL', 'XXL', 'XL', 'XS', 'XXS', 'XXXS', 'L', 'M', 'S'];

function normaliseSizeDash(s) {
  return String(s)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/(\d)\s*-\s*(\d)/g, '$1–$2');
}

function upperSizePrefix(s) {
  const m = String(s).match(/^([A-Za-z]{1,4})(\b|\s|\()/);
  if (!m) return s;
  const up = m[1].toUpperCase();
  if (!KNOWN_SIZE_PREFIXES.includes(up)) return s;
  return up + s.slice(m[1].length);
}

function heightToAge(cm) {
  const n = typeof cm === 'number' ? cm : Number(String(cm).trim());
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (HEIGHT_EXACT_AGE[String(n)]) return HEIGHT_EXACT_AGE[String(n)];
  const band = HEIGHT_AGE_BANDS.find((b) => n >= b.min && n <= b.max);
  if (band) return band.age;
  return n + ' cm';
}

function parseSizeMeta(raw) {
  const original = String(raw == null ? '' : raw).trim();
  const out = { label: original };
  if (!original) return out;
  const s = normaliseSizeDash(original);

  if (/(?:^|[\s-])adult(?:$|[\s-])/i.test(s)) out.adult = true;

  const weight = s.match(/\b(?:BB\s*)?(\d{1,3})\s*[–-]\s*(\d{1,3})\s*KG\b/i);
  const weightSingle = s.match(/\b(?:BB\s*)?(\d{1,3})\s*KG\b/i);
  if (weight) out.weightKg = { min: Number(weight[1]), max: Number(weight[2]) };
  else if (weightSingle) out.weightKg = { min: Number(weightSingle[1]), max: Number(weightSingle[1]) };

  const years = s.match(/(\d+)\s*[–-]\s*(\d+)\s*(?:TAHUN|THN|Y|YO|YRS?|YEARS?|T(?![a-z]))/i);
  if (years) out.age = years[1] + '–' + years[2] + ' yrs';
  else {
    const singleYear = s.match(/(\d+)\s*(?:TAHUN|THN|Y|YO|YRS?|YEARS?)/i);
    if (singleYear) out.age = singleYear[1] + ' ' + (Number(singleYear[1]) === 1 ? 'yr' : 'yrs');
  }

  if (!out.age) {
    const months = s.match(/(\d+)\s*[–-]\s*(\d+)\s*(?:BLN|BULAN|MONTHS?|MTH|M(?![a-z]))\b/i);
    if (months) out.age = months[1] + '–' + months[2] + ' months';
    else {
      const singleMonth = s.match(/(\d+)\s*(?:BLN|BULAN|MONTHS?|MTH)\b/i);
      if (singleMonth) out.age = singleMonth[1] + ' months';
    }
  }

  if (!out.age && !out.adult) {
    const toddler = s.match(/^(\d+)\s*T$/i);
    if (toddler) out.age = toddler[1] + '–' + (Number(toddler[1]) + 1) + ' yrs';
  }

  const cm = s.match(/\b(\d{2,3})\s*CM\b/i);
  if (cm) out.heightCm = Number(cm[1]);
  else {
    const bare = s.match(/^(\d{2,3})$/);
    if (bare) { out.heightCm = Number(bare[1]); out.bareHeight = true; }
  }

  if (!out.age && out.heightCm != null) out.age = heightToAge(out.heightCm);
  return out;
}

function translateSizeLabel(raw) {
  const original = String(raw == null ? '' : raw).trim();
  if (!original) return '';
  const parsed = parseSizeMeta(original);
  const s = normaliseSizeDash(original);

  if (parsed.adult) {
    const prefix = s.replace(/[\s-]*adult[\s-]*/i, '').trim();
    const cleaned = upperSizePrefix(prefix) || prefix;
    return cleaned ? cleaned + ' (Adult)' : 'Adult';
  }

  const age = parsed.age || '';
  const prefixMatch = s.match(/^([A-Za-z]{1,4}|\d{2,3})(?=\s*\(|\s|\d|$)/);
  const prefix = prefixMatch ? upperSizePrefix(prefixMatch[1]) : '';

  if (age) {
    if (prefix) {
      if (parsed.heightCm != null && (parsed.bareHeight || /\d\s*CM\b/i.test(s))) return parsed.heightCm + ' cm (' + age + ')';
      return prefix + ' (' + age + ')';
    }
    return age;
  }

  const withoutWeight = s
    .replace(/\bBB\s*\d{1,3}\s*[–-]\s*\d{1,3}\s*KG\b/i, '')
    .replace(/\bBB\s*\d{1,3}\s*KG\b/i, '')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return upperSizePrefix(withoutWeight) || withoutWeight;
}

function displaySize(raw, mode) {
  const original = String(raw == null ? '' : raw).trim();
  if (!original) return '';
  const m = normaliseSizeLabelMode(mode);
  if (m === 'manual') return original;
  if (m === 'height') {
    const parsed = parseSizeMeta(original);
    if (parsed.heightCm != null) return parsed.heightCm + ' cm';
  }
  return translateSizeLabel(original);
}

function optionValue(options, names) {
  for (const o of (options || [])) {
    if (names.includes(String(o && o.name || '').toLowerCase())) {
      return o && o.value ? String(o.value) : '';
    }
  }
  return '';
}

function isPlaceholderColor(name) {
  return /^(default|default title)$/i.test(String(name || '').trim());
}

function buildColors(rawColors, variants) {
  // Variants are the source of truth: every swatch must map to a real variant
  // so Add to Bag / Shopify checkout can resolve it. The metafield supplies
  // the hex (dictionary fallback), never extra colors that cannot be bought.
  const hexByName = new Map();
  for (const c of (Array.isArray(rawColors) ? rawColors : [])) {
    const key = normalizeColorName(c && c.name);
    if (!key) continue;
    const hex = normalizeHex(c.hex);
    if (!hexByName.has(key)) hexByName.set(key, hex || hexForColorName(c.name));
    else if (hex) hexByName.set(key, hex);
  }

  const out = [];
  const seen = new Set();
  for (const v of (variants || [])) {
    const name = String(v && v.color || '').trim();
    if (!name || isPlaceholderColor(name)) continue;
    const key = normalizeColorName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, hex: hexByName.get(key) || hexForColorName(name) });
  }

  // Legacy products that only have colors in the metafield (no Color option).
  if (!out.length) {
    for (const c of (Array.isArray(rawColors) ? rawColors : [])) {
      const name = String(c && c.name || '').trim();
      if (!name || isPlaceholderColor(name)) continue;
      const key = normalizeColorName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, hex: normalizeHex(c.hex) || hexForColorName(name) });
    }
  }
  return out;
}

// ── Shopify Storefront config (public token, aman di browser) ──────────────
const SHOPIFY_SHOP = 'p9gcf7-wj';
const SHOPIFY_STOREFRONT_TOKEN = 'f221d7b0fcb996294ab2cb0732cf01b5';
const SHOPIFY_API_VERSION = '2026-10';

const SHOPIFY_ENDPOINT = `https://${SHOPIFY_SHOP}.myshopify.com/api/${SHOPIFY_API_VERSION}/graphql.json`;

// Query produk (semua field yang dipakai mapShopifyProduct).
const PRODUCTS_QUERY = `query @inContext(country: AU) {
  products(first: 100) {
    edges {
      node {
        handle
        title
        descriptionHtml
        description
        productType
        vendor
        featuredImage { url }
        images(first: 50) { edges { node { url } } }
        variants(first: 100) {
          edges {
            node {
              id
              price { amount currencyCode }
              compareAtPrice { amount }
              quantityAvailable
              image { url }
              selectedOptions { name value }
            }
          }
        }
        metafields(identifiers: [
          {namespace:"bumi",key:"colors"},
          {namespace:"bumi",key:"fibre"},
          {namespace:"bumi",key:"material"},
          {namespace:"bumi",key:"audience"},
          {namespace:"bumi",key:"badge"},
          {namespace:"bumi",key:"is_new"},
          {namespace:"bumi",key:"is_bestseller"},
          {namespace:"bumi",key:"rating"},
          {namespace:"bumi",key:"reviews_count"},
          {namespace:"bumi",key:"sold_count"},
          {namespace:"bumi",key:"size_guide"},
          {namespace:"bumi",key:"size_chart_image"},
          {namespace:"bumi",key:"size_label_mode"},
          {namespace:"bumi",key:"added_at_rank"}
        ]) { key value }
      }
    }
  }
}`;

// Query brand metaobjects. `logo` is an optional file reference: when a brand
// has one set in Shopify Admin it becomes the card image, otherwise the
// storefront falls back to a generated monogram (no hardcoded images).
const BRANDS_QUERY = `{
  metaobjects(type: "brand", first: 50) {
    edges {
      node {
        handle
        fields {
          key
          value
          reference {
            ... on MediaImage { image { url } }
          }
        }
      }
    }
  }
}`;

function safeParseJSON(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// Audience drives the Girls / Boys collections. Shopify stores it in the
// `bumi.audience` metafield; anything unexpected (empty, legacy values, a
// metafield without storefront access) falls back to "unisex" so the product
// still shows up instead of silently disappearing from both collections.
const PRODUCT_AUDIENCES = ['girls', 'boys', 'unisex', 'baby'];
function normalizeAudience(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return PRODUCT_AUDIENCES.includes(v) ? v : 'unisex';
}

// Shopify Storefront product node → data.js product shape.
function mapShopifyProduct(node) {
  const meta = {};
  for (const m of (node.metafields || [])) if (m && m.key) meta[m.key] = m.value;

  const metaColors = safeParseJSON(meta.colors, []);
  const variants = (node.variants && node.variants.edges || []).map((e) => e.node);
  const sizeLabelMode = normaliseSizeLabelMode(meta.size_label_mode);

  // Translate each raw size once and reuse the same map for both the button
  // list and the variant list, so selection/sold-out/cart matching stay in
  // sync (they must reference the exact same display string). `sizeRaw` is
  // kept for the Size Guide table (weight/height parsing) and debugging.
  const sizeDisplayByRaw = new Map();
  function displayFor(raw) {
    if (!raw) return '';
    if (sizeDisplayByRaw.has(raw)) return sizeDisplayByRaw.get(raw);
    let label = displaySize(raw, sizeLabelMode);
    // Guard against two raws collapsing to one label (e.g. "100" and "3-4 yrs"):
    // suffix with the raw value so buttons/variants never merge.
    const clash = [...sizeDisplayByRaw.values()].includes(label);
    if (clash && label !== raw) label = label + ' · ' + raw;
    sizeDisplayByRaw.set(raw, label);
    return label;
  }

  const sizes = [];
  const sizesRaw = [];
  variants.forEach((v) => {
    const raw = optionValue(v.selectedOptions, SIZE_OPTION_NAMES);
    if (!raw) return;
    if (!sizesRaw.includes(raw)) sizesRaw.push(raw);
    const label = displayFor(raw);
    if (label && !sizes.includes(label)) sizes.push(label);
  });

  // Daftar varian lengkap (dipakai cart untuk dapat merchandiseId/GID saat checkout Shopify).
  const variantList = variants.map((v) => {
    const color = optionValue(v.selectedOptions, COLOR_OPTION_NAMES);
    const rawSize = optionValue(v.selectedOptions, SIZE_OPTION_NAMES);
    const size = rawSize ? displayFor(rawSize) : '';
    return {
      id: v.id,
      color,
      size,
      sizeRaw: rawSize,
      price: parseFloat(v.price.amount),
      compareAt: v.compareAtPrice ? parseFloat(v.compareAtPrice.amount) : undefined,
      available: typeof v.quantityAvailable === 'number' ? v.quantityAvailable > 0 : true,
      image: (v.image && v.image.url) || '',
    };
  });

  // Product-level availability for cards and the PDP. A product is available
  // if at least one of its variants is in stock for the active market (AU).
  const available = variantList.some((v) => v.available);

  // `bumi.colors` is primary; fall back to the Shopify Color options so
  // swatches still work for products edited directly in Shopify Admin.
  const colors = buildColors(metaColors, variantList);

  const images = (node.images && node.images.edges || []).map((e) => e.node && e.node.url).filter(Boolean);
  const featured = node.featuredImage && node.featuredImage.url;
  const image = featured || images[0] || PLACEHOLDER_IMG;
  const gallery = images.length ? images : [image];

  const priceAmt = variants.length ? parseFloat(variants[0].price.amount) : 0;
  // Sale is defined purely by the compare-at price, so look at every variant:
  // a markdown on any size makes the product a sale item, even when the first
  // variant is full price. Removing the compare-at price takes it out of Sale.
  const discounted = variantList.find(
    (v) => Number.isFinite(v.compareAt) && v.compareAt > v.price,
  );
  const compareAt = discounted ? discounted.compareAt : undefined;

  return {
    id: node.handle,
    name: node.title || '',
    brand: node.vendor || '',
    audience: normalizeAudience(meta.audience),
    // Shopify product types are free text ("Busy Book", "busy_book") —
    // normalise to the storefront slug taxonomy (busy-book) so manually
    // edited products still match the category filters.
    category: (node.productType || '').trim().toLowerCase().replace(/[\s_]+/g, '-'),
    price: Math.round(priceAmt),
    compareAt: compareAt ? Math.round(compareAt) : undefined,
    fibre: meta.fibre || '',
    colors: Array.isArray(colors) ? colors : [],
    sizes,
    sizesRaw,
    sizeLabelMode,
    variants: variantList,
    available,
    soldOut: !available,
    image,
    gallery: gallery.length ? gallery : [image],
    badge: meta.badge || null,
    isNew: meta.is_new === 'true',
    isBestseller: meta.is_bestseller === 'true',
    rating: meta.rating ? parseFloat(meta.rating) : 0,
    reviews: meta.reviews_count ? parseInt(meta.reviews_count, 10) : 0,
    addedAt: meta.added_at_rank ? parseInt(meta.added_at_rank, 10) : 0,
    // `descriptionHtml` keeps the paragraph/heading/list structure from Shopify;
    // `description` is the tag-stripped plain text and only a last resort.
    description: node.descriptionHtml || node.description || '',
    material: meta.material || '',
    sizeGuide: meta.size_guide || '',
    sizeChartImage: meta.size_chart_image || '',
    soldCount: meta.sold_count ? parseInt(meta.sold_count, 10) : 0,
  };
}

// ── Brand identity helpers ──────────────────────────────────────────────────
// Products carry a Shopify `vendor` string, while brand metaobjects carry a
// hand-written `name`. The two rarely match exactly ("Sabine and Heem" vs
// "Sabine & Heem"), so everything brand-related is keyed through this single
// normaliser. It mirrors normalizeVendor() in apps/admin/lib/shopify.ts so the
// storefront and the import pipeline agree on what "the same brand" means.
function normalizeBrandKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/officialshop|official|shop|store/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Human-readable URL slug: "Sabine & Heem" → "sabine-heem". Falls back to the
// normalised key when the name has no usable words (e.g. punctuation only).
function brandSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bofficialshop\b|\bofficial\b|\bshop\b|\bstore\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || normalizeBrandKey(name);
}

// Brand shape converter (sama dengan konsumen lama: slug/name/city/audience/website/desc).
function mapBrand(b) {
  const name = b.name || '';
  return {
    slug: b.slug || brandSlug(name),
    name,
    key: normalizeBrandKey(b.vendorKey || name),
    city: b.city || 'Indonesia',
    audience: normalizeBrandAudience(b.audience),
    website: b.website || '',
    desc: b.shortDesc || '',
    // Brand artwork uploaded to Shopify (metaobject "logo" file field). Empty
    // when not set — the storefront then renders product artwork or a monogram.
    image: b.image || '',
    // Filled in by buildBrands(): how many products this brand has and a few
    // product images used to build the card collage.
    productCount: 0,
    productImages: [],
  };
}

// Audience of a brand, derived from its products: a brand whose products are
// all girls is a girls brand, a mixed catalogue is unisex.
// The storefront no longer has a Baby category, so a brand whose only products
// are tagged baby is presented as unisex rather than surfacing the label.
function normalizeBrandAudience(audience) {
  const value = String(audience || '').toLowerCase();
  return value === 'baby' ? 'unisex' : value;
}

const BRAND_AUDIENCES = ['girls', 'boys'];
function deriveBrandAudience(products) {
  const found = new Set();
  for (const p of products) {
    const a = normalizeBrandAudience(p.audience);
    if (BRAND_AUDIENCES.includes(a)) found.add(a);
  }
  if (found.size === 1) return [...found][0];
  return 'unisex';
}

// Merge the catalogue with the brand metaobjects:
//   - every vendor in PRODUCTS becomes a brand (new imports appear instantly)
//   - metaobject values (name/desc/city/website/logo) win when present
//   - metaobject brands with no products stay visible (monogram card)
function buildBrands(products, metaBrands) {
  // Products are grouped first so a metaobject can always be attached to the
  // vendor it describes — even when its name differs from the vendor string
  // (which would otherwise produce a duplicate, product-less brand card).
  const productGroups = new Map();
  for (const p of (products || [])) {
    const key = normalizeBrandKey(p.brand);
    if (!key) continue;
    if (!productGroups.has(key)) productGroups.set(key, []);
    productGroups.get(key).push(p);
  }

  const byKey = new Map();
  const order = [];

  for (const meta of (metaBrands || [])) {
    // Match on the display name first, then on the handle — owners sometimes
    // rename a brand ("Anakmu Kids") while the metaobject handle stays the
    // vendor slug ("anakmu").
    const byName = normalizeBrandKey(meta.name);
    const byHandle = normalizeBrandKey(meta.slug);
    const key = (byName && productGroups.has(byName)) ? byName
      : (byHandle && productGroups.has(byHandle)) ? byHandle
      : (byName || byHandle);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { ...meta, key });
    order.push(key);
  }

  for (const [key, group] of productGroups) {
    if (byKey.has(key)) continue;
    const preview = group[0] || {};
    byKey.set(key, mapBrand({ name: String(preview.brand || '').trim(), vendorKey: key }));
    order.push(key);
  }

  const usedSlugs = new Set();
  return order.map((key) => {
    const brand = byKey.get(key);
    const group = productGroups.get(key) || [];

    const images = [];
    for (const p of group) {
      if (!p.image || p.image === PLACEHOLDER_IMG || images.includes(p.image)) continue;
      images.push(p.image);
      if (images.length >= 4) break;
    }

    const vendors = [];
    for (const p of group) {
      const vendor = String(p.brand || '').trim();
      if (vendor && !vendors.includes(vendor)) vendors.push(vendor);
    }

    // Slugs must be unique for /products?brand=<slug> to resolve one brand.
    let slug = brand.slug || brandSlug(brand.name);
    if (usedSlugs.has(slug)) {
      const base = slug;
      let n = 2;
      while (usedSlugs.has(slug)) slug = base + '-' + n++;
    }
    usedSlugs.add(slug);

    return {
      ...brand,
      slug,
      audience: brand.audience || deriveBrandAudience(group),
      productCount: group.length,
      productImages: images,
      // Exact `vendor` strings as they appear on products — PLP filters match
      // on the normalised key, so a metaobject name may differ from these.
      vendors,
    };
  });
}

// Shopify brand metaobject node → brand shape.
function mapShopifyBrand(node) {
  const f = {};
  let image = '';
  for (const field of (node.fields || [])) {
    if (!field || !field.key) continue;
    f[field.key] = field.value;
    const url = field.reference && field.reference.image && field.reference.image.url;
    if (url && /^(logo|image|photo|picture)$/i.test(field.key)) image = url;
  }
  return mapBrand({
    slug: node.handle,
    name: f.name || '',
    vendorKey: f.vendor || f.name || '',
    city: f.city || 'Indonesia',
    audience: f.audience || '',
    website: f.website || '',
    shortDesc: f.desc || '',
    image,
  });
}

// Satu helper untuk POST Storefront GraphQL.
async function storefrontPost(query) {
  const res = await fetch(SHOPIFY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Storefront API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors && json.errors.length) throw new Error('Storefront GraphQL: ' + JSON.stringify(json.errors));
  return json.data;
}

async function fetchShopifyProducts() {
  const data = await storefrontPost(PRODUCTS_QUERY);
  return (data.products.edges || []).map((e) => mapShopifyProduct(e.node));
}

async function fetchBrands() {
  const data = await storefrontPost(BRANDS_QUERY);
  return (data.metaobjects.edges || []).map((e) => mapShopifyBrand(e.node));
}

const BumiData = {
  PRODUCTS: [],
  BRANDS: [],
  loadError: false,
  _readyPromise: null,
  _metaBrands: [],

  // Size-label helpers shared with page-pdp.js / cart so display + matching
  // always use the same logic (single source of truth lives above).
  parseSizeMeta,
  translateSizeLabel,
  displaySize,
  heightToAge,

  // Resolves once the catalog fetch completes (or fails). Safe to call repeatedly.
  ready() {
    if (!this._readyPromise) this._readyPromise = this._load();
    return this._readyPromise;
  },

  // Produk & brand di-fetch paralel tapi independen (allSettled):
  // kegagalan brand (mis. definition/scope metaobject bermasalah) tidak
  // mengosongkan produk, dan sebaliknya. loadError hanya true kalau produk gagal.
  async _load() {
    const [prodRes, brandRes] = await Promise.allSettled([
      fetchShopifyProducts(),
      fetchBrands(),
    ]);
    if (prodRes.status === 'fulfilled') {
      this.PRODUCTS = prodRes.value;
      this.loadError = false;
    } else {
      console.error('BumiData: failed to load products from Shopify', prodRes.reason);
      this.PRODUCTS = [];
      this.loadError = true;
    }
    if (brandRes.status === 'fulfilled') {
      this._metaBrands = brandRes.value;
    } else {
      console.error('BumiData: failed to load brands from Shopify', brandRes.reason);
      this._metaBrands = [];
    }
    // Brands are rebuilt from the catalogue on every load so a newly imported
    // vendor shows up on /brands without anyone touching the metaobjects.
    this.BRANDS = buildBrands(this.PRODUCTS, this._metaBrands);
  },

  /* ── Lookup helpers ── */
  getProduct(id) {
    return this.PRODUCTS.find(p => p.id === id) || null;
  },

  getBrand(slug) {
    return this.BRANDS.find(b => b.slug === slug) || null;
  },

  /* Normalised brand identity — lets PLP match a checkbox (vendor name)
     against products without caring about "&" vs "and". */
  brandKey(name) {
    return normalizeBrandKey(name);
  },

  /* Brand lookup used by /products?brand=<slug>. Accepts a slug, a brand
     name, or a raw vendor string (all normalised through the same key). */
  resolveBrand(param) {
    const raw = String(param || '').trim();
    if (!raw) return null;
    const bySlug = this.BRANDS.find(b => b.slug === raw);
    if (bySlug) return bySlug;
    const key = normalizeBrandKey(raw);
    if (!key) return null;
    return this.BRANDS.find(b => b.key === key) || null;
  },

  /* Vendor names present in the catalogue with their product counts. */
  brandsFromProducts() {
    const counts = new Map();
    for (const p of this.PRODUCTS) {
      if (!p.brand) continue;
      counts.set(p.brand, (counts.get(p.brand) || 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  },

  /* Homepage "Collections" grid: newest first (by addedAt rank). */
  getFeatured(limit = 8) {
    return this.PRODUCTS.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, limit);
  },

  /* Related products: same category, excluding the current one. */
  getRelated(product, limit = 4) {
    if (!product) return [];
    return this.PRODUCTS
      .filter(p => p.id !== product.id && p.category === product.category)
      .slice(0, limit);
  },

  /* Map a nav/URL category to a filter predicate over PRODUCTS. */
  filterByCategory(category) {
    if (!category || category === 'all' || category === 'kids') return this.PRODUCTS.slice();
    if (category === 'new') return this.PRODUCTS.filter(p => p.isNew);
    if (category === 'sale') return this.PRODUCTS.filter(p => p.compareAt && p.compareAt > p.price);
    if (category === 'bestsellers') return this.PRODUCTS.filter(p => p.isBestseller);
    if (['girls', 'boys'].includes(category)) {
      return this.PRODUCTS.filter(p => p.audience === category || p.audience === 'unisex');
    }
    // otherwise treat as a product category (tshirts, dresses, ...)
    return this.PRODUCTS.filter(p => p.category === category);
  },

  /* Friendly heading copy per category. */
  categoryMeta(category) {
    const map = {
      girls:      { title: "Girls' Collection",  subtitle: 'Twirl-ready dresses, soft tees and playful layers for every adventure.' },
      boys:       { title: "Boys' Collection",   subtitle: 'Tough-but-comfy basics built for climbing, running and exploring.' },
      'busy-book': { title: 'The Busy Book',    subtitle: 'Soft, reusable activity books for screen-free, quiet-time play — handmade in Indonesia.' },
      new:        { title: 'New This Week',      subtitle: 'Fresh drops from our favourite Indonesian kids brands.' },
      sale:       { title: 'On Sale',            subtitle: 'Loved pieces at joyful prices — grab them before they grow out!' },
      bestsellers:{ title: 'Bestsellers',        subtitle: 'The pieces other families cannot stop loving.' },
      kids:       { title: "Kids' Collection",   subtitle: 'Colourful, comfy and made to last — delivered Australia-wide.' },
      all:        { title: "All Kids' Clothing", subtitle: 'Colourful, comfy and made to last — delivered Australia-wide.' }
    };
    return map[category] || { title: "Kids' Collection", subtitle: 'Colourful, comfy and made to last.' };
  },

  /* ── Formatting ──
     Delegates to BumiCurrency (AUD only).
     switch). Amounts are always AUD at source. */
  formatPrice(amount) {
    return BumiCurrency.format(amount);
  }
};

window.BumiData = BumiData;

// Eagerly start the fetch as soon as the script loads (parallel with page parsing).
BumiData.ready();
