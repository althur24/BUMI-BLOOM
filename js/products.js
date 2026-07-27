/* ============================================
   BUMI / BLOOM — Product Listing & Rendering
   - Renders the PLP grid from BumiData.PRODUCTS
   - Real filtering (type, size, colour, price, brand)
   - Real sorting, URL search & category routing
   - Renders the homepage "Collections" grid
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  if (!window.BumiData) return;
  BumiData.ready().then(() => {
    if (document.getElementById('product-grid')) initPLP();
    if (document.getElementById('collection-grid')) initHomeCollection();
  });
});

/* ---------- Shared rendering ---------- */

const BG_CYCLE = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'];

function wishlisted(id) {
  return window.BumiWishlist ? BumiWishlist.isWishlisted(id) : false;
}

function badgeHTML(product) {
  let cls = null;
  let label = '';
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
  const active = wishlisted(product.id) ? ' is-active' : '';
  const fill = wishlisted(product.id) ? 'currentColor' : 'none';
  const priceHTML = product.compareAt
    ? `${BumiData.formatPrice(product.price)} <span class="product-card__price--original">${BumiData.formatPrice(product.compareAt)}</span>`
    : BumiData.formatPrice(product.price);

  const swatches = (product.colors || []).slice(0, 4).map(c =>
    `<span class="product-card__swatch" style="background:${c.hex};" title="${c.name}"></span>`
  ).join('');

  const ratingHTML = product.rating
    ? `<span class="product-card__rating" aria-label="Rated ${product.rating} out of 5">★ ${Number(product.rating).toFixed(1)}${product.reviews ? ` <span class="product-card__rating-count">(${product.reviews})</span>` : ''}</span>`
    : '';

  return `
    <article class="product-card product-card--bg-${bg}" data-id="${product.id}" data-category="${product.category}">
      <div class="product-card__image-wrap">
        <img src="${product.image}" alt="${product.name}" class="product-card__image" loading="lazy">
        ${badgeHTML(product)}
        <button class="product-card__wishlist${active}" data-id="${product.id}" aria-label="Save ${product.name} to wishlist" type="button">
          <svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
      <div class="product-card__info">
        <p class="product-card__brand">${product.brand}</p>
        <h3 class="product-card__name"><a class="product-card__link" href="product-detail?id=${product.id}">${product.name}</a></h3>
        ${ratingHTML}
        <p class="product-card__price">${priceHTML}</p>
        ${product.fibre ? `<span class="product-card__material">${product.fibre}</span>` : ''}
        ${swatches ? `<div class="product-card__swatches">${swatches}</div>` : ''}
        <button class="btn btn--primary btn--sm product-card__add" data-id="${product.id}" type="button">Add to Bag</button>
      </div>
    </article>
  `;
}

function emptyHTML(message) {
  return `<div style="grid-column:1/-1;text-align:center;padding:var(--space-16) var(--space-4);">
    <p style="font-family:var(--font-accent);font-size:var(--text-3xl);color:var(--color-coral);margin-bottom:var(--space-2);">Oops!</p>
    <p style="opacity:0.7;">${message}</p>
    <a href="products" class="btn btn--primary" style="margin-top:var(--space-6);">View All Products</a>
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

/* ---------- PLP ---------- */

const PAGE_SIZE = 9;
const PRICE_BANDS = {
  under15: { min: 0, max: 15 },
  '15-30': { min: 15, max: 30 },
  '30-45': { min: 30, max: 45 },
  above45: { min: 45, max: Infinity }
};

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

  render();

  // Analytics: initial list view
  if (window.BumiTrack) {
    const items = getFiltered().slice(0, state.visible).map(p => ({ id: p.id, name: p.name, price: p.price }));
    BumiTrack.event('view_item_list', { item_list_name: state.category || 'all', items });
  }
}
