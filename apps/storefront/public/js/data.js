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
          {namespace:"bumi",key:"added_at_rank"}
        ]) { key value }
      }
    }
  }
}`;

// Query brand metaobjects.
const BRANDS_QUERY = `{
  metaobjects(type: "brand", first: 50) {
    edges { node { handle fields { key value } } }
  }
}`;

function safeParseJSON(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// Shopify Storefront product node → data.js product shape.
function mapShopifyProduct(node) {
  const meta = {};
  for (const m of (node.metafields || [])) if (m && m.key) meta[m.key] = m.value;

  const metaColors = safeParseJSON(meta.colors, []);
  const variants = (node.variants && node.variants.edges || []).map((e) => e.node);

  const sizes = [];
  variants.forEach((v) => {
    const size = optionValue(v.selectedOptions, SIZE_OPTION_NAMES);
    if (size && !sizes.includes(size)) sizes.push(size);
  });

  // Daftar varian lengkap (dipakai cart untuk dapat merchandiseId/GID saat checkout Shopify).
  const variantList = variants.map((v) => {
    const color = optionValue(v.selectedOptions, COLOR_OPTION_NAMES);
    const size = optionValue(v.selectedOptions, SIZE_OPTION_NAMES);
    return {
      id: v.id,
      color,
      size,
      price: parseFloat(v.price.amount),
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
  const compareAt = variants.length && variants[0].compareAtPrice ? parseFloat(variants[0].compareAtPrice.amount) : undefined;

  return {
    id: node.handle,
    name: node.title || '',
    brand: node.vendor || '',
    audience: (meta.audience || '').toLowerCase(),
    category: (node.productType || '').toLowerCase(),
    price: Math.round(priceAmt),
    compareAt: compareAt ? Math.round(compareAt) : undefined,
    fibre: meta.fibre || '',
    colors: Array.isArray(colors) ? colors : [],
    sizes,
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
    description: node.description || '',
    material: meta.material || '',
    sizeGuide: meta.size_guide || '',
    sizeChartImage: meta.size_chart_image || '',
    soldCount: meta.sold_count ? parseInt(meta.sold_count, 10) : 0,
  };
}

// Brand shape converter (sama dengan konsumen lama: slug/name/city/audience/website/desc).
function mapBrand(b) {
  return {
    slug: b.slug,
    name: b.name,
    city: b.city || 'Indonesia',
    audience: (b.audience || '').toLowerCase(),
    website: b.website || '',
    desc: b.shortDesc || '',
  };
}

// Shopify brand metaobject node → brand shape.
function mapShopifyBrand(node) {
  const f = {};
  for (const field of (node.fields || [])) if (field && field.key) f[field.key] = field.value;
  return mapBrand({
    slug: node.handle,
    name: f.name || '',
    city: f.city || 'Indonesia',
    audience: f.audience || '',
    website: f.website || '',
    shortDesc: f.desc || '',
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
      this.BRANDS = brandRes.value;
    } else {
      console.error('BumiData: failed to load brands from Shopify', brandRes.reason);
      this.BRANDS = [];
    }
  },

  /* ── Lookup helpers ── */
  getProduct(id) {
    return this.PRODUCTS.find(p => p.id === id) || null;
  },

  getBrand(slug) {
    return this.BRANDS.find(b => b.slug === slug) || null;
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
    if (['girls', 'boys', 'baby'].includes(category)) {
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
      baby:       { title: 'Baby Collection',    subtitle: 'Gentle, soft pieces for the littlest members of the family.' },
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
     switch). Amounts are always GST-inclusive AUD at source. */
  formatPrice(amount) {
    return BumiCurrency.format(amount);
  }
};

window.BumiData = BumiData;

// Storefront config dibuka untuk dipakai modul lain (cart.js createShopifyCart).
window.BumiShop = { endpoint: SHOPIFY_ENDPOINT, token: SHOPIFY_STOREFRONT_TOKEN };

// Eagerly start the fetch as soon as the script loads (parallel with page parsing).
BumiData.ready();
