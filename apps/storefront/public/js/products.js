/* ============================================
   BUMI / BLOOM — Product Listing & Rendering
   - Renders the PLP grid from BumiData.PRODUCTS
   - Real filtering (type, age, colour, price, brand)
   - Real sorting, URL search & category routing
   - Renders the homepage "Collections" grid
   ============================================ */

function __bbProductsInit() {
  if (!window.BumiData) return;
  BumiData.ready().then(() => {
    if (document.getElementById('product-grid')) initPLP();
    if (document.querySelector('.hero-arch-card[data-hero-slot]')) initHeroArchCards();
    if (document.getElementById('busy-book-grid')) {
      initBusyBookGrid();
      window.addEventListener('currency-updated', initBusyBookGrid);
    }
    if (document.getElementById('collection-grid')) {
      initHomeCollection();
      window.addEventListener('currency-updated', initHomeCollection);
    }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __bbProductsInit);
else __bbProductsInit();

/* ---------- Shared rendering ---------- */

const BG_CYCLE = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'];

function bbEscapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function bbSafeHex(value) {
  const hex = String(value || '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : '#CCCCCC';
}

function wishlisted(id) {
  return window.BumiWishlist ? BumiWishlist.isWishlisted(id) : false;
}

// Status badge priority: Sold Out > New > Bestseller > Low Stock. The discount
// badge is independent: whenever the compare-at price is higher than the price
// it is shown alongside the status badge, so a product that is both "New" and
// on sale advertises both. The percentage uses the unrounded values so a
// rounded card price never yields a wrong number.
function badgeHTML(product) {
  if (product.soldOut) {
    return `<span class="product-card__badge product-card__badge--soldout">Sold Out</span>`;
  }

  const badges = [];
  if (product.badge === 'new') badges.push(`<span class="product-card__badge product-card__badge--new">New</span>`);
  else if (product.badge === 'bestseller') badges.push(`<span class="product-card__badge product-card__badge--bestseller">Bestseller</span>`);
  else if (product.badge === 'low-stock') badges.push(`<span class="product-card__badge product-card__badge--bestseller">Low Stock</span>`);

  const now = Number(product.priceRaw != null ? product.priceRaw : product.price);
  const was = Number(product.compareAtRaw != null ? product.compareAtRaw : product.compareAt);
  if (Number.isFinite(now) && Number.isFinite(was) && now > 0 && was > now) {
    const pct = Math.max(1, Math.round((1 - now / was) * 100));
    badges.push(`<span class="product-card__badge product-card__badge--sale" aria-label="${pct} percent off">-${pct}%</span>`);
  }

  if (!badges.length) return '';
  return `<div class="product-card__badges">${badges.join('')}</div>`;
}

function productCardHTML(product, index) {
  const bg = BG_CYCLE[index % BG_CYCLE.length];
  const soldOut = product.soldOut === true;
  const active = wishlisted(product.id) ? ' is-active' : '';
  const fill = wishlisted(product.id) ? 'currentColor' : 'none';
  const onSale = product.compareAt && product.compareAt > product.price;
  // "From" only makes sense at full price: on sale the headline is the
  // discounted variant's price, which is not necessarily the cheapest, so a
  // "From" prefix there would misstate the lowest price.
  const fromPrefix = product.priceFrom && !onSale ? 'From ' : '';
  const priceHTML = onSale
    ? `${fromPrefix}${BumiData.formatPrice(product.price)} <span class="product-card__price--original">${BumiData.formatPrice(product.compareAt)}</span>`
    : `${fromPrefix}${BumiData.formatPrice(product.price)}`;

  const swatches = (product.colors || []).slice(0, 4).map(c =>
    `<span class="product-card__swatch" style="background:${bbSafeHex(c.hex)};" title="${bbEscapeHtml(c.name)}"></span>`
  ).join('');

  const ratingHTML = product.rating
    ? `<span class="product-card__rating" aria-label="Rated ${product.rating} out of 5">★ ${Number(product.rating).toFixed(1)}${product.reviews ? ` <span class="product-card__rating-count">(${product.reviews})</span>` : ''}</span>`
    : '';

  return `
    <article class="product-card product-card--bg-${bg}${soldOut ? ' product-card--sold-out' : ''}" data-id="${product.id}" data-category="${product.category}">
      <div class="product-card__image-wrap">
        <img src="${product.image}" alt="${product.name}" class="product-card__image" loading="lazy">
        ${badgeHTML(product)}
        <button class="product-card__wishlist${active}" data-id="${product.id}" aria-label="Save ${product.name} to wishlist" type="button">
          <svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
      <div class="product-card__info">
        <p class="product-card__brand">${product.brand}</p>
        <h3 class="product-card__name"><a class="product-card__link" href="/products/${product.id}">${product.name}</a></h3>
        ${ratingHTML}
        <p class="product-card__price${onSale ? ' product-card__price--sale' : ''}">${priceHTML}</p>
        ${product.fibre ? `<span class="product-card__material">${product.fibre}</span>` : ''}
        ${swatches ? `<div class="product-card__swatches">${swatches}</div>` : ''}
        <button class="btn btn--primary btn--sm product-card__add" data-id="${product.id}" type="button"${soldOut ? ' disabled' : ''}>${soldOut ? 'Sold Out' : 'Add to Bag'}</button>
      </div>
    </article>
  `;
}

function emptyHTML(message) {
  return `<div style="grid-column:1/-1;text-align:center;padding:var(--space-16) var(--space-4);">
    <p style="font-family:var(--font-accent);font-size:var(--text-3xl);color:var(--color-coral);margin-bottom:var(--space-2);">Oops!</p>
    <p style="opacity:0.7;">${message}</p>
    <a href="/products" class="btn btn--primary" style="margin-top:var(--space-6);">View All Products</a>
  </div>`;
}

/* ---------- Homepage "Collections" grid ---------- */

function initHomeCollection() {
  const grid = document.getElementById('collection-grid');
  const featured = BumiData.getFeatured(8);
  grid.innerHTML = featured.map((p, i) => productCardHTML(p, i)).join('');
  if (window.BumiTrack) {
    BumiTrack.event('view_item_list', { item_list_name: 'Homepage collection',
      items: featured.map(p => ({ id: p.id, name: p.name, price: p.price })) });
  }
}

/* ---------- Homepage hero arch cards (admin-managed) ---------- */

// Slots 1/3/5 of the hero arch fan can show a curated product instead of the
// default illustration. The selection comes from the admin app (Supabase);
// the product data itself is already in BumiData (single Shopify fetch), so
// this only swaps the image and wraps it in a link to the PDP. Any failure
// (network, missing product, empty slot) silently keeps the default
// illustration — the hero never breaks.
function initHeroArchCards() {
  const adminApi = (window.BumiConfig && BumiConfig.adminApiUrl)
    || (window.__BB_PUBLIC_ENV__ && window.__BB_PUBLIC_ENV__.checkoutApiUrl)
    || 'http://localhost:4001';

  fetch(adminApi + '/api/hero-cards')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const cards = (data && data.cards) || [];
      cards.forEach((card) => {
        if (!card || !card.productHandle) return;
        const el = document.querySelector('.hero-arch-card[data-hero-slot="' + card.position + '"]');
        const product = BumiData.getProduct(card.productHandle);
        if (!el || !product || !product.image) return;

        const img = el.querySelector('img');
        if (!img) return;
        img.src = product.image;
        img.alt = product.name;
        img.removeAttribute('loading');

        el.classList.add('hero-arch-card--product');
        const link = document.createElement('a');
        link.className = 'hero-arch-card__link';
        link.href = '/products/' + product.id;
        link.setAttribute('aria-label', product.name);
        img.replaceWith(link);
        link.appendChild(img);
      });
    })
    .catch(() => { /* admin unreachable → default illustrations stay */ });
}

/* ---------- Busy Book page grid ---------- */

function initBusyBookGrid() {
  const grid = document.getElementById('busy-book-grid');
  if (!grid) return;
  const section = grid.closest('section');

  if (BumiData.loadError) {
    grid.innerHTML = emptyHTML("We couldn't load our busy books just now — please check your connection and try again shortly.");
    return;
  }

  const list = BumiData.filterByCategory('busy-book');

  // No busy books pushed yet: hide the shop section entirely so the page
  // gracefully falls back to the pure marketing layout.
  if (!list.length) {
    if (section) section.style.display = 'none';
    return;
  }
  if (section) section.style.display = '';

  grid.innerHTML = list.map((p, i) => productCardHTML(p, i)).join('');
  if (window.BumiTrack) {
    BumiTrack.event('view_item_list', { item_list_name: 'Busy Book collection',
      items: list.map(p => ({ id: p.id, name: p.name, price: p.price })) });
  }
}

/* ---------- PLP ---------- */

const PAGE_SIZE = 9;
const PRICE_BANDS = {
  under15: { min: 0, max: 15 },
  '15-30': { min: 15, max: 30 },
  '30-45': { min: 30, max: 45 },
  above45: { min: 45, max: Infinity }
};

// Filter chips are generated from the catalogue so imported sizes/colours
// (e.g. "S (1–2 yrs)", "Butter") appear without code changes.
//
// The Size filter is presented as "Shop by Age": shoppers think in ages, not in
// supplier size codes, and the catalogue mixes letter sizes, height codes and
// age ranges. Ages are bucketed into fixed year ranges and matched by overlap,
// so a product sized "S (1–2 yrs)" and another sized "100 cm (3–4 yrs)" land in
// the same bucket language instead of two unrelated chips.
const AGE_BUCKETS = [
  { key: '0-1', label: '0–1 yrs', min: 0, max: 1 },
  { key: '1-2', label: '1–2 yrs', min: 1, max: 2 },
  { key: '2-3', label: '2–3 yrs', min: 2, max: 3 },
  { key: '3-4', label: '3–4 yrs', min: 3, max: 4 },
  { key: '4-5', label: '4–5 yrs', min: 4, max: 5 },
  { key: '5-6', label: '5–6 yrs', min: 5, max: 6 },
  { key: '6-8', label: '6–8 yrs', min: 6, max: 8 },
  { key: '8-10', label: '8–10 yrs', min: 8, max: 10 },
  { key: '10-12', label: '10–12 yrs', min: 10, max: 12 },
];

// "1–2 yrs" / "12–18 months" / "1 yr" → [min, max] in years. Returns null when
// the string carries no age (a letter size, "Adult", etc.).
function bbYearsFromAge(age) {
  const s = String(age || '').toLowerCase();
  if (!s) return null;
  const range = s.match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*(yrs?|years?|months?|bln|bulan)/);
  if (range) {
    const div = /month|bln|bulan/.test(range[3]) ? 12 : 1;
    return [Number(range[1]) / div, Number(range[2]) / div];
  }
  const single = s.match(/(\d+(?:\.\d+)?)\s*(yrs?|years?|months?|bln|bulan)/);
  if (single) {
    const div = /month|bln|bulan/.test(single[2]) ? 12 : 1;
    const v = Number(single[1]) / div;
    return [v, v];
  }
  return null;
}

// Age span of a product, in years, from its RAW size values (the display labels
// drop weight/height detail but keep the age). A single-year size ("2 yr") is
// widened by one year *before* aggregating, so a product sized "1 yr" + "2 yr"
// covers 1–3 yrs and shows under both the 1–2 and 2–3 buckets instead of only
// the lower one.
function bbProductAgeRange(product) {
  const raws = Array.isArray(product.sizesRaw) && product.sizesRaw.length
    ? product.sizesRaw
    : (product.sizes || []);
  let min = null;
  let max = null;
  for (const raw of raws) {
    const meta = BumiData.parseSizeMeta ? BumiData.parseSizeMeta(raw) : null;
    if (!meta || meta.adult) continue;
    const range = bbYearsFromAge(meta.age || raw);
    if (!range) continue;
    if (range[1] <= range[0]) range[1] = range[0] + 1;
    min = min == null ? range[0] : Math.min(min, range[0]);
    max = max == null ? range[1] : Math.max(max, range[1]);
  }
  if (min == null) return null;
  if (max <= min) max = min + 1;
  return { min, max };
}

function bbAgeBucketsFor(product) {
  const range = bbProductAgeRange(product);
  if (!range) return [];
  return AGE_BUCKETS.filter((b) => range.min < b.max && range.max > b.min);
}

function renderAgeFilter() {
  const wrap = document.getElementById('plp-age-options');
  if (!wrap) return;

  const counts = new Map();
  (BumiData.PRODUCTS || []).forEach((product) => {
    bbAgeBucketsFor(product).forEach((b) => counts.set(b.key, (counts.get(b.key) || 0) + 1));
  });

  const available = AGE_BUCKETS.filter((b) => (counts.get(b.key) || 0) > 0);
  const section = wrap.closest('.plp-sidebar__section');
  if (section) section.style.display = available.length ? '' : 'none';

  wrap.innerHTML = available
    .map((b) => `<label><input type="checkbox" name="age" value="${b.key}"> <span>${b.label}</span> <span class="plp-sidebar__count">(${counts.get(b.key)})</span></label>`)
    .join('');
}

function renderDynamicFilters() {
  const brands = new Set();

  (BumiData.PRODUCTS || []).forEach((product) => {
    if (product.brand) brands.add(String(product.brand));
  });

  renderAgeFilter();

  const brandWrap = document.getElementById('plp-brand-options');
  if (brandWrap) {
    // Brand filter options are listed alphabetically (BumiData.getBrands).
    // One checkbox per brand record; its value is the brand's canonical name,
    // and the change handler normalises it back to a key — so a name/vendor
    // mismatch still matches the products.
    const listed = new Set();
    const entries = [];
    BumiData.getBrands().forEach((b) => {
      const label = b.name || (b.vendors && b.vendors[0]) || '';
      const key = b.key || BumiData.brandKey(label);
      if (!key || listed.has(key)) return;
      listed.add(key);
      entries.push({ value: label || b.slug || key, label: label || b.slug || key });
    });
    // Fall back to any catalogue vendor without a brand record.
    [...brands].forEach((v) => {
      const key = BumiData.brandKey(v);
      if (!key || listed.has(key)) return;
      listed.add(key);
      entries.push({ value: v, label: v });
    });
    brandWrap.innerHTML = entries
      .map((e) => `<label><input type="checkbox" name="brand" value="${bbEscapeHtml(e.value)}"> ${bbEscapeHtml(e.label)}</label>`)
      .join('');
  }
}

function initPLP() {
  const grid = document.getElementById('product-grid');
  const countEl = document.querySelector('.plp-count');
  const sortSelect = document.getElementById('sort-select');
  const loadMoreBtn = document.getElementById('load-more');
  const titleEl = document.getElementById('plp-title');
  const subtitleEl = document.getElementById('plp-subtitle');
  const breadcrumbCurrent = document.getElementById('breadcrumb-current');

  const params = new URLSearchParams(window.location.search);
  const state = {
    category: params.get('category') || 'all',
    search: (params.get('search') || '').trim(),
    types: new Set(),
    ages: new Set(),
    prices: new Set(),
    brands: new Set(),
    sort: 'brand-priority',
    visible: PAGE_SIZE
  };

  renderDynamicFilters();

  // Brand pages link here as /products?brand=<slug>. Resolve the slug back to
  // the exact vendor string the catalogue uses and pre-check that filter box.
  // A brand param replaces the category (it is the more specific route).
  // Brand values are normalised keys so a metaobject name ("Sabine & Heem")
  // and a product vendor ("Sabine and Heem") still match.
  const brandParam = params.get('brand');
  const activeBrand = brandParam ? BumiData.resolveBrand(brandParam) : null;
  if (activeBrand) {
    state.brands.add(activeBrand.key);
    state.category = 'all';
    document.querySelectorAll('input[name="brand"]').forEach((input) => {
      if (BumiData.brandKey(input.value) === activeBrand.key) input.checked = true;
    });
  }

  // Heading reflects the route
  if (state.search) {
    titleEl.textContent = `Search: "${state.search}"`;
    subtitleEl.textContent = 'Results from across our kids’ collection.';
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = 'Search';
  } else if (activeBrand) {
    const count = activeBrand.productCount;
    titleEl.textContent = activeBrand.name;
    subtitleEl.textContent = activeBrand.desc
      || (count === 1 ? '1 piece from this label.' : count + ' pieces from this label.');
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = activeBrand.name;
    document.title = activeBrand.name + " — BUMI / BLOOM";
  } else {
    const meta = BumiData.categoryMeta(state.category);
    titleEl.textContent = meta.title;
    subtitleEl.textContent = meta.subtitle;
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = meta.title;
  }

  // Keep the brand filter shareable: rewrite the URL as boxes change without
  // a full navigation, so the page never reloads while filtering.
  function syncBrandParam() {
    const picked = [...state.brands];
    const next = new URL(window.location.href);
    if (picked.length === 1) {
      const brand = BumiData.resolveBrand(picked[0]);
      if (brand) next.searchParams.set('brand', brand.slug);
      else next.searchParams.delete('brand');
    } else {
      next.searchParams.delete('brand');
    }
    const query = next.searchParams.toString();
    window.history.replaceState({}, '', next.pathname + (query ? '?' + query : ''));
  }

  function getFiltered() {
    let list = (state.category && state.category !== 'all')
      ? BumiData.filterByCategory(state.category)
      : BumiData.PRODUCTS.slice();

    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(p =>
        (p.name + ' ' + p.brand + ' ' + p.category + ' ' + p.audience + ' ' + (p.colors || []).map(c => c.name).join(' '))
          .toLowerCase().includes(q)
      );
    }
    if (state.types.size) list = list.filter(p => state.types.has(p.category));
    if (state.brands.size) list = list.filter(p => state.brands.has(BumiData.brandKey(p.brand)));
    if (state.ages.size) {
      list = list.filter(p => {
        const buckets = bbAgeBucketsFor(p);
        return buckets.length > 0 && [...state.ages].some(key => buckets.some(b => b.key === key));
      });
    }
    if (state.prices.size) {
      list = list.filter(p => {
        return [...state.prices].some(key => {
          const band = PRICE_BANDS[key];
          return band && p.price >= band.min && p.price < band.max;
        });
      });
    }

    switch (state.sort) {
      case 'price-asc': list.sort((a, b) => a.price - b.price); break;
      case 'price-desc': list.sort((a, b) => b.price - a.price); break;
      case 'bestselling': list.sort((a, b) => (b.isBestseller - a.isBestseller) || (b.rating - a.rating)); break;
      // Brand priority: products from admin-prioritised brands come first (in
      // that order), each group then newest-first. Brands with no priority
      // fall to the end and stay newest-first among themselves.
      case 'brand-priority':
        list.sort((a, b) => (BumiData.brandRank(a.brand) - BumiData.brandRank(b.brand)) || (b.addedAt - a.addedAt));
        break;
      default: list.sort((a, b) => b.addedAt - a.addedAt);
    }
    return list;
  }

  function render() {
    if (BumiData.loadError) {
      if (countEl) countEl.textContent = '';
      grid.innerHTML = emptyHTML("We couldn't load our products just now — please check your connection and try again shortly.");
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }
    const list = getFiltered();
    if (countEl) countEl.textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;

    if (list.length === 0) {
      grid.innerHTML = emptyHTML('No pieces match your filters just yet. Try widening your search.');
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    grid.innerHTML = list.slice(0, state.visible)
      .map((p, i) => productCardHTML(p, i)).join('');

    if (loadMoreBtn) loadMoreBtn.style.display = state.visible >= list.length ? 'none' : '';
  }

  /* ---- Wire sidebar controls ---- */
  document.querySelectorAll('input[name="type"]').forEach(input => {
    input.addEventListener('change', () => {
      state.visible = PAGE_SIZE;
      if (input.checked) state.types.add(input.value); else state.types.delete(input.value);
      render();
    });
  });

  document.querySelectorAll('input[name="brand"]').forEach(input => {
    input.addEventListener('change', () => {
      state.visible = PAGE_SIZE;
      const key = BumiData.brandKey(input.value);
      if (input.checked) state.brands.add(key); else state.brands.delete(key);
      syncBrandParam();
      render();
    });
  });

  document.querySelectorAll('input[name="price"]').forEach(input => {
    input.addEventListener('change', () => {
      state.visible = PAGE_SIZE;
      if (input.checked) state.prices.add(input.value); else state.prices.delete(input.value);
      render();
    });
  });

  document.querySelectorAll('input[name="age"]').forEach(btn => {
    btn.addEventListener('change', () => {
      state.visible = PAGE_SIZE;
      const age = btn.value;
      if (btn.checked) state.ages.add(age); else state.ages.delete(age);
      render();
    });
  });

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      state.sort = sortSelect.value;
      render();
    });
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      state.visible += PAGE_SIZE;
      render();
    });
  }

  // Mobile filter drawer open/close
  const filterTrigger = document.querySelector('.plp-filter-trigger');
  const sidebar = document.querySelector('.plp-sidebar');
  function openFilters() {
    if (!sidebar) return;
    sidebar.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    let backdrop = document.querySelector('.plp-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'plp-backdrop';
      backdrop.addEventListener('click', closeFilters);
      document.body.appendChild(backdrop);
    }
    requestAnimationFrame(() => backdrop.classList.add('is-open'));
  }
  function closeFilters() {
    if (!sidebar) return;
    sidebar.classList.remove('is-open');
    document.body.style.overflow = '';
    const backdrop = document.querySelector('.plp-backdrop');
    if (backdrop) backdrop.classList.remove('is-open');
  }
  if (filterTrigger) filterTrigger.addEventListener('click', openFilters);
  if (sidebar) {
    sidebar.addEventListener('click', (e) => {
      if (e.target === sidebar || e.target.closest('[data-action="close-filters"]')) closeFilters();
    });
  }

  // Price-band labels follow the active currency (the bands themselves
  // are AUD values, so filtering logic is unaffected)
  function renderPriceLabels() {
    const labels = {
      under15: 'Under ' + BumiData.formatPrice(15),
      '15-30': BumiData.formatPrice(15) + ' – ' + BumiData.formatPrice(30),
      '30-45': BumiData.formatPrice(30) + ' – ' + BumiData.formatPrice(45),
      above45: 'Above ' + BumiData.formatPrice(45)
    };
    document.querySelectorAll('[data-price-label]').forEach(el => {
      el.textContent = labels[el.dataset.priceLabel] || el.textContent;
    });
  }

  render();
  renderPriceLabels();
  window.addEventListener('currency-updated', () => { render(); renderPriceLabels(); });

  // Analytics: initial list view
  if (window.BumiTrack) {
    const items = getFiltered().slice(0, state.visible).map(p => ({ id: p.id, name: p.name, price: p.price }));
    BumiTrack.event('view_item_list', { item_list_name: state.category || 'all', items });
  }
}
