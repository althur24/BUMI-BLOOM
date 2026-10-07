  (async function () {
    'use strict';
    await BumiData.ready();
    const BG = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'];
    const root = document.getElementById('pdp-root');
    const relatedSection = document.getElementById('pdp-related');
    const relatedGrid = document.getElementById('related-grid');
    const breadcrumbCurrent = document.getElementById('breadcrumb-current');

    if (BumiData.loadError) {
      root.innerHTML = '<div class="container cart-empty">' +
        '<h1 class="cart-empty__title">We can\'t load our shop right now</h1>' +
        '<p class="cart-empty__text">Something went wrong fetching our products. Please check your connection and try again shortly.</p>' +
        '<a href="/products" class="btn btn--primary">Back to Shop</a></div>';
      return;
    }

    const __rootEl = document.getElementById('pdp-root');
    const __handle = __rootEl ? __rootEl.dataset.handle : null;
    const product = BumiData.getProduct(__handle || '');

    if (!product) {
      root.innerHTML = '<div class="container cart-empty">' +
        '<h1 class="cart-empty__title">We can\'t find that piece</h1>' +
        '<p class="cart-empty__text">The product you\'re looking for may have sold out or moved.</p>' +
        '<a href="/products" class="btn btn--primary">Back to Shop</a></div>';
      return;
    }

    document.title = product.name + ' — BUMI / BLOOM';
    breadcrumbCurrent.textContent = product.name;

    if (window.BumiTrack) {
      BumiTrack.event('view_item', { currency: 'AUD', value: product.price,
        items: [{ id: product.id, name: product.name, price: product.price }] });
    }

    const gallery = (product.gallery && product.gallery.length) ? product.gallery : [product.image];
    let selectedColor = (product.colors[0] && product.colors[0].name) || '—';
    let selectedSize = product.sizes[0] || 'One Size';

    function buildPriceHTML() {
      return product.compareAt
        ? BumiData.formatPrice(product.price) + '<span class="pdp-price__original">' + BumiData.formatPrice(product.compareAt) + '</span>'
        : BumiData.formatPrice(product.price);
    }

    const badges = { new: 'New', bestseller: 'Bestseller' };
    const badgeHTML = product.badge && badges[product.badge]
      ? '<span class="badge badge--' + (product.badge === 'new' ? 'green' : 'yellow') + '" style="margin-bottom:var(--space-4);display:inline-block;">' + badges[product.badge] + '</span>'
      : '<span class="badge badge--soft" style="margin-bottom:var(--space-4);display:inline-block;">Designed in Indonesia</span>';

    const colorSwatches = product.colors.map((c, i) =>
      '<button class="pdp-color-swatch' + (i === 0 ? ' is-active' : '') + '" style="background:' + c.hex + '" data-color="' + c.name + '" title="' + c.name + '" aria-label="' + c.name + '" type="button"></button>'
    ).join('');

    const sizeButtons = product.sizes.map((s, i) =>
      '<button class="pdp-size' + (i === 0 ? ' is-active' : '') + '" data-size="' + s + '" type="button">' + s + '</button>'
    ).join('');

    const thumbs = gallery.map((g, i) =>
      '<button class="pdp-gallery__thumb' + (i === 0 ? ' is-active' : '') + '" data-src="' + g + '" type="button" aria-label="View image ' + (i + 1) + '"><img src="' + g + '" alt="' + product.name + '" loading="lazy"></button>'
    ).join('');

    const wished = BumiWishlist.isWishlisted(product.id);

    root.innerHTML =
      '<div class="container"><div class="pdp-layout">' +
        '<div class="pdp-gallery">' +
          '<div class="pdp-gallery__main"><img src="' + gallery[0] + '" alt="' + product.name + '" id="pdp-main-image"></div>' +
          (gallery.length > 1 ? '<div class="pdp-gallery__thumbs">' + thumbs + '</div>' : '') +
        '</div>' +
        '<div class="pdp-info">' +
          '<p class="pdp-brand">' + product.brand + '</p>' +
          '<h1 class="pdp-name">' + product.name + '</h1>' +
          '<p class="pdp-price" id="pdp-price">' + buildPriceHTML() + '</p>' +
          '<p id="pdp-afterpay" style="font-size:var(--text-sm);color:var(--text-secondary);margin-top:var(--space-1);">or 4 payments of ' + BumiData.formatPrice(product.price / 4) + ' with <strong>Afterpay</strong></p>' +
          '<ul class="pdp-promises"><li>🧵 Designed &amp; made in Indonesia</li><li>🌿 Non-toxic dyes</li><li>🛡️ 14-day damage guarantee</li></ul>' +
          '<div>' + badgeHTML + '</div>' +
          '<div class="pdp-rating">⭐ ' + (product.rating || '5.0') + ' <span>· ' + (product.reviews || 0) + ' reviews</span></div>' +
          '<div class="pdp-option"><p class="pdp-option__label">Colour — <span id="selected-colour">' + selectedColor + '</span></p><div class="pdp-color-swatches">' + colorSwatches + '</div></div>' +
          '<div class="pdp-option"><p class="pdp-option__label">Size</p><div class="pdp-sizes">' + sizeButtons + '</div></div>' +
          '<div class="pdp-actions">' +
            '<button class="btn btn--primary btn--full" id="add-to-bag" type="button">Add to Bag</button>' +
            '<button class="btn btn--secondary btn--full" id="save-wishlist" type="button">' + wishlistIcon(wished) + '<span id="wishlist-label">' + (wished ? 'Saved to Wishlist' : 'Save to Wishlist') + '</span></button>' +
          '</div>' +
          accordionHTML(product) +
        '</div>' +
      '</div></div>' +
      '<div class="pdp-sticky-bar"><div class="container"><div class="pdp-sticky-bar__inner"><span class="pdp-sticky-bar__price">' + BumiData.formatPrice(product.price) + '</span><button class="btn btn--primary" id="add-to-bag-sticky" type="button">Add to Bag</button></div></div></div>';

    // Gallery
    root.querySelectorAll('.pdp-gallery__thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        root.querySelectorAll('.pdp-gallery__thumb').forEach(t => t.classList.remove('is-active'));
        thumb.classList.add('is-active');
        const main = document.getElementById('pdp-main-image');
        main.src = thumb.dataset.src;
      });
    });

    // Colour
    root.querySelectorAll('.pdp-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        root.querySelectorAll('.pdp-color-swatch').forEach(s => s.classList.remove('is-active'));
        sw.classList.add('is-active');
        selectedColor = sw.dataset.color;
        document.getElementById('selected-colour').textContent = selectedColor;
      });
    });

    // Size
    root.querySelectorAll('.pdp-size').forEach(btn => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.pdp-size').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        selectedSize = btn.dataset.size;
      });
    });

    // Add to bag
    function addToBag() {
      BumiCart.addItem({
        id: product.id, name: product.name, brand: product.brand, price: product.price,
        size: selectedSize, color: selectedColor, image: product.image
      });
    }
    document.getElementById('add-to-bag').addEventListener('click', addToBag);
    const stickyAdd = document.getElementById('add-to-bag-sticky');
    if (stickyAdd) stickyAdd.addEventListener('click', addToBag);

    // Wishlist
    const saveBtn = document.getElementById('save-wishlist');
    saveBtn.addEventListener('click', () => {
      const added = BumiWishlist.toggle(product.id);
      document.getElementById('wishlist-label').textContent = added ? 'Saved to Wishlist' : 'Save to Wishlist';
      saveBtn.querySelector('svg').replaceWith(wishlistIconSvg(added));
    });

    // Accordion
    root.querySelectorAll('.accordion__trigger').forEach(trigger => {
      trigger.addEventListener('click', () => {
        trigger.closest('.accordion__item').classList.toggle('is-active');
      });
    });

    // Related
    const related = BumiData.getRelated(product, 4);
    if (related.length) {
      relatedGrid.innerHTML = related.map((p, i) => relatedCardHTML(p, i)).join('');
      relatedSection.style.display = '';
    }

    // Re-render prices when the currency switch changes
    window.addEventListener('currency-updated', () => {
      const priceEl = document.getElementById('pdp-price');
      if (priceEl) priceEl.innerHTML = buildPriceHTML();
      const afterpayEl = document.getElementById('pdp-afterpay');
      if (afterpayEl) afterpayEl.innerHTML = 'or 4 payments of ' + BumiData.formatPrice(product.price / 4) + ' with <strong>Afterpay</strong>';
      const stickyPrice = root.querySelector('.pdp-sticky-bar__price');
      if (stickyPrice) stickyPrice.textContent = BumiData.formatPrice(product.price);
      if (related.length) relatedGrid.innerHTML = related.map((p, i) => relatedCardHTML(p, i)).join('');
    });

    function wishlistIcon(active) {
      return wishlistIconSvg(active).outerHTML;
    }
    function wishlistIconSvg(active) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '18');
      svg.setAttribute('height', '18');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', active ? 'currentColor' : 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z');
      svg.appendChild(path);
      return svg;
    }

    function relatedCardHTML(p, i) {
      const bg = BG[i % BG.length];
      const active = BumiWishlist.isWishlisted(p.id) ? ' is-active' : '';
      const fill = BumiWishlist.isWishlisted(p.id) ? 'currentColor' : 'none';
      return '<article class="product-card product-card--bg-' + bg + '" data-category="' + p.category + '">' +
        '<div class="product-card__image-wrap">' +
          '<img src="' + p.image + '" alt="' + p.name + '" class="product-card__image" loading="lazy">' +
          '<button class="product-card__wishlist' + active + '" data-id="' + p.id + '" aria-label="Save ' + p.name + ' to wishlist" type="button"><svg viewBox="0 0 24 24" fill="' + fill + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>' +
        '</div>' +
        '<div class="product-card__info"><p class="product-card__brand">' + p.brand + '</p>' +
          '<h3 class="product-card__name"><a class="product-card__link" href="/products/' + p.id + '">' + p.name + '</a></h3>' +
          '<p class="product-card__price">' + BumiData.formatPrice(p.price) + '</p></div>' +
      '</article>';
    }

    function accordionHTML(product) {
      return '<div class="accordion" style="margin-top:var(--space-6);">' +
        item('Description', '<p>' + product.description + '</p>', true) +
        item('Material &amp; Care', '<p>' + product.material + '</p>') +
        item('Size Guide', sizeGuideTable(product.sizes)) +
        item('Shipping &amp; Returns', '<p>Free AU shipping on orders over $60. Standard delivery 3–6 business days across Australia. Easy 30-day returns. Faulty or damaged on arrival? Tell us within 14 days for a refund or replacement.</p>') +
      '</div>';
    }
    function item(title, body, open) {
      return '<div class="accordion__item' + (open ? ' is-active' : '') + '">' +
        '<button class="accordion__trigger" type="button">' + title + '<span class="accordion__icon">+</span></button>' +
        '<div class="accordion__content">' + body + '</div></div>';
    }
    function sizeGuideTable(sizes) {
      const ageMap = { '2T': '2–3 yrs / 92cm', '3T': '3–4 yrs / 98cm', '4T': '4–5 yrs / 104cm', '5': '5–6 yrs / 110cm', '6': '6–7 yrs / 116cm', '7': '7–8 yrs / 122cm', '8': '8–9 yrs / 128cm' };
      const babyMap = { '0-3M': '0–3 months', '3-6M': '3–6 months', '6-12M': '6–12 months', '12-18M': '12–18 months', '18-24M': '18–24 months', 'One Size': 'One Size' };
      const rows = sizes.map(s => {
        const guide = ageMap[s] || babyMap[s] || '—';
        return '<tr><td style="padding:var(--space-2) var(--space-3);font-weight:var(--fw-bold);">' + s + '</td><td style="padding:var(--space-2) var(--space-3);">' + guide + '</td></tr>';
      }).join('');
      return '<table style="border-collapse:collapse;font-size:var(--text-sm);"><thead><tr style="border-bottom:1px solid var(--border-color);"><th style="text-align:left;padding:var(--space-2) var(--space-3);">Size</th><th style="text-align:left;padding:var(--space-2) var(--space-3);">Fit guide</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }
  })();
