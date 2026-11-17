  (async function () {
    'use strict';
    await BumiData.ready();

    const grid = document.getElementById('brand-grid');
    if (!grid) return;

    // Monogram palette — deterministic per brand so a brand keeps the same
    // colour between visits. Used when no logo is set in Shopify.
    const MONOGRAM_BG = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'];

    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[ch]);
    }

    function hashIndex(text, size) {
      let hash = 0;
      for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 31 + text.charCodeAt(i)) % 100000;
      }
      return size ? hash % size : hash;
    }

    function monogram(brand) {
      const name = String(brand.name || brand.slug || '?').trim();
      const initials = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word.charAt(0).toUpperCase())
        .join('');
      const tone = MONOGRAM_BG[hashIndex(brand.slug || name, MONOGRAM_BG.length)];
      return '<div class="brand-card__monogram brand-card__monogram--' + tone + '" aria-hidden="true">' +
        '<span>' + esc(initials || '?') + '</span>' +
      '</div>';
    }

    // Card artwork priority: a brand logo uploaded to Shopify → a collage of
    // the brand's own products → a monogram for brands with no products yet.
    function collage(images) {
      const srcs = images.slice(0, 4);
      if (!srcs.length) return '';
      const cls = 'brand-card__collage brand-card__collage--' + srcs.length;
      return '<div class="' + cls + '">' + srcs.map((src, i) =>
        '<img src="' + esc(src) + '" alt="" loading="lazy"' + (i === 0 ? '' : ' aria-hidden="true"') + '>'
      ).join('') + '</div>';
    }

    function media(brand) {
      const logo = String(brand.image || '').trim();
      if (logo) {
        return '<img src="' + esc(logo) + '" alt="' + esc(brand.name) + ' — kids wear from ' + esc(brand.city) + '" loading="lazy">';
      }
      const images = Array.isArray(brand.productImages) ? brand.productImages.filter(Boolean) : [];
      if (images.length) return collage(images);
      return monogram(brand);
    }

    function card(brand) {
      const audienceLabel = { girls: 'Girls', boys: 'Boys', unisex: 'Unisex' }[brand.audience] || 'Unisex';
      const audience = brand.audience || 'unisex';
      const count = Number(brand.productCount) || 0;
      const countLabel = count === 1 ? '1 piece' : count + ' pieces';
      return '<a href="/products?brand=' + esc(brand.slug) + '" class="brand-card brand-card--animated" data-category="' + esc(audience) + '">' +
        '<div class="brand-card__image">' + media(brand) + '</div>' +
        '<div class="brand-card__info">' +
          '<h2 class="brand-card__name">' + esc(brand.name) + '</h2>' +
          '<p class="brand-card__desc">' + esc(brand.desc) + '</p>' +
          '<div class="brand-card__meta">' +
            '<span class="badge badge--soft">' + audienceLabel + '</span>' +
            (count ? '<span class="badge badge--green">' + esc(countLabel) + '</span>' : '') +
            '<span class="badge badge--green">Made in Indonesia</span>' +
          '</div>' +
        '</div>' +
      '</a>';
    }

    function render() {
      // Brand list is alphabetical (BumiData.getBrands). The admin brand order
      // is a PRODUCT priority for Shop All, not a brand-list order.
      const brands = BumiData.getBrands ? BumiData.getBrands() : (BumiData.BRANDS || []).slice();
      if (!brands.length) {
        grid.innerHTML = '<p class="brand-empty">Our brand list is loading — please refresh in a moment.</p>';
        return;
      }
      grid.innerHTML = brands.map(card).join('');
      observeCards();
    }

    // Animate the artwork only while a card is on screen (cheap on battery,
    // and the CSS honours prefers-reduced-motion).
    function observeCards() {
      const cards = grid.querySelectorAll('.brand-card--animated');
      if (!('IntersectionObserver' in window)) {
        cards.forEach((el) => el.classList.add('is-in-view'));
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('is-in-view', entry.isIntersecting);
        });
      }, { rootMargin: '120px 0px', threshold: 0 });
      cards.forEach((el) => observer.observe(el));
    }

    render();

    document.querySelectorAll('.brand-filter-bar [data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.brand-filter-bar [data-filter]').forEach((b) => {
          b.classList.remove('is-active', 'btn--primary');
          b.classList.add('btn--ghost');
        });
        btn.classList.add('is-active', 'btn--primary');
        btn.classList.remove('btn--ghost');
        const filter = btn.dataset.filter;
        grid.querySelectorAll('.brand-card').forEach((c) => {
          c.style.display = (filter === 'all' || c.dataset.category === filter) ? '' : 'none';
        });
      });
    });
  })();
