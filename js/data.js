/* ============================================
   BUMI / BLOOM — Product Catalog (Kids)
   Single source of truth for products, brands and
   categories. Consumed by the PLP, PDP, homepage
   collection grid, wishlist and cart.
   ============================================ */

const BumiData = {
  /* ── Brands ── */
  BRANDS: [
    { slug: 'nara-kids',     name: 'Nara Kids',     city: 'Bandung',     audience: 'girls',  desc: 'Soft, joyful everyday pieces in breathable natural fabrics. Made for climbing, twirling and growing.' },
    { slug: 'kala-kids',     name: 'Kala Kids',     city: 'Yogyakarta',  audience: 'boys',   desc: 'Playful, durable basics that survive every adventure. Organic cotton and natural dyes.' },
    { slug: 'tanah-kids',    name: 'Tanah Kids',    city: 'Jakarta',     audience: 'girls',  desc: 'Modern kids wear with clean lines and a pop of colour for confident little personalities.' },
    { slug: 'sawah-kids',    name: 'Sawah Kids',    city: 'Surabaya',    audience: 'boys',   desc: 'Outdoor-inspired casual wear that moves with active kids, from school run to weekend park.' },
    { slug: 'benang-junior', name: 'Benang Junior', city: 'Bandung',     audience: 'unisex', desc: 'Essential tees, layers and loungewear that feel like a second skin. Quality fabrics, perfect fits.' },
    { slug: 'rumah-junior',  name: 'Rumah Junior',  city: 'Bali',        audience: 'unisex', desc: 'Whimsical, hand-finished accessories and statement pieces crafted by skilled local artisans.' }
  ],

  /* ── Products ──
     audience: girls | boys | baby | unisex   (drives Girls / Boys / Baby nav)
     category: tshirts | shorts | dresses | outerwear | accessories | baby
  */
  PRODUCTS: [
    {
      id: 'sunny-day-cotton-tee', name: 'Sunny Day Cotton Tee', brand: 'Nara Kids',
      audience: 'girls', category: 'tshirts', price: 189000, compareAt: 249000,
      colors: [{ name: 'Sunny Yellow', hex: '#FFD93D' }, { name: 'Sky Blue', hex: '#4FC3F7' }, { name: 'Coral', hex: '#FF6B6B' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/tshirts.png',
      gallery: ['images/categories/tshirts.png', 'images/categories/shirts.png', 'images/categories/kids.png'],
      badge: 'new', isNew: true, isBestseller: false, rating: 4.8, reviews: 124, addedAt: 18,
      description: 'A buttery-soft cotton tee with a cheerful sunny print. Pre-shrunk and tagless so it is ready for all-day play.',
      material: '100% organic cotton. Machine wash cold, tumble dry low.'
    },
    {
      id: 'explorer-cargo-shorts', name: 'Explorer Cargo Shorts', brand: 'Kala Kids',
      audience: 'boys', category: 'shorts', price: 159000,
      colors: [{ name: 'Khaki', hex: '#C4B5A0' }, { name: 'Olive', hex: '#6BCB77' }],
      sizes: ['2T', '3T', '4T', '5', '6', '7'], image: 'images/categories/trousers.png',
      gallery: ['images/categories/trousers.png', 'images/categories/kids.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.6, reviews: 88, addedAt: 8,
      description: 'Lightweight cargo shorts with roomy pockets for every treasure. Reinforced knees for endless exploring.',
      material: 'Cotton twill. Machine wash cold.'
    },
    {
      id: 'rainbow-twirl-dress', name: 'Rainbow Twirl Dress', brand: 'Tanah Kids',
      audience: 'girls', category: 'dresses', price: 289000, compareAt: 389000,
      colors: [{ name: 'Rainbow', hex: '#FF6B6B' }, { name: 'Lilac', hex: '#9B59B6' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/dresses.png',
      gallery: ['images/categories/dresses.png', 'images/categories/kids.png'],
      badge: 'bestseller', isNew: false, isBestseller: true, rating: 4.9, reviews: 212, addedAt: 6,
      description: 'A full-skirted twirl dress in airy cotton. The kind of dress that makes every day feel like a celebration.',
      material: '100% cotton. Machine wash cold, hang dry.'
    },
    {
      id: 'ocean-breeze-polo', name: 'Ocean Breeze Polo', brand: 'Sawah Kids',
      audience: 'boys', category: 'tshirts', price: 219000,
      colors: [{ name: 'Ocean Blue', hex: '#4FC3F7' }, { name: 'White', hex: '#FFFFFF' }],
      sizes: ['3T', '4T', '5', '6', '7'], image: 'images/categories/shirts.png',
      gallery: ['images/categories/shirts.png', 'images/categories/tshirts.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.5, reviews: 64, addedAt: 10,
      description: 'A smart-casual polo in breathable pique cotton. Polished enough for outings, comfy enough for the playground.',
      material: 'Cotton pique. Machine wash cold.'
    },
    {
      id: 'adventure-zip-hoodie', name: 'Adventure Zip Hoodie', brand: 'Benang Junior',
      audience: 'boys', category: 'outerwear', price: 299000, compareAt: 399000,
      colors: [{ name: 'Forest', hex: '#6BCB77' }, { name: 'Slate', hex: '#4A4A4A' }],
      sizes: ['2T', '3T', '4T', '5', '6', '7'], image: 'images/categories/outerwear.png',
      gallery: ['images/categories/outerwear.png', 'images/categories/kids.png'],
      badge: 'sale', isNew: false, isBestseller: true, rating: 4.7, reviews: 156, addedAt: 5,
      description: 'A cozy zip-up hoodie with a snug hood and kangaroo pockets. The go-to layer for cool mornings.',
      material: 'Cotton fleece. Machine wash cold.'
    },
    {
      id: 'garden-party-frock', name: 'Garden Party Frock', brand: 'Rumah Junior',
      audience: 'girls', category: 'dresses', price: 349000,
      colors: [{ name: 'Petal Pink', hex: '#FFB5C2' }, { name: 'Buttercream', hex: '#FFF8F0' }],
      sizes: ['2T', '3T', '4T', '5'], image: 'images/categories/dresses.png',
      gallery: ['images/categories/dresses.png', 'images/categories/kids.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.8, reviews: 47, addedAt: 9,
      description: 'A hand-finished party frock with delicate embroidery. Special-occasion magic that is still comfy enough to move in.',
      material: 'Cotton blend. Hand wash recommended.'
    },
    {
      id: 'rainbow-beanie-hat', name: 'Rainbow Beanie Hat', brand: 'Kala Kids',
      audience: 'unisex', category: 'accessories', price: 129000,
      colors: [{ name: 'Rainbow', hex: '#FF6B6B' }, { name: 'Sunshine', hex: '#FFD93D' }],
      sizes: ['One Size'], image: 'images/categories/accessories.png',
      gallery: ['images/categories/accessories.png'],
      badge: 'new', isNew: true, isBestseller: false, rating: 4.6, reviews: 33, addedAt: 17,
      description: 'A stretchy knit beanie that keeps little ears warm and adds a pop of colour to any outfit.',
      material: 'Acrylic knit. Machine wash cold.'
    },
    {
      id: 'playtime-jogger-shorts', name: 'Playtime Jogger Shorts', brand: 'Nara Kids',
      audience: 'boys', category: 'shorts', price: 179000, compareAt: 229000,
      colors: [{ name: 'Slate', hex: '#4A4A4A' }, { name: 'Coral', hex: '#FF6B6B' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/trousers.png',
      gallery: ['images/categories/trousers.png'],
      badge: 'sale', isNew: false, isBestseller: false, rating: 4.4, reviews: 51, addedAt: 4,
      description: 'Soft jogger shorts with an elastic waist and drawstring. Effortless comfort for lounging and playing.',
      material: 'Cotton fleece. Machine wash cold.'
    },
    {
      id: 'cloud-soft-baby-onesie', name: 'Cloud Soft Baby Onesie', brand: 'Nara Kids',
      audience: 'baby', category: 'baby', price: 149000,
      colors: [{ name: 'Cloud White', hex: '#FFFFFF' }, { name: 'Mint', hex: '#D4F5D9' }, { name: 'Petal', hex: '#FFB5C2' }],
      sizes: ['0-3M', '3-6M', '6-12M', '12-18M'], image: 'images/categories/baby.png',
      gallery: ['images/categories/baby.png', 'images/categories/kids.png'],
      badge: 'new', isNew: true, isBestseller: true, rating: 4.9, reviews: 189, addedAt: 16,
      description: 'An ultra-soft onesie in GOTS-certified organic cotton with easy snap closures. Gentle on the most sensitive skin.',
      material: 'GOTS organic cotton. Machine wash cold.'
    },
    {
      id: 'tiny-explorer-overalls', name: 'Tiny Explorer Overalls', brand: 'Sawah Kids',
      audience: 'baby', category: 'baby', price: 259000,
      colors: [{ name: 'Denim', hex: '#4FC3F7' }, { name: 'Oatmeal', hex: '#F5E0CC' }],
      sizes: ['6-12M', '12-18M', '18-24M'], image: 'images/categories/baby.png',
      gallery: ['images/categories/baby.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.7, reviews: 72, addedAt: 11,
      description: 'Adjustable corduroy overalls with a roomy front pocket. Cute, practical and built to be handed down.',
      material: 'Cotton corduroy. Machine wash cold.'
    },
    {
      id: 'sunny-smiles-sundress', name: 'Sunny Smiles Sundress', brand: 'Tanah Kids',
      audience: 'girls', category: 'dresses', price: 229000,
      colors: [{ name: 'Marigold', hex: '#FFD93D' }, { name: 'Coral', hex: '#FF6B6B' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/dresses.png',
      gallery: ['images/categories/dresses.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.6, reviews: 58, addedAt: 7,
      description: 'A breezy sundress with crossed straps and a relaxed fit. Summer-ready and endlessly twirlable.',
      material: '100% cotton. Machine wash cold.'
    },
    {
      id: 'cozy-star-pajama-set', name: 'Cozy Star Pajama Set', brand: 'Benang Junior',
      audience: 'unisex', category: 'tshirts', price: 199000,
      colors: [{ name: 'Night Sky', hex: '#4A4A4A' }, { name: 'Lilac', hex: '#9B59B6' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/tshirts.png',
      gallery: ['images/categories/tshirts.png'],
      badge: 'bestseller', isNew: false, isBestseller: true, rating: 4.8, reviews: 143, addedAt: 12,
      description: 'A two-piece pajama set in snuggly brushed cotton, printed with sleepy stars. Sweet dreams guaranteed.',
      material: 'Brushed cotton. Machine wash cold.'
    },
    {
      id: 'splash-time-swim-shorts', name: 'Splash Time Swim Shorts', brand: 'Kala Kids',
      audience: 'boys', category: 'shorts', price: 169000,
      colors: [{ name: 'Reef Blue', hex: '#4FC3F7' }, { name: 'Coral', hex: '#FF6B6B' }],
      sizes: ['3T', '4T', '5', '6', '7'], image: 'images/categories/trousers.png',
      gallery: ['images/categories/trousers.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.5, reviews: 39, addedAt: 13,
      description: 'Quick-drying swim shorts with a comfy elastic waist and inner liner. Pool and beach ready.',
      material: 'Recycled polyester. Rinse after use.'
    },
    {
      id: 'little-hero-cape-tee', name: 'Little Hero Cape Tee', brand: 'Rumah Junior',
      audience: 'boys', category: 'tshirts', price: 179000,
      colors: [{ name: 'Hero Red', hex: '#FF6B6B' }, { name: 'Sky', hex: '#4FC3F7' }],
      sizes: ['3T', '4T', '5', '6'], image: 'images/categories/tshirts.png',
      gallery: ['images/categories/tshirts.png'],
      badge: 'new', isNew: true, isBestseller: false, rating: 4.7, reviews: 28, addedAt: 15,
      description: 'A graphic tee with a secret: a detachable cape that turns any moment into a superhero adventure.',
      material: '100% cotton. Machine wash cold.'
    },
    {
      id: 'blossom-cardigan', name: 'Blossom Cardigan', brand: 'Tanah Kids',
      audience: 'girls', category: 'outerwear', price: 329000,
      colors: [{ name: 'Blossom', hex: '#FFB5C2' }, { name: 'Buttercream', hex: '#FFF8F0' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/outerwear.png',
      gallery: ['images/categories/outerwear.png'],
      badge: null, isNew: false, isBestseller: false, rating: 4.6, reviews: 44, addedAt: 14,
      description: 'A lightweight button-up cardigan with a delicate embroidered bloom. The perfect layer for in-between weather.',
      material: 'Cotton blend. Machine wash cold.'
    },
    {
      id: 'mini-backpack', name: 'Mini Backpack', brand: 'Sawah Kids',
      audience: 'unisex', category: 'accessories', price: 239000,
      colors: [{ name: 'Mustard', hex: '#FFD93D' }, { name: 'Forest', hex: '#6BCB77' }],
      sizes: ['One Size'], image: 'images/categories/accessories.png',
      gallery: ['images/categories/accessories.png'],
      badge: 'bestseller', isNew: false, isBestseller: true, rating: 4.9, reviews: 167, addedAt: 3,
      description: 'A pint-sized backpack with padded straps and just enough room for snacks, a water bottle and a favourite toy.',
      material: 'Water-resistant canvas. Wipe clean.'
    },
    {
      id: 'forest-friend-graphic-tee', name: 'Forest Friend Graphic Tee', brand: 'Benang Junior',
      audience: 'unisex', category: 'tshirts', price: 189000, compareAt: 239000,
      colors: [{ name: 'Pine', hex: '#6BCB77' }, { name: 'Oatmeal', hex: '#F5E0CC' }],
      sizes: ['2T', '3T', '4T', '5', '6'], image: 'images/categories/tshirts.png',
      gallery: ['images/categories/tshirts.png'],
      badge: 'sale', isNew: false, isBestseller: false, rating: 4.5, reviews: 61, addedAt: 2,
      description: 'A cosy graphic tee starring a cheerful forest friend. Printed with non-toxic, water-based inks.',
      material: '100% organic cotton. Machine wash cold.'
    },
    {
      id: 'twinkle-toes-sock-set', name: 'Twinkle Toes Sock Set', brand: 'Rumah Junior',
      audience: 'baby', category: 'accessories', price: 89000,
      colors: [{ name: 'Assorted', hex: '#FFB5C2' }],
      sizes: ['0-6M', '6-12M', '12-24M'], image: 'images/categories/accessories.png',
      gallery: ['images/categories/accessories.png'],
      badge: 'new', isNew: true, isBestseller: false, rating: 4.7, reviews: 54, addedAt: 1,
      description: 'A set of three cosy socks with grippy soles and anti-slip stars. Tiny toes, big comfort.',
      material: 'Cotton blend with grip dots. Machine wash cold.'
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
    const ids = ['sunny-day-cotton-tee', 'explorer-cargo-shorts', 'rainbow-twirl-dress', 'ocean-breeze-polo', 'adventure-zip-hoodie', 'garden-party-frock', 'rainbow-beanie-hat', 'playtime-jogger-shorts'];
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
      baby:       { title: 'Baby Collection',    subtitle: 'Gentle, GOTS-organic pieces for the littlest members of the family.' },
      new:        { title: 'New This Week',      subtitle: 'Fresh drops from our favourite Indonesian kids brands.' },
      sale:       { title: 'On Sale',            subtitle: 'Loved pieces at joyful prices — grab them before they grow out!' },
      essentials: { title: 'Everyday Essentials',subtitle: 'The trusty basics you will reach for again and again.' },
      bestsellers:{ title: 'Bestsellers',        subtitle: 'The pieces other families cannot stop loving.' },
      kids:       { title: "Kids' Collection",   subtitle: 'Playful, comfortable and made to last — curated kids fashion from Indonesia.' },
      all:        { title: "All Kids' Clothing", subtitle: 'Playful, comfortable and made to last — curated kids fashion from Indonesia.' }
    };
    return map[category] || { title: "Kids' Collection", subtitle: 'Playful, comfortable and made to last.' };
  },

  /* ── Formatting ── */
  formatPrice(amount) {
    return 'Rp' + Number(amount).toLocaleString('id-ID');
  }
};

window.BumiData = BumiData;
