/* ============================================
   BUMI / BLOOM — Product Listing & Rendering
   - Renders the PLP grid from BumiData.PRODUCTS
   - Real filtering (type, size, colour, price, brand)
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

function badgeHTML(product) {
  let cls = null;
  let label = '';
  if (product.soldOut) {
    return `<span class="product-card__badge product-card__badge--soldout">Sold Out</span>`;
  }
  if (product.badge === 'new') { cls = 'product-card__badge--new'; label = 'New'; }
  else if (product.badge === 'bestseller') { cls = 'product-card__badge--bestseller'; label = 'Bestseller'; }
  else if (product.badge === 'sale' && product.compareAt) {
    cls = 'product-card__badge--sale';
    const pct = Math.round((1 - product.price / product.compareAt) * 100);
    label = '-' + pct + '%';
  } else if (product.badge === 'low-stock') { cls = 'product-card__badge--bestseller'; label = 'Low Stock'; }
  if (!cls) return '';
  return `<span class="product-card__badge ${cls}">${label}</span>`;
}

function productCardHTML(product, index) {
  const bg = BG_CYCLE[index % BG_CYCLE.length];
  const soldOut = product.soldOut === true;
  const active = wishlisted(product.id) ? ' is-active' : '';
  const fill = wishlisted(product.id) ? 'currentColor' : 'none';
  const priceHTML = product.compareAt
    ? `${BumiData.formatPrice(product.price)} <span class="product-card__price--original">${BumiData.formatPrice(product.compareAt)}</span>`
    : BumiData.formatPrice(product.price);

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
        <p class="product-card__price">${priceHTML}</p>
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
// (e.g. "S (1-2 YO)", "9-10Y", "Butter") appear without code changes.
function bbSizeSortKey(value) {
  const s = String(value || '').trim();
  const range = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  const months = s.match(/(\d+)\s*[-–]\s*(\d+)\s*M/i);
  if (months) return -1000 + Number(months[1]);
  if (range) return Number(range[1]) * 100 + Number(range[2]);
  const single = s.match(/(\d+)/);
  if (single) return Number(single[1]) * 100;
  const letters = { XXS: 1, XS: 2, S: 3, M: 4, L: 5, XL: 6, XXL: 7, XXXL: 8 };
  return letters[s.toUpperCase()] ? letters[s.toUpperCase()] * 10 : 9999;
}

function renderDynamicFilters() {
  const sizes = new Set();
  const colorsByName = new Map();
  const brands = new Set();

  (BumiData.PRODUCTS || []).forEach((product) => {
    (product.sizes || []).forEach((size) => sizes.add(String(size)));
    if (product.brand) brands.add(String(product.brand));
    (product.colors || []).forEach((color) => {
      if (!color || !color.name) return;
      const hex = bbSafeHex(color.hex).toLowerCase();
      if (!colorsByName.has(hex)) colorsByName.set(hex, color.name);
    });
  });

  const sizeWrap = document.getElementById('plp-size-chips');
  if (sizeWrap) {
    sizeWrap.innerHTML = [...sizes]
      .sort((a, b) => bbSizeSortKey(a) - bbSizeSortKey(b) || a.localeCompare(b))
      .map((size) => `<button class="pdp-size plp-size-btn" type="button" data-size="${bbEscapeHtml(size)}">${bbEscapeHtml(size)}</button>`)
      .join('');
  }

  const colorWrap = document.getElementById('plp-color-swatches');
  if (colorWrap) {
    colorWrap.innerHTML = [...colorsByName.entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(([hex, name]) => `<button class="pdp-color-swatch plp-color-swatch" style="background:${hex}" data-hex="${hex}" title="${bbEscapeHtml(name)}" aria-label="${bbEscapeHtml(name)}" type="button"></button>`)
      .join('');
  }

  const brandWrap = document.getElementById('plp-brand-options');
  if (brandWrap) {
    brandWrap.innerHTML = [...brands]
      .sort((a, b) => a.localeCompare(b))
      .map((brand) => `<label><input type="checkbox" name="brand" value="${bbEscapeHtml(brand)}"> ${bbEscapeHtml(brand)}</label>`)
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
    sizes: new Set(),
    colors: new Set(),
    prices: new Set(),
    brands: new Set(),
    sort: 'newest',
    visible: PAGE_SIZE
  };

  renderDynamicFilters();

  // Heading reflects the route
  if (state.search) {
    titleEl.textContent = `Search: "${state.search}"`;
    subtitleEl.textContent = 'Results from across our kids’ collection.';
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = 'Search';
  } else {
    const meta = BumiData.categoryMeta(state.category);
    titleEl.textContent = meta.title;
    subtitleEl.textContent = meta.subtitle;
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = meta.title;
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
    if (state.brands.size) list = list.filter(p => state.brands.has(p.brand));
    if (state.sizes.size) list = list.filter(p => p.sizes.some(s => state.sizes.has(s)));
    if (state.colors.size) list = list.filter(p => (p.colors || []).some(c => state.colors.has(c.hex.toLowerCase())));
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
      if (input.checked) state.brands.add(input.value); else state.brands.delete(input.value);
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

  document.querySelectorAll('.plp-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.visible = PAGE_SIZE;
      btn.classList.toggle('is-active');
      const size = btn.dataset.size;
      if (state.sizes.has(size)) state.sizes.delete(size); else state.sizes.add(size);
      render();
    });
  });

  document.querySelectorAll('.plp-color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      state.visible = PAGE_SIZE;
      swatch.classList.toggle('is-active');
      const hex = (swatch.dataset.hex || '').toLowerCase();
      if (state.colors.has(hex)) state.colors.delete(hex); else state.colors.add(hex);
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
