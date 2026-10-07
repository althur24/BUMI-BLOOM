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

// ── Shopify Storefront config (public token, aman di browser) ──────────────
const SHOPIFY_SHOP = 'p9gcf7-wj';
const SHOPIFY_STOREFRONT_TOKEN = 'f221d7b0fcb996294ab2cb0732cf01b5';
const SHOPIFY_API_VERSION = '2026-10';

const SHOPIFY_ENDPOINT = `https://${SHOPIFY_SHOP}.myshopify.com/api/${SHOPIFY_API_VERSION}/graphql.json`;

// Query produk (semua field yang dipakai mapShopifyProduct).
const PRODUCTS_QUERY = `{
  products(first: 100) {
    edges {
      node {
        handle
        title
        description
        productType
        vendor
        featuredImage { url }
        images(first: 10) { edges { node { url } } }
        variants(first: 100) {
          edges {
            node {
              price { amount currencyCode }
              compareAtPrice { amount }
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

  const colors = safeParseJSON(meta.colors, []);
  const variants = (node.variants && node.variants.edges || []).map((e) => e.node);

  const sizes = [];
  variants.forEach((v) => {
    const size = (v.selectedOptions || []).find((o) => o.name === 'Size');
    if (size && size.value && !sizes.includes(size.value)) sizes.push(size.value);
  });

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
    if (category === 'essentials') return this.PRODUCTS.filter(p => ['tshirts', 'shorts', 'accessories'].includes(p.category));
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
      women:      { title: "Women's Casual",     subtitle: 'Easy, everyday pieces — soft, breathable and made to move.' },
      new:        { title: 'New This Week',      subtitle: 'Fresh drops from our favourite Indonesian kids brands.' },
      sale:       { title: 'On Sale',            subtitle: 'Loved pieces at joyful prices — grab them before they grow out!' },
      essentials: { title: 'Everyday Essentials',subtitle: 'The trusty basics you will reach for again and again.' },
      bestsellers:{ title: 'Bestsellers',        subtitle: 'The pieces other families cannot stop loving.' },
      kids:       { title: "Kids' Collection",   subtitle: 'Colourful, comfy and made to last — delivered Australia-wide.' },
      all:        { title: "All Kids' Clothing", subtitle: 'Colourful, comfy and made to last — delivered Australia-wide.' }
    };
    return map[category] || { title: "Kids' Collection", subtitle: 'Colourful, comfy and made to last.' };
  },

  /* ── Formatting ──
     Delegates to BumiCurrency (AUD by default, IDR via the header
     switch). Amounts are always GST-inclusive AUD at source. */
  formatPrice(amount) {
    return BumiCurrency.format(amount);
  }
};

window.BumiData = BumiData;

// Eagerly start the fetch as soon as the script loads (parallel with page parsing).
BumiData.ready();
