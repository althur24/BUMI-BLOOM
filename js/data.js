/* ============================================
   BUMI / BLOOM — Product Catalog (Kids)
   Single source of truth for products, brands and
   categories. Consumed by the PLP, PDP, homepage
   collection grid, wishlist and cart.

   Catalog sourced from
   indonesia_kidswear_top_sellers_revised_2026-07-15.xlsx
   (3 real Indonesian kidswear brands, 15 top-selling
   products). Prices are AUD (whole dollars, GST-
   inclusive), set by tier. Imagery uses existing
   category placeholders until authorized brand photos
   arrive.
   ============================================ */

const BumiData = {
  /* ── Brands ── */
  BRANDS: [
    { slug: 'bohopanna',   name: 'Bohopanna',     city: 'Indonesia', audience: 'girls',  website: 'https://bohopanna.com/',
      desc: 'Playful, comfy everyday kidswear in soft natural tones — breezy sets, easy tees and go-anywhere pants for little explorers.' },
    { slug: 'sabine-heem', name: 'Sabine & Heem', city: 'Indonesia', audience: 'boys',  website: 'https://www.sabineandheem.com/',
      desc: 'Considered linen and cotton pieces with hand-finished embroidery. Slow-made staples for kids with quiet, confident style.' },
    { slug: 'anakmu',      name: 'Anakmu',         city: 'Indonesia', audience: 'unisex', website: 'https://shopee.co.id/anakmu.id',
      desc: 'Soft, premium basics — fleece sweaters, organic tees and easy layers designed to mix, match and pass down.' }
  ],

  /* ── Products ──
     audience: girls | boys | baby | unisex   (drives Girls / Boys / Baby nav)
     category: tshirts | shorts | dresses | outerwear | accessories | baby
     price/compareAt: AUD whole dollars, GST-inclusive.
  */
  PRODUCTS: [
    {
      id: 'elliot-pant', name: 'Elliot Pant', brand: 'Bohopanna',
      audience: 'unisex', category: 'shorts', price: 15,
      colors: [{ name: 'Khaki', hex: '#B9A88A' }, { name: 'Black', hex: '#333333' }, { name: 'Stone', hex: '#C9BBA7' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/trousers.png',
      gallery: ['images/categories/trousers.png', 'images/categories/kids.png'],
      badge: 'bestseller', isNew: false, isBestseller: true, rating: 4.9, reviews: 312, addedAt: 15,
      description: 'Bohopanna’s most-loved everyday pant — an easy pull-on shape with a comfy elastic waist, built for playground days.',
      material: 'Soft everyday fabric. Machine wash cold.'
    },
    {
      id: 'basic-tee-girl', name: 'Basic Tee Girl', brand: 'Bohopanna',
      audience: 'girls', category: 'tshirts', price: 9, compareAt: 12,
      colors: [{ name: 'Sunny Peach', hex: '#F9B8AF' }, { name: 'Sky Blue', hex: '#96ADD6' }, { name: 'White', hex: '#FFFFFF' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/tshirts.png',
      gallery: ['images/categories/tshirts.png', 'images/categories/shirts.png'],
      badge: 'new', isNew: true, isBestseller: false, rating: 4.9, reviews: 208, addedAt: 14,
      description: 'A soft, tag-free cotton tee in cheerful colours — the everyday top she’ll reach for all week.',
      material: 'Soft everyday fabric. Machine wash cold.'
    },
    {
      id: 'pannadaily-set-girl', name: 'Pannadaily Set Kids Girl Print', brand: 'Bohopanna',
      audience: 'girls', category: 'dresses', price: 12,
      colors: [{ name: 'Print', hex: '#F9B8AF' }, { name: 'Pink', hex: '#F2D7D3' }],
      sizes: ['2T', '3T', '4T', '5'], image: 'images/categories/dresses.png',
      gallery: ['images/categories/dresses.png', 'images/categories/kids.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.9, reviews: 156, addedAt: 13,
      description: 'A breezy two-piece set in a playful print — ready in one grab for school mornings and weekend trips.',
      material: 'Soft everyday fabric. Machine wash cold.'
    },
    {
      id: 'pannadaily-playsuit', name: 'Pannadaily Playsuit Girl Print', brand: 'Bohopanna',
      audience: 'baby', category: 'baby', price: 12,
      colors: [{ name: 'Print', hex: '#F2D7D3' }, { name: 'Cream', hex: '#F7F3EE' }],
      sizes: ['6-12M', '12-18M', '18-24M'], image: 'images/categories/baby.png',
      gallery: ['images/categories/baby.png', 'images/categories/kids.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.9, reviews: 98, addedAt: 12,
      description: 'A snuggly printed playsuit with snap closures for easy changes. Comfy enough to crawl, cute enough for photos.',
      material: 'Soft everyday fabric. Machine wash cold.'
    },
    {
      id: 'barrel-jeans', name: 'Barrel Jeans', brand: 'Bohopanna',
      audience: 'unisex', category: 'shorts', price: 29, compareAt: 39,
      colors: [{ name: 'Denim', hex: '#6E8AC0' }, { name: 'Indigo', hex: '#00408C' }],
      sizes: ['2T', '3T', '4T', '5', '6', '7'], image: 'images/categories/trousers.png',
      gallery: ['images/categories/trousers.png', 'images/categories/kids.png'],
      badge: 'sale', isNew: false, isBestseller: false, rating: 4.9, reviews: 142, addedAt: 11,
      description: 'On-trend barrel-leg jeans in soft denim with a touch of stretch — tough enough for adventures, easy to move in.',
      material: 'Soft everyday fabric. Machine wash cold.'
    },
    {
      id: 'horse-linen-sashiko-shirt', name: 'HORSE Linen Sashiko Shirt', brand: 'Sabine & Heem',
      audience: 'boys', category: 'tshirts', price: 39,
      colors: [{ name: 'Natural', hex: '#EADFD3' }, { name: 'Black', hex: '#333333' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/shirts.png',
      gallery: ['images/categories/shirts.png', 'images/categories/tshirts.png'],
      badge: 'bestseller', isNew: false, isBestseller: true, rating: 5.0, reviews: 187, addedAt: 10,
      description: 'A breathable linen shirt with hand-finished sashiko stitching — slow-made polish for special everyday days.',
      material: 'Linen. Machine wash cold.'
    },
    {
      id: 'howdy-embroidery-tee', name: 'HOWDY Embroidery Tee', brand: 'Sabine & Heem',
      audience: 'boys', category: 'tshirts', price: 39,
      colors: [{ name: 'Cream', hex: '#F7F3EE' }, { name: 'Blue', hex: '#96ADD6' }],
      sizes: ['2T', '3T', '4T', '5'], image: 'images/categories/tshirts.png',
      gallery: ['images/categories/tshirts.png', 'images/categories/shirts.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.9, reviews: 76, addedAt: 9,
      description: 'A soft cotton tee with cheerful HOWDY embroidery. Laid-back, durable and made to last.',
      material: 'Cotton. Machine wash cold.'
    },
    {
      id: 'wonder-linen-shirt-black', name: 'WONDER Embroidery Linen Shirt — Black', brand: 'Sabine & Heem',
      audience: 'boys', category: 'tshirts', price: 39,
      colors: [{ name: 'Black', hex: '#333333' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/shirts.png',
      gallery: ['images/categories/shirts.png', 'images/categories/tshirts.png'],
      badge: null, isNew: false, isBestseller: false, rating: 5.0, reviews: 64, addedAt: 8,
      description: 'A classic linen shirt in black with embroidered detail — cool, crisp and endlessly versatile.',
      material: 'Linen. Machine wash cold.'
    },
    {
      id: 'na-willa-knitted-vest', name: 'NA WILLA Cotton Knitted Collar Vest — Polkadot', brand: 'Sabine & Heem',
      audience: 'girls', category: 'outerwear', price: 49,
      colors: [{ name: 'Polkadot', hex: '#F2D7D3' }, { name: 'Cream', hex: '#F7F3EE' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/outerwear.png',
      gallery: ['images/categories/outerwear.png', 'images/categories/kids.png'],
      badge: null, isNew: false, isBestseller: false, rating: 5.0, reviews: 41, addedAt: 7,
      description: 'A cotton knitted collar vest in a sweet polkadot knit — a layered finishing piece with handmade charm.',
      material: 'Cotton knit. Machine wash cold.'
    },
    {
      id: 'wonder-linen-shirt-white', name: 'WONDER Embroidery Linen Shirt — Broken White', brand: 'Sabine & Heem',
      audience: 'boys', category: 'tshirts', price: 39,
      colors: [{ name: 'Broken White', hex: '#F2EEE9' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/shirts.png',
      gallery: ['images/categories/shirts.png', 'images/categories/tshirts.png'],
      badge: null, isNew: false, isBestseller: false, rating: 5.0, reviews: 58, addedAt: 6,
      description: 'The WONDER linen shirt in broken white — warm, neutral and easy to pair with anything.',
      material: 'Linen. Machine wash cold.'
    },
    {
      id: 'piccolo-jacket', name: 'Piccolo Jacket', brand: 'Anakmu',
      audience: 'unisex', category: 'outerwear', price: 35, compareAt: 45,
      colors: [{ name: 'Navy', hex: '#00408C' }, { name: 'Slate', hex: '#8A8A8A' }, { name: 'Cream', hex: '#F2EEE9' }],
      sizes: ['2T', '3T', '4T', '5', '6', '7', '8'], image: 'images/categories/outerwear.png',
      gallery: ['images/categories/outerwear.png', 'images/categories/kids.png'],
      badge: 'bestseller', isNew: false, isBestseller: true, rating: 4.9, reviews: 421, addedAt: 5,
      description: 'A lightweight premium-polyester windbreaker that shrugs off wind and light rain. Packs small for day trips.',
      material: 'Premium polyester windbreaker. Machine wash cold.'
    },
    {
      id: 'torena-sweater', name: 'Torena Sweater — Plain Basic', brand: 'Anakmu',
      audience: 'unisex', category: 'outerwear', price: 29,
      colors: [{ name: 'Grey', hex: '#8A8A8A' }, { name: 'Cream', hex: '#F2EEE9' }, { name: 'Navy', hex: '#00408C' }],
      sizes: ['2T', '3T', '4T', '5', '6', '7', '8'], image: 'images/categories/outerwear.png',
      gallery: ['images/categories/outerwear.png', 'images/categories/kids.png'],
      badge: 'bestseller', isNew: false, isBestseller: true, rating: 4.9, reviews: 388, addedAt: 4,
      description: 'A super-soft premium fleece sweater in a plain, go-with-everything colour — cosy layering, made to last.',
      material: 'Premium cotton fleece. Machine wash cold.'
    },
    {
      id: 'gufi-rib-sweater', name: 'Gufi Rib Sweater — Plain Basic', brand: 'Anakmu',
      audience: 'unisex', category: 'outerwear', price: 29,
      colors: [{ name: 'Grey', hex: '#8A8A8A' }, { name: 'Peach', hex: '#F9B8AF' }],
      sizes: ['2T', '3T', '4T', '5'], image: 'images/categories/outerwear.png',
      gallery: ['images/categories/outerwear.png', 'images/categories/kids.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.9, reviews: 134, addedAt: 3,
      description: 'A fine cotton-knit sweater with a subtle rib texture — lightweight warmth for in-between weather.',
      material: 'Premium cotton knit. Machine wash cold.'
    },
    {
      id: 'organic-pocket-tee', name: 'Organic Pocket T-Shirt — Basic', brand: 'Anakmu',
      audience: 'unisex', category: 'tshirts', price: 12,
      colors: [{ name: 'White', hex: '#FFFFFF' }, { name: 'Navy', hex: '#00408C' }],
      sizes: ['2T', '3T', '4T', '5', '6', '7'], image: 'images/categories/tshirts.png',
      gallery: ['images/categories/tshirts.png', 'images/categories/shirts.png'],
      badge: 'new', isNew: true, isBestseller: false, rating: 4.9, reviews: 263, addedAt: 2,
      description: 'An organic cotton tee with a handy chest pocket — the blank-basic top that goes with everything.',
      material: 'Organic cotton. Machine wash cold.'
    },
    {
      id: 'brisa-cargo-pants', name: 'Brisa Cargo Pants', brand: 'Anakmu',
      audience: 'unisex', category: 'shorts', price: 25,
      colors: [{ name: 'Khaki', hex: '#B9A88A' }, { name: 'Black', hex: '#333333' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/trousers.png',
      gallery: ['images/categories/trousers.png', 'images/categories/kids.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.9, reviews: 119, addedAt: 1,
      description: 'Easy cargo pants with roomy pockets, built for kids on the move. Unisex fit for ages 1–7.',
      material: 'Cotton blend. Machine wash cold.'
    }
  ],

  /* ── Lookup helpers ── */
  getProduct(id) {
    return this.PRODUCTS.find(p => p.id === id) || null;
  },

  getBrand(slug) {
    return this.BRANDS.find(b => b.slug === slug) || null;
  },

  /* Products for the homepage "Collections" grid (a cheerful mix). */
  getFeatured(limit = 8) {
    const ids = ['elliot-pant', 'horse-linen-sashiko-shirt', 'piccolo-jacket', 'basic-tee-girl', 'pannadaily-set-girl', 'torena-sweater', 'wonder-linen-shirt-black', 'brisa-cargo-pants'];
    return ids.slice(0, limit).map(id => this.getProduct(id)).filter(Boolean);
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
