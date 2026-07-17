/* ============================================
   BUMI / BLOOM — Product Catalog (Kids)
   Storefront data facade.

   Loads published products and brands from Supabase
   (anon key + RLS) once per page load, caches them in
   the SAME shape the PLP, PDP, homepage grid, wishlist
   and cart already consume, and exposes the same
   synchronous BumiData API.

   `id` === Product.slug, kept stable so cart/wishlist
   and ?id= URLs keep working. Load-time renderers must
   `await BumiData.ready()` before reading; click-time
   consumers (cart add, wishlist move) run after load.
   ============================================ */

const PLACEHOLDER_IMG = 'images/placeholder.png';

// Supabase Product (+relations) → data.js product shape.
function mapProduct(p) {
  const rawImgs = (p.ProductImage || []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const gallery = rawImgs.map((i) => i.MediaAsset && i.MediaAsset.publicUrl).filter(Boolean);
  const primary = rawImgs.find((i) => i.isPrimary) || rawImgs[0];
  const image = (primary && primary.MediaAsset && primary.MediaAsset.publicUrl) || gallery[0] || PLACEHOLDER_IMG;

  const colors = (p.ProductColor || [])
    .slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => ({ name: c.name, hex: c.hex || '#cccccc' }));

  // Variants are one row per color×size — de-dupe sizes, preserve first-seen order.
  const sizes = [];
  (p.ProductVariant || []).forEach((v) => {
    if (v.size && !sizes.includes(v.size)) sizes.push(v.size);
  });

  return {
    id: p.slug,
    name: p.name || '',
    brand: (p.Brand && p.Brand.name) || '',
    audience: (p.audience || '').toLowerCase(),
    category: (p.category || '').toLowerCase(),
    price: Math.round((p.priceAudCents || 0) / 100),
    compareAt: p.compareAtAudCents ? Math.round(p.compareAtAudCents / 100) : undefined,
    fibre: p.fibre || '',
    colors,
    sizes,
    image,
    gallery: gallery.length ? gallery : [image],
    badge: p.badge ? String(p.badge).toLowerCase() : null,
    isNew: !!p.isNew,
    isBestseller: !!p.isBestseller,
    rating: p.rating || 0,
    reviews: p.reviewsCount || 0,
    addedAt: p.addedAtRank != null ? p.addedAtRank : (p.createdAt ? Date.parse(p.createdAt) : 0),
    description: p.description || '',
    material: p.material || '',
  };
}

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

  async _load() {
    if (!window.bbSupabase) {
      this.loadError = true;
      return;
    }
    try {
      const supabase = window.bbSupabase.getClient();
      const [productsRes, brandsRes] = await Promise.all([
        supabase.from('Product').select(`
          id,slug,name,fibre,material,description,priceAudCents,compareAtAudCents,
          badge,isNew,isBestseller,rating,reviewsCount,addedAtRank,audience,category,createdAt,
          Brand(name),
          ProductColor(name,hex,sortOrder),
          ProductVariant(size),
          ProductImage(sortOrder,isPrimary,MediaAsset(publicUrl))
        `).eq('status', 'PUBLISHED'),
        supabase.from('Brand').select('slug,name,city,audience,website,shortDesc')
          .eq('status', 'PUBLISHED').order('name'),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (brandsRes.error) throw brandsRes.error;

      this.PRODUCTS = (productsRes.data || []).map(mapProduct);
      this.BRANDS = (brandsRes.data || []).map(mapBrand);
    } catch (err) {
      console.error('BumiData: failed to load catalog from Supabase', err);
      this.loadError = true;
      this.PRODUCTS = [];
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

  /* Homepage "Collections" grid: newest first (Product has no isFeatured field). */
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
     AUD, whole dollars for products; cents when fractional
     (shipping / discounts). All prices are GST-inclusive. */
  formatPrice(amount) {
    const n = Number(amount);
    return '$' + (Number.isInteger(n)
      ? n.toLocaleString('en-AU')
      : n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
};

window.BumiData = BumiData;

// Eagerly start the fetch as soon as the script loads (parallel with page parsing).
BumiData.ready();
