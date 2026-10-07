  (function () {
    'use strict';
    const BG = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'];
    const grid = document.getElementById('wishlist-grid');
    const empty = document.getElementById('wishlist-empty');
    const countText = document.getElementById('wishlist-count-text');

    function card(p, i) {
      const bg = BG[i % BG.length];
      return '<article class="product-card product-card--bg-' + bg + '">' +
        '<div class="product-card__image-wrap">' +
          '<img src="' + p.image + '" alt="' + p.name + '" class="product-card__image" loading="lazy">' +
          '<button class="product-card__wishlist is-active" data-id="' + p.id + '" aria-label="Remove ' + p.name + ' from wishlist" type="button"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>' +
        '</div>' +
        '<div class="product-card__info">' +
          '<p class="product-card__brand">' + p.brand + '</p>' +
          '<h3 class="product-card__name"><a class="product-card__link" href="/products/' + p.id + '">' + p.name + '</a></h3>' +
          '<p class="product-card__price">' + BumiData.formatPrice(p.price) + '</p>' +
          '<button class="btn btn--primary btn--sm btn--full" data-action="move" data-id="' + p.id + '" type="button" style="margin-top:var(--space-4);">Move to Bag</button>' +
        '</div>' +
      '</article>';
    }

    function render() {
      const items = BumiWishlist.getProducts();
      countText.textContent = items.length
        ? items.length + ' saved piece' + (items.length === 1 ? '' : 's') + ' · tap the heart to remove'
        : 'Your saved pieces, all in one place.';
      if (!items.length) {
        grid.style.display = 'none';
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      grid.style.display = '';
      grid.innerHTML = items.map(card).join('');
    }

    document.addEventListener('click', (e) => {
      const moveBtn = e.target.closest('[data-action="move"]');
      if (moveBtn) BumiWishlist.moveToCart(moveBtn.dataset.id);
    });

    window.addEventListener('wishlist-updated', render);
    window.addEventListener('currency-updated', render);
    BumiData.ready().then(render);
  })();
