  (async function () {
    'use strict';
    await BumiData.ready();
    const BG = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'];

    // Color names come from marketplace data / metafields — always escape
    // before interpolating into HTML (attributes included).
    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[ch]);
    }
    function safeHex(value) {
      const hex = String(value || '').trim();
      return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : '#CCCCCC';
    }
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

    const baseGallery = (product.gallery && product.gallery.length) ? product.gallery : [product.image];
    const gallery = baseGallery;
    const productColors = product.colors || [];
    const allSoldOut = !(product.variants || []).some((v) => v.available);

    function variantFor(color, size) {
      return (product.variants || []).find((v) =>
        v.size === size && (color ? v.color === color : true)
      ) || null;
    }

    // Colour → gallery image (from Shopify variant images) so the gallery
    // follows the selected colour.
    function colorImage(color) {
      if (!color) return '';
      const hit = (product.variants || []).find((v) => v.color === color && v.image);
      return hit ? hit.image : '';
    }

    function sizeAvailable(color, size) {
      const variant = variantFor(color, size);
      return !!(variant && variant.available);
    }

    function colorAvailable(color) {
      return (product.variants || []).some((v) => v.available && (!color || v.color === color));
    }

    function firstAvailableSize(color) {
      return product.sizes.find((s) => sizeAvailable(color, s)) || product.sizes[0] || '';
    }

    let selectedColor = (productColors.find((c) => colorAvailable(c.name)) || productColors[0] || {}).name || '';
    let selectedSize = firstAvailableSize(selectedColor);

    function buildPriceHTML() {
      return product.compareAt
        ? BumiData.formatPrice(product.price) + '<span class="pdp-price__original">' + BumiData.formatPrice(product.compareAt) + '</span>'
        : BumiData.formatPrice(product.price);
    }

    const badges = { new: 'New', bestseller: 'Bestseller' };
    const badgeHTML = product.badge && badges[product.badge]
      ? '<span class="badge badge--' + (product.badge === 'new' ? 'green' : 'yellow') + '" style="margin-bottom:var(--space-4);display:inline-block;">' + badges[product.badge] + '</span>'
      : '<span class="badge badge--soft" style="margin-bottom:var(--space-4);display:inline-block;">Designed in Indonesia</span>';

    // Rating / social proof — only shown when we actually have real numbers,
    // so a product without reviews never reads as a fake "5.0 · 0 reviews".
    const rating = Number(product.rating) || 0;
    const reviewCount = Number(product.reviews) || 0;
    const ratingParts = [];
    if (rating > 0) ratingParts.push('⭐ ' + rating.toFixed(1));
    if (reviewCount > 0) ratingParts.push(reviewCount + (reviewCount === 1 ? ' review' : ' reviews'));
    if (product.soldCount) ratingParts.push(product.soldCount + ' sold');
    const ratingHTML = ratingParts.length
      ? '<div class="pdp-rating">' + ratingParts[0] + (ratingParts.length > 1 ? ' <span>· ' + ratingParts.slice(1).join(' · ') + '</span>' : '') + '</div>'
      : '';

    const colorSwatches = productColors.map((c) => {
      const name = escapeHtml(c.name);
      const soldOutColor = !colorAvailable(c.name);
      return '<button class="pdp-color-swatch' + (c.name === selectedColor ? ' is-active' : '') + (soldOutColor ? ' is-sold-out' : '') + '" style="background:' + safeHex(c.hex) + '" data-color="' + name + '" title="' + name + '" aria-label="' + name + '" type="button"' + (soldOutColor ? ' disabled aria-disabled="true"' : '') + '></button>';
    }).join('');

    const colorOptionHTML = productColors.length
      ? '<div class="pdp-option"><p class="pdp-option__label">Colour — <span id="selected-colour">' + escapeHtml(selectedColor || '—') + '</span></p><div class="pdp-color-swatches">' + colorSwatches + '</div></div>'
      : '';

    const sizeButtons = product.sizes.map((s) => {
      const available = sizeAvailable(selectedColor, s);
      return '<button class="pdp-size' + (s === selectedSize ? ' is-active' : '') + (available ? '' : ' is-sold-out') + '" data-size="' + s + '" type="button"' + (available ? '' : ' disabled aria-disabled="true"') + '>' + s + '</button>';
    }).join('');

    const sizeOptionHTML = product.sizes.length
      ? '<div class="pdp-option"><p class="pdp-option__label">Size</p><div class="pdp-sizes">' + sizeButtons + '</div></div>'
      : '';

    const hasMultiple = gallery.length > 1;
    const altFor = (i) => escapeHtml(product.name) + (hasMultiple ? ' — image ' + (i + 1) + ' of ' + gallery.length : '');

    // Shopify's CDN resizes on the fly via `width=`. Requesting a sensible size
    // instead of the full original keeps mobile data usage and decode time down
    // while staying sharp on a 2x display. Non-Shopify URLs are left untouched.
    function sizedSrc(url, width) {
      const src = String(url || '');
      if (!/^https?:\/\/cdn\.shopify\.com\//i.test(src) && !/^https?:\/\/cdn\.shopifycdn\.com\//i.test(src)) return src;
      try {
        const u = new URL(src);
        u.searchParams.set('width', String(width));
        return u.toString();
      } catch (e) {
        return src;
      }
    }

    const SLIDE_SRC_WIDTH = 1000;
    const THUMB_SRC_WIDTH = 160;

    const slides = gallery.map((g, i) =>
      '<div class="pdp-gallery__slide" role="group" aria-roledescription="slide" aria-label="' + (i + 1) + ' of ' + gallery.length + '">' +
        '<img src="' + sizedSrc(g, SLIDE_SRC_WIDTH) + '" data-full="' + g + '" alt="' + altFor(i) + '"' + (i === 0 ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"') + ' draggable="false">' +
      '</div>'
    ).join('');

    const thumbs = gallery.map((g, i) =>
      '<button class="pdp-gallery__thumb' + (i === 0 ? ' is-active' : '') + '" data-index="' + i + '" type="button" aria-label="View image ' + (i + 1) + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '"><img src="' + sizedSrc(g, THUMB_SRC_WIDTH) + '" alt="" loading="lazy" decoding="async"></button>'
    ).join('');

    const navHTML = (dir) =>
      '<button class="pdp-gallery__nav pdp-gallery__nav--' + dir + '" type="button" data-dir="' + (dir === 'prev' ? -1 : 1) + '" aria-label="' + (dir === 'prev' ? 'Previous image' : 'Next image') + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (dir === 'prev' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19') + '"/></svg>' +
      '</button>';

    const counterHTML = hasMultiple
      ? '<span class="pdp-gallery__counter"><span id="pdp-gallery-current">1</span> / ' + gallery.length + '</span>'
      : '';

    const wished = BumiWishlist.isWishlisted(product.id);

    root.innerHTML =
      '<div class="container"><div class="pdp-layout">' +
        '<div class="pdp-gallery" role="region" aria-roledescription="carousel" aria-label="' + escapeHtml(product.name) + ' images">' +
          '<div class="pdp-gallery__main" id="pdp-gallery-viewport"' + (hasMultiple ? ' tabindex="0"' : '') + '>' +
            '<div class="pdp-gallery__track" id="pdp-gallery-track">' + slides + '</div>' +
            (hasMultiple ? navHTML('prev') + navHTML('next') : '') +
            counterHTML +
          '</div>' +
          (hasMultiple ? '<div class="pdp-gallery__thumbs" role="group" aria-label="Product image thumbnails">' + thumbs + '</div>' : '') +
        '</div>' +
        '<div class="pdp-info">' +
          '<p class="pdp-brand">' + product.brand + '</p>' +
          '<h1 class="pdp-name">' + product.name + '</h1>' +
          '<p class="pdp-price" id="pdp-price">' + buildPriceHTML() + '</p>' +
          '<p style="font-size:var(--text-sm);color:var(--text-secondary);margin-top:var(--space-1);">Secure checkout · Visa, Mastercard &amp; Amex</p>' +
          '<p class="pdp-availability" id="pdp-availability" style="display:none;"></p>' +
          '<ul class="pdp-promises"><li>🧵 Designed &amp; made in Indonesia</li><li>🌿 Non-toxic dyes</li><li>🛡️ 14-day damage guarantee</li></ul>' +
          '<div>' + badgeHTML + '</div>' +
          ratingHTML +
          colorOptionHTML +
          sizeOptionHTML +
          '<div class="pdp-actions">' +
            '<button class="btn btn--primary btn--full" id="add-to-bag" type="button"' + (sizeAvailable(selectedColor, selectedSize) ? '' : ' disabled') + '>' + (sizeAvailable(selectedColor, selectedSize) ? 'Add to Bag' : 'Sold Out') + '</button>' +
            '<button class="btn btn--secondary btn--full" id="save-wishlist" type="button">' + wishlistIcon(wished) + '<span id="wishlist-label">' + (wished ? 'Saved to Wishlist' : 'Save to Wishlist') + '</span></button>' +
          '</div>' +
          accordionHTML(product) +
        '</div>' +
      '</div></div>' +
      '<div class="pdp-sticky-bar"><div class="container"><div class="pdp-sticky-bar__inner"><span class="pdp-sticky-bar__price">' + BumiData.formatPrice(product.price) + '</span><button class="btn btn--primary" id="add-to-bag-sticky" type="button"' + (sizeAvailable(selectedColor, selectedSize) ? '' : ' disabled') + '>' + (sizeAvailable(selectedColor, selectedSize) ? 'Add to Bag' : 'Sold Out') + '</button></div></div></div>';

    // Gallery — swipeable, scroll-snapping carousel with arrows, thumbnail
    // strip, counter and keyboard support. All navigation funnels through
    // goTo() so the track, thumbnails and counter never fall out of sync.
    //
    // IMPORTANT: nothing in the scroll path may move the *page*. An earlier
    // version called thumb.scrollIntoView() here, which browsers satisfy by
    // scrolling every ancestor — so a vertical page scroll that nudged the
    // track by a sub-pixel would yank the whole product page back up to the
    // thumbnail strip. Thumbnail reveal now scrolls only the strip itself
    // (scrollThumbIntoView) and only on explicit navigation.
    const galleryTrack = document.getElementById('pdp-gallery-track');
    const galleryViewport = document.getElementById('pdp-gallery-viewport');
    const galleryCounter = document.getElementById('pdp-gallery-current');
    const galleryThumbs = root.querySelector('.pdp-gallery__thumbs');
    const gallerySlides = root.querySelectorAll('.pdp-gallery__slide');
    let galleryIndex = 0;
    let galleryInitialised = false;

    // Keep the active thumbnail visible without touching the page scroll.
    function scrollThumbIntoView() {
      if (!galleryThumbs) return;
      const active = galleryThumbs.querySelector('.pdp-gallery__thumb.is-active');
      if (!active) return;
      // A wrapped (desktop) strip never needs scrolling; bail out so we do not
      // set scrollLeft on a non-scrollable container.
      if (galleryThumbs.scrollWidth <= galleryThumbs.clientWidth + 1) return;
      const thumbLeft = active.offsetLeft;
      const thumbRight = thumbLeft + active.offsetWidth;
      const viewLeft = galleryThumbs.scrollLeft;
      const viewRight = viewLeft + galleryThumbs.clientWidth;
      let next = viewLeft;
      if (thumbLeft < viewLeft) next = thumbLeft;
      else if (thumbRight > viewRight) next = thumbRight - galleryThumbs.clientWidth;
      if (next !== viewLeft) galleryThumbs.scrollLeft = next;
    }

    // Eagerly decode the neighbours so a swipe never lands on a blank slide.
    function preloadNeighbours(index) {
      [index - 1, index + 1].forEach((i) => {
        const img = gallerySlides[i] && gallerySlides[i].querySelector('img');
        if (!img || img.dataset.preloaded) return;
        img.dataset.preloaded = '1';
        img.loading = 'eager';
        const warm = new Image();
        warm.decoding = 'async';
        warm.src = img.currentSrc || img.src;
      });
    }

    // syncThumb: only true for explicit navigation (arrow/thumbnail/keyboard/
    // colour). Passive scroll updates the counter and arrow state but never
    // reveals the strip, so page scroll stays untouched.
    function setActiveIndex(index, opts) {
      const target = Math.max(0, Math.min(index, gallery.length - 1));
      // Nothing to do: a vertical page scroll that merely jiggles the track
      // must not re-run any of this.
      if (target === galleryIndex && galleryInitialised) return;
      galleryIndex = target;
      galleryInitialised = true;

      if (galleryCounter) galleryCounter.textContent = String(galleryIndex + 1);
      root.querySelectorAll('.pdp-gallery__thumb').forEach((t) => {
        const active = Number(t.dataset.index) === galleryIndex;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      const prev = root.querySelector('.pdp-gallery__nav--prev');
      const next = root.querySelector('.pdp-gallery__nav--next');
      if (prev) prev.disabled = galleryIndex === 0;
      if (next) next.disabled = galleryIndex === gallery.length - 1;

      if (opts && opts.syncThumb) scrollThumbIntoView();
      preloadNeighbours(galleryIndex);
    }

    function goTo(index, opts) {
      if (!galleryTrack) return;
      const target = Math.max(0, Math.min(index, gallery.length - 1));
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      galleryTrack.scrollTo({
        left: galleryTrack.clientWidth * target,
        behavior: (opts && opts.instant) || reduce ? 'auto' : 'smooth'
      });
      setActiveIndex(target, { syncThumb: true });
    }

    if (galleryTrack) {
      setActiveIndex(0, { syncThumb: false });
      preloadNeighbours(0);

      if (!('onscrollend' in window)) {
        let scrollTimer = null;
        galleryTrack.addEventListener('scroll', () => {
          clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
            if (!galleryTrack.clientWidth) return;
            // Passive: update the counter only. No thumbnail reveal here.
            setActiveIndex(Math.round(galleryTrack.scrollLeft / galleryTrack.clientWidth));
          }, 120);
        }, { passive: true });
      } else {
        galleryTrack.addEventListener('scrollend', () => {
          if (!galleryTrack.clientWidth) return;
          setActiveIndex(Math.round(galleryTrack.scrollLeft / galleryTrack.clientWidth));
        });
      }

      root.querySelectorAll('.pdp-gallery__thumb').forEach(thumb => {
        thumb.addEventListener('click', () => goTo(Number(thumb.dataset.index)));
      });

      root.querySelectorAll('.pdp-gallery__nav').forEach(btn => {
        btn.addEventListener('click', () => goTo(galleryIndex + Number(btn.dataset.dir)));
      });

      galleryViewport.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(galleryIndex - 1); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); goTo(galleryIndex + 1); }
      });

      // Re-snap only when the *width* changes. On phones the address bar
      // collapses as you scroll, firing resize with a new height every time;
      // reacting to that used to fight the user's scrolling.
      let resizeTimer = null;
      let lastWidth = window.innerWidth;
      window.addEventListener('resize', () => {
        if (window.innerWidth === lastWidth) return;
        lastWidth = window.innerWidth;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => goTo(galleryIndex, { instant: true }), 150);
      });

      // Colour → gallery image (from Shopify variant images) so the gallery
      // follows the selected colour.
      root.querySelectorAll('.pdp-color-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          if (sw.disabled) return;
          const nextImage = colorImage(sw.dataset.color);
          const targetIndex = nextImage ? gallery.indexOf(nextImage) : -1;
          if (targetIndex !== -1) goTo(targetIndex);
        });
      });
    }

    // Colour
    root.querySelectorAll('.pdp-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        if (sw.disabled) return;
        selectedColor = sw.dataset.color;
        document.getElementById('selected-colour').textContent = selectedColor || '—';
        if (!sizeAvailable(selectedColor, selectedSize)) {
          selectedSize = firstAvailableSize(selectedColor);
        }
        refreshVariantUI();
      });
    });

    // Size
    root.querySelectorAll('.pdp-size').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        selectedSize = btn.dataset.size;
        refreshVariantUI();
      });
    });

    function refreshVariantUI() {
      const available = sizeAvailable(selectedColor, selectedSize);

      root.querySelectorAll('.pdp-size').forEach((btn) => {
        const ok = sizeAvailable(selectedColor, btn.dataset.size);
        btn.disabled = !ok;
        btn.classList.toggle('is-sold-out', !ok);
        btn.classList.toggle('is-active', btn.dataset.size === selectedSize);
      });

      root.querySelectorAll('.pdp-color-swatch').forEach((sw) => {
        const ok = colorAvailable(sw.dataset.color);
        sw.disabled = !ok;
        sw.classList.toggle('is-sold-out', !ok);
        sw.classList.toggle('is-active', sw.dataset.color === selectedColor);
      });

      const note = document.getElementById('pdp-availability');
      if (note) {
        if (available) {
          note.style.display = 'none';
          note.textContent = '';
        } else {
          note.style.display = '';
          note.textContent = allSoldOut ? 'Sold Out' : 'This size is sold out';
        }
      }

      ['add-to-bag', 'add-to-bag-sticky'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = !available;
        btn.textContent = available ? 'Add to Bag' : 'Sold Out';
      });
    }

    // Add to bag
    function addToBag() {
      if (!sizeAvailable(selectedColor, selectedSize)) {
        BumiCart.showOutOfStockNotification(product.name, product.id);
        return;
      }
      BumiCart.addItem({
        id: product.id, name: product.name, brand: product.brand, price: product.price,
        size: selectedSize || '', color: selectedColor || '', image: product.image
      });
    }
    document.getElementById('add-to-bag').addEventListener('click', addToBag);
    const stickyAdd = document.getElementById('add-to-bag-sticky');
    if (stickyAdd) stickyAdd.addEventListener('click', addToBag);
    refreshVariantUI();

    // Wishlist
    const saveBtn = document.getElementById('save-wishlist');
    saveBtn.addEventListener('click', () => {
      const added = BumiWishlist.toggle(product.id);
      document.getElementById('wishlist-label').textContent = added ? 'Saved to Wishlist' : 'Save to Wishlist';
      saveBtn.querySelector('svg').replaceWith(wishlistIconSvg(added));
    });

    // Accordion toggling is handled by the delegated handler in app.js so it
    // also works for accordions rendered after load (like this one).

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
      const soldOut = p.soldOut === true;
      const active = BumiWishlist.isWishlisted(p.id) ? ' is-active' : '';
      const fill = BumiWishlist.isWishlisted(p.id) ? 'currentColor' : 'none';
      return '<article class="product-card product-card--bg-' + bg + (soldOut ? ' product-card--sold-out' : '') + '" data-category="' + p.category + '">' +
        '<div class="product-card__image-wrap">' +
          '<img src="' + p.image + '" alt="' + p.name + '" class="product-card__image" loading="lazy">' +
          (soldOut ? '<span class="product-card__badge product-card__badge--soldout">Sold Out</span>' : '') +
          '<button class="product-card__wishlist' + active + '" data-id="' + p.id + '" aria-label="Save ' + p.name + ' to wishlist" type="button"><svg viewBox="0 0 24 24" fill="' + fill + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>' +
        '</div>' +
        '<div class="product-card__info"><p class="product-card__brand">' + p.brand + '</p>' +
          '<h3 class="product-card__name"><a class="product-card__link" href="/products/' + p.id + '">' + p.name + '</a></h3>' +
          '<p class="product-card__price">' + BumiData.formatPrice(p.price) + '</p></div>' +
      '</article>';
    }

    function accordionHTML(product) {
      return '<div class="accordion" style="margin-top:var(--space-6);">' +
        item('Description', richText(product.description), true) +
        item('Material &amp; Care', richText(product.material)) +
        item('Size Guide', sizeGuideHTML(product)) +
        item('Shipping &amp; Returns', '<p>Free AU shipping on orders over $99. Standard delivery 5–8 business days across Australia. Easy 30-day returns. Faulty or damaged on arrival? Tell us within 14 days for a refund or replacement.</p>') +
      '</div>';
    }

    // Product copy from Shopify/iOS scrapers can arrive either as rich HTML or
    // as flattened plain text. Render both cleanly: keep trusted block HTML
    // (after stripping scripts/handlers) and turn plain text into paragraphs,
    // line breaks and bullet lists instead of one long run-on blob.
    function richText(value) {
      const raw = String(value == null ? '' : value).trim();
      if (!raw) return '<p>Details coming soon.</p>';
      if (!/<[a-z][\s\S]*>/i.test(raw)) return plainTextToHtml(raw);
      const cleaned = sanitizeHtml(raw);
      if (cleaned.replace(/<[^>]*>/g, ' ').trim()) return cleaned;
      return plainTextToHtml(raw.replace(/<[^>]*>/g, ' ').trim()) || '<p>Details coming soon.</p>';
    }

    function plainTextToHtml(text) {
      return text
        .replace(/\r\n?/g, '\n')
        .split(/\n{2,}/)
        .map((block) => {
          const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
          if (!lines.length) return '';
          if (lines.every((l) => /^[-*•]\s+/.test(l))) {
            return '<ul>' + lines
              .map((l) => '<li>' + escapeHtml(l.replace(/^[-*•]\s+/, '')) + '</li>')
              .join('') + '</ul>';
          }
          return '<p>' + lines.map(escapeHtml).join('<br>') + '</p>';
        })
        .join('');
    }

    // Lightweight allow-list filter — descriptions are store-owned content but
    // are injected as HTML, so drop anything that could execute or leak.
    function sanitizeHtml(html) {
      const doc = new DOMParser().parseFromString(String(html), 'text/html');
      doc.querySelectorAll('script, style, iframe, object, embed, form, link, meta').forEach((el) => el.remove());
      doc.querySelectorAll('*').forEach((el) => {
        [...el.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          const val = String(attr.value || '');
          if (name.startsWith('on')) el.removeAttribute(attr.name);
          else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(val)) el.removeAttribute(attr.name);
          else if (name === 'style' && /expression|javascript:/i.test(val)) el.removeAttribute(attr.name);
        });
      });
      return doc.body.innerHTML.trim();
    }

    function item(title, body, open) {
      return '<div class="accordion__item' + (open ? ' is-active' : '') + '">' +
        '<button class="accordion__trigger" type="button">' + title + '<span class="accordion__icon">+</span></button>' +
        '<div class="accordion__content">' + body + '</div></div>';
    }
    function sizeFitLabel(size) {
      const s = String(size || '').trim();
      const range = s.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:Y|YO|YRS?|YEARS?|TAHUN)/i);
      if (range) return range[1] + '–' + range[2] + ' yrs';
      const singleYear = s.match(/(\d+)\s*(?:Y|YO|YRS?|YEARS?|TAHUN)/i);
      if (singleYear) return singleYear[1] + ' yrs';
      const months = s.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:M(?:O|ONTHS?)?|BLN|BULAN)\b/i);
      if (months) return months[1] + '–' + months[2] + ' months';
      const toddler = s.match(/^(\d+)T$/i);
      if (toddler) return toddler[1] + '–' + (Number(toddler[1]) + 1) + ' yrs';
      const ageMap = { '5': '5–6 yrs', '6': '6–7 yrs', '7': '7–8 yrs', '8': '8–9 yrs' };
      const babyMap = { '0-3M': '0–3 months', '3-6M': '3–6 months', '6-12M': '6–12 months', '12-18M': '12–18 months', '18-24M': '18–24 months' };
      return ageMap[s] || babyMap[s] || '—';
    }

    function sizeGuideHTML(product) {
      const guide = String(product.sizeGuide || '').trim();
      const chartUrl = /^https?:\/\//i.test(String(product.sizeChartImage || '').trim())
        ? String(product.sizeChartImage).trim()
        : '';
      const rows = [];
      if (guide) {
        guide.split(/\r?\n|\|/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
          if (/^size chart:/i.test(line)) return;
          const parts = line.split(/\s+[—–-]\s+/);
          rows.push({ size: parts[0], fit: parts.slice(1).join(' — ') || '—' });
        });
      }
      if (!rows.length) {
        (product.sizes || []).forEach((size) => rows.push({ size, fit: sizeFitLabel(size) }));
      }
      const table = rows.length
        ? '<table style="border-collapse:collapse;font-size:var(--text-sm);"><thead><tr style="border-bottom:1px solid var(--border-color);"><th style="text-align:left;padding:var(--space-2) var(--space-3);">Size</th><th style="text-align:left;padding:var(--space-2) var(--space-3);">Fit guide</th></tr></thead><tbody>' +
          rows.map((row) => '<tr><td style="padding:var(--space-2) var(--space-3);font-weight:var(--fw-bold);">' + escapeHtml(row.size) + '</td><td style="padding:var(--space-2) var(--space-3);">' + escapeHtml(row.fit) + '</td></tr>').join('') +
          '</tbody></table>'
        : '';
      const chart = chartUrl
        ? '<img src="' + escapeHtml(chartUrl) + '" alt="Size chart" loading="lazy" style="max-width:100%;margin-top:var(--space-3);border-radius:var(--radius-md);">'
        : '';
      return table + chart || '<p>Size guide coming soon.</p>';
    }

  })();
