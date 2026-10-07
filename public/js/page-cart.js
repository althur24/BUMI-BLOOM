  (function () {
    'use strict';
    // Shipping & promo handled by BumiCart (AU rates / WELCOME10)
    const cartFilled = document.getElementById('cart-filled');
    const cartEmpty = document.getElementById('cart-empty');
    const cartItems = document.querySelector('.cart-items');
    const checkoutBtn = document.getElementById('checkout-btn');

    function getCart() { return window.BumiCart ? BumiCart.getCart() : []; }

    function renderCart() {
      const items = getCart();
      if (!items.length) {
        cartFilled.style.display = 'none';
        cartEmpty.style.display = 'block';
        return;
      }
      cartFilled.style.display = 'block';
      cartEmpty.style.display = 'none';

      cartItems.innerHTML = items.map((item, index) => {
        const qty = item.quantity || 1;
        return '<div class="cart-item" role="listitem" data-index="' + index + '" data-price="' + item.price + '">' +
          '<div class="cart-item__image"><img src="' + (item.image || '/images/categories/dresses.png') + '" alt="' + item.name + '" loading="lazy"></div>' +
          '<div class="cart-item__details">' +
            '<p class="cart-item__brand">' + (item.brand || '') + '</p>' +
            '<p class="cart-item__name">' + item.name + '</p>' +
            '<p class="cart-item__variant">Size: ' + (item.size || '—') + ' · Colour: ' + (item.color || '—') + '</p>' +
            '<div class="qty-control">' +
              '<button class="qty-control__btn qty-minus" aria-label="Decrease quantity" type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
              '<span class="qty-control__value">' + qty + '</span>' +
              '<button class="qty-control__btn qty-plus" aria-label="Increase quantity" type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
            '</div>' +
            '<button class="cart-item__remove" type="button">Remove</button>' +
          '</div>' +
          '<div class="cart-item__price">' + BumiCart.formatPrice(item.price * qty) + '</div>' +
        '</div>';
      }).join('');

      updateTotals();
    }

    function updateTotals() {
      const items = getCart();
      const subtotal = items.reduce((s, i) => s + i.price * (i.quantity || 1), 0);
      const discount = BumiCart.getDiscount(subtotal);
      const shipping = BumiCart.shippingCost('standard', subtotal);
      const total = subtotal - discount + shipping;

      document.getElementById('cart-subtotal').textContent = BumiCart.formatPrice(subtotal);

      const dRow = document.getElementById('cart-discount-row');
      const promo = BumiCart.getPromo();
      if (promo && discount > 0) {
        dRow.style.display = '';
        document.getElementById('cart-discount-label').textContent = 'Discount (' + promo.code + ')';
        document.getElementById('cart-discount').textContent = '–' + BumiCart.formatPrice(discount);
      } else {
        dRow.style.display = 'none';
      }

      document.getElementById('cart-shipping').innerHTML = shipping === 0 ? '<span class="cart-summary__row--free">Free</span>' : BumiCart.formatPrice(shipping);
      document.getElementById('cart-total').textContent = BumiCart.formatPrice(total);
    }

    cartItems.addEventListener('click', (e) => {
      const cartItem = e.target.closest('.cart-item');
      if (!cartItem) return;
      const index = parseInt(cartItem.dataset.index, 10);
      if (e.target.closest('.qty-minus')) {
        const q = (getCart()[index].quantity || 1) - 1;
        if (q <= 0) BumiCart.removeItem(index); else BumiCart.updateQuantity(index, q);
        renderCart();
      } else if (e.target.closest('.qty-plus')) {
        const q = Math.min(10, (getCart()[index].quantity || 1) + 1);
        BumiCart.updateQuantity(index, q);
        renderCart();
      } else if (e.target.closest('.cart-item__remove')) {
        BumiCart.removeItem(index);
        renderCart();
      }
    });

    checkoutBtn.addEventListener('click', () => { window.location.href = '/checkout'; });

    // Promo code
    const promoInput = document.getElementById('promo-input');
    const promoApply = document.getElementById('promo-apply');
    const promoMsg = document.getElementById('promo-msg');
    function syncPromoMsg() {
      if (!promoMsg) return;
      const p = BumiCart.getPromo();
      if (p) {
        promoMsg.style.display = 'block';
        promoMsg.className = 'promo-field__msg promo-field__msg--ok';
        promoMsg.textContent = p.label + ' applied';
        if (promoInput) promoInput.value = p.code;
      } else {
        promoMsg.style.display = 'none';
      }
    }
    if (promoApply) promoApply.addEventListener('click', async () => {
      const res = await BumiCart.applyPromo(promoInput ? promoInput.value : '');
      if (promoMsg) {
        promoMsg.style.display = 'block';
        if (res.valid) {
          promoMsg.className = 'promo-field__msg promo-field__msg--ok';
          promoMsg.textContent = res.label + ' applied';
        } else {
          promoMsg.className = 'promo-field__msg promo-field__msg--err';
          promoMsg.textContent = 'That code isn’t valid — check it and try again.';
        }
      }
      renderCart();
    });

    window.addEventListener('cart-updated', renderCart);
    window.addEventListener('promo-updated', () => { renderCart(); syncPromoMsg(); });
    window.addEventListener('currency-updated', () => { renderCart(); renderRecommendations(); });
    syncPromoMsg();
    renderCart();

    // Recommendations from the catalog (needs the async-loaded catalog)
    function renderRecommendations() {
      const recGrid = document.getElementById('recommendations-grid');
      const BG = ['yellow', 'green', 'pink', 'blue'];
      recGrid.innerHTML = BumiData.getFeatured(4).map((p, i) => {
        const active = BumiWishlist.isWishlisted(p.id) ? ' is-active' : '';
        const fill = BumiWishlist.isWishlisted(p.id) ? 'currentColor' : 'none';
        return '<article class="product-card product-card--bg-' + (BG[i % BG.length]) + '">' +
          '<div class="product-card__image-wrap"><img src="' + p.image + '" alt="' + p.name + '" class="product-card__image" loading="lazy">' +
            '<button class="product-card__wishlist' + active + '" data-id="' + p.id + '" aria-label="Save to wishlist" type="button"><svg viewBox="0 0 24 24" fill="' + fill + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button></div>' +
          '<div class="product-card__info"><p class="product-card__brand">' + p.brand + '</p>' +
            '<h3 class="product-card__name"><a class="product-card__link" href="/products/' + p.id + '">' + p.name + '</a></h3>' +
            '<p class="product-card__price">' + BumiData.formatPrice(p.price) + '</p></div>' +
        '</article>';
      }).join('');
    }

    BumiData.ready().then(renderRecommendations);
  })();
