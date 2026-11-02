  (async function () {
    'use strict';
    await BumiData.ready();
    const IMAGES = {
      'bohopanna': '/images/brands/bohopanna.svg',
      'sabine-heem': '/images/brands/sabine-heem.svg',
      'anakmu': '/images/brands/anakmu.svg'
    };
    const grid = document.getElementById('brand-grid');

    function card(b) {
      const audienceLabel = { girls: 'Girls', boys: 'Boys', baby: 'Baby', unisex: 'Unisex' }[b.audience] || 'Unisex';
      return '<a href="/products?category=' + b.audience + '" class="brand-card" data-category="' + b.audience + '">' +
        '<div class="brand-card__image"><img src="' + (IMAGES[b.slug] || '/images/brands/bohopanna.svg') + '" alt="' + b.name + ' — kids wear from ' + b.city + '" loading="lazy"></div>' +
        '<div class="brand-card__info">' +
          '<h2 class="brand-card__name">' + b.name + '</h2>' +
          '<p class="brand-card__desc">' + b.desc + '</p>' +
          '<div class="brand-card__meta">' +
            '<span class="badge badge--soft">' + audienceLabel + '</span>' +
            '<span class="badge badge--green">Made in Indonesia</span>' +
          '</div>' +
        '</div>' +
      '</a>';
    }

    grid.innerHTML = BumiData.BRANDS.map(card).join('');

    document.querySelectorAll('.brand-filter-bar [data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.brand-filter-bar [data-filter]').forEach(b => {
          b.classList.remove('is-active', 'btn--primary');
          b.classList.add('btn--ghost');
        });
        btn.classList.add('is-active', 'btn--primary');
        btn.classList.remove('btn--ghost');
        const f = btn.dataset.filter;
        grid.querySelectorAll('.brand-card').forEach(c => {
          c.style.display = (f === 'all' || c.dataset.category === f) ? '' : 'none';
        });
      });
    });
  })();
