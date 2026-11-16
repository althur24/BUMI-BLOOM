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

    function media(brand) {
      const src = String(brand.image || '').trim();
      if (!src) return monogram(brand);
      return '<img src="' + esc(src) + '" alt="' + esc(brand.name) + ' — kids wear from ' + esc(brand.city) + '" loading="lazy">';
    }

    function card(brand) {
      const audienceLabel = { girls: 'Girls', boys: 'Boys', baby: 'Baby', unisex: 'Unisex' }[brand.audience] || 'Unisex';
      const category = brand.audience || 'unisex';
      return '<a href="/products?category=' + esc(category) + '" class="brand-card brand-card--animated" data-category="' + esc(category) + '">' +
        '<div class="brand-card__image">' + media(brand) + '</div>' +
        '<div class="brand-card__info">' +
          '<h2 class="brand-card__name">' + esc(brand.name) + '</h2>' +
          '<p class="brand-card__desc">' + esc(brand.desc) + '</p>' +
          '<div class="brand-card__meta">' +
            '<span class="badge badge--soft">' + audienceLabel + '</span>' +
            '<span class="badge badge--green">Made in Indonesia</span>' +
          '</div>' +
        '</div>' +
      '</a>';
    }

    function render() {
      const brands = BumiData.BRANDS || [];
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
