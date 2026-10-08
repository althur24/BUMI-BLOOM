  (function () {
    'use strict';
    const view = document.getElementById('checkout-view');
    // Shipping & promo handled by BumiCart (AU rates / WELCOME10)
    function shippingCost(method, subtotal) {
      return BumiCart.shippingCost(method, subtotal);
    }

    function render() {
      const cart = BumiCart.getCart();
      if (!cart.length) {
        view.innerHTML = '<div class="cart-empty">' +
          '<div class="cart-empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="80" height="80"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></div>' +
          '<h1 class="cart-empty__title">Your bag is empty</h1>' +
          '<p class="cart-empty__text">Add a few pieces before heading to checkout.</p>' +
          '<a href="/products" class="btn btn--primary">Continue Shopping</a></div>';
        return;
      }
      view.innerHTML = layout();
      wire();
      updateTotals();
      if (window.BumiTrack) {
        BumiTrack.event('begin_checkout', { currency: 'AUD', value: BumiCart.getTotal(),
          items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity || 1 })) });
      }
    }

    function layout() {
      return '<form id="checkout-form"><div class="checkout-layout"><div>' +
        section(1, 'Contact', '<div class="field"><label class="field__label">Email <span class="req">*</span></label><input class="input" type="email" name="email" placeholder="you@email.com" required></div>' +
          '<div class="field"><label class="field__label">Phone <span class="req">*</span></label><input class="input" type="tel" name="phone" placeholder="+61 4xx xxx xxx" required></div>') +
        section(2, 'Shipping Address',
          '<div class="form-grid">' +
            field('First name', 'text', 'firstname', true) +
            field('Last name', 'text', 'lastname', true) +
            '<div class="field field--full"><label class="field__label">Address <span class="req">*</span></label><input class="input" type="text" name="address" required></div>' +
            field('Suburb', 'text', 'city', true) +
            field('Postcode', 'text', 'postal', true) +
            '<div class="field field--full"><label class="field__label">State <span class="req">*</span></label>' +
              '<select class="select" name="state" required><option value="">Select state</option><option>NSW</option><option>VIC</option><option>QLD</option><option>WA</option><option>SA</option><option>TAS</option><option>ACT</option><option>NT</option></select></div>' +
          '</div>') +
        section(3, 'Shipping Method',
          '<div class="payment-options">' +
            '<label class="payment-option is-selected"><input type="radio" name="shipping" value="standard" checked><div><div class="payment-option__label">Standard (3–6 business days)</div><div class="payment-option__desc" id="ship-standard-desc">$9.95 · free over $60</div></div></label>' +
            '<label class="payment-option"><input type="radio" name="shipping" value="express"><div><div class="payment-option__label">Express (1–3 business days)</div><div class="payment-option__desc" id="ship-express-desc">$14.95</div></div></label>' +
          '</div>') +
        section(4, 'Payment',
          '<div class="payment-options">' +
            payOpt('card', 'Credit / Debit Card', 'Visa, Mastercard, American Express', true) +
            payOpt('afterpay', 'Afterpay', '4 interest-free payments', false) +
            payOpt('paypal', 'PayPal', 'Pay with your PayPal balance', false) +
          '</div>') +
      '</div><div>' +
        '<div class="checkout-summary">' +
          '<h2 class="checkout-summary__title">Order Summary</h2>' +
          '<div id="checkout-lines"></div>' +
          '<div class="cart-summary__row"><span>Subtotal</span><span id="sum-subtotal">—</span></div>' +
          '<div class="cart-summary__row" id="sum-discount-row" style="display:none;"><span id="sum-discount-label">Discount</span><span id="sum-discount">—</span></div>' +
          '<div class="cart-summary__row"><span>Shipping</span><span id="sum-shipping">—</span></div>' +
          '<div class="cart-summary__row cart-summary__row--total"><span>Total</span><span id="sum-total">—</span></div>' +
          '<p style="font-size:var(--text-xs);opacity:0.6;text-align:right;margin:var(--space-1) 0 0;">Prices include GST.</p>' +
          '<button class="btn btn--primary btn--full" type="submit" id="place-order">Place Order</button>' +
          '<a href="/cart" class="btn btn--ghost btn--full" style="margin-top:var(--space-2);">Back to Bag</a>' +
          '<div class="pay-strip" style="margin-top:var(--space-4);"><span class="pay-chip">Afterpay</span><span class="pay-chip">Visa</span><span class="pay-chip">Mastercard</span><span class="pay-chip">PayPal</span></div>' +
        '</div>' +
      '</div></div></form>';
    }

    function section(num, title, body) {
      return '<div class="checkout-section"><h2 class="checkout-section__title"><span class="checkout-section__num">' + num + '</span>' + title + '</h2>' + body + '</div>';
    }
    function field(label, type, name, req) {
      return '<div class="field"><label class="field__label">' + label + (req ? ' <span class="req">*</span>' : '') + '</label><input class="input" type="' + type + '" name="' + name + '"' + (req ? ' required' : '') + '></div>';
    }
    function payOpt(value, label, desc, checked) {
      return '<label class="payment-option' + (checked ? ' is-selected' : '') + '"><input type="radio" name="payment" value="' + value + '"' + (checked ? ' checked' : '') + '><div><div class="payment-option__label">' + label + '</div><div class="payment-option__desc">' + desc + '</div></div></label>';
    }

    function wire() {
      // Highlight selected payment/shipping option
      view.querySelectorAll('input[name="shipping"], input[name="payment"]').forEach(input => {
        input.addEventListener('change', () => {
          const group = input.name;
          view.querySelectorAll('input[name="' + group + '"]').forEach(r => r.closest('.payment-option').classList.toggle('is-selected', r.checked));
          updateTotals();
        });
      });
      document.getElementById('checkout-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!e.target.reportValidity()) return;
        placeOrder();
      });
    }

    function updateTotals() {
      const cart = BumiCart.getCart();
      document.getElementById('ship-standard-desc').textContent =
        BumiCart.formatPrice(BumiCart.SHIPPING.flat) + ' · free over ' + BumiCart.formatPrice(BumiCart.SHIPPING.freeThreshold);
      document.getElementById('ship-express-desc').textContent = BumiCart.formatPrice(BumiCart.SHIPPING.express);
      const lines = document.getElementById('checkout-lines');
      lines.innerHTML = cart.map(item =>
        '<div class="checkout-line"><img src="' + (item.image || '') + '" alt="">' +
        '<div class="checkout-line__name"><strong>' + item.name + '</strong><small>Qty ' + (item.quantity || 1) + '</small></div>' +
        '<span>' + BumiCart.formatPrice(item.price * (item.quantity || 1)) + '</span></div>'
      ).join('');

      const subtotal = BumiCart.getTotal();
      const method = view.querySelector('input[name="shipping"]:checked').value;
      const shipping = shippingCost(method, subtotal);
      const discount = BumiCart.getDiscount(subtotal);
      const total = subtotal - discount + shipping;

      document.getElementById('sum-subtotal').textContent = BumiCart.formatPrice(subtotal);

      const dRow = document.getElementById('sum-discount-row');
      const promo = BumiCart.getPromo();
      if (promo && discount > 0) {
        dRow.style.display = '';
        document.getElementById('sum-discount-label').textContent = 'Discount (' + promo.code + ')';
        document.getElementById('sum-discount').textContent = '–' + BumiCart.formatPrice(discount);
      } else {
        dRow.style.display = 'none';
      }

      document.getElementById('sum-shipping').innerHTML = shipping === 0 ? '<span class="cart-summary__row--free">Free</span>' : BumiCart.formatPrice(shipping);
      document.getElementById('sum-total').textContent = BumiCart.formatPrice(total);
    }

    function placeOrder() {
      const num = 'BB-2026-' + String(Math.floor(Math.random() * 9000) + 1000);
      const st = BumiCart.getTotal();
      const value = st - BumiCart.getDiscount(st) + shippingCost('standard', st);
      const items = BumiCart.getCart().map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity || 1 }));
      const total = document.getElementById('sum-total').textContent;
      if (window.BumiTrack) BumiTrack.event('purchase', { currency: 'AUD', value: value, transaction_id: num, items: items });
      BumiCart.clearCart();
      BumiCart.clearPromo();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      view.innerHTML = '<div class="order-confirmation">' +
        '<div class="order-confirmation__icon"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>' +
        '<h1 class="order-confirmation__title">Thank you for your order!</h1>' +
        '<p class="section__subtitle">A confirmation has been sent to your email. We can\'t wait for your little one to wear these!</p>' +
        '<div class="order-confirmation__number">Order ' + num + '</div>' +
        '<p style="margin-bottom:var(--space-6);"><strong>Total paid:</strong> ' + total + '</p>' +
        '<a href="/products" class="btn btn--primary">Continue Shopping</a>' +
        '<a href="/account" class="btn btn--secondary" style="margin-left:var(--space-2);">View Orders</a>' +
      '</div>';
    }

    // Currency change only affects displayed prices — refresh the summary,
    // leaving the shopper's filled-in form untouched
    window.addEventListener('currency-updated', () => {
      if (document.getElementById('checkout-form')) updateTotals();
    });

    render();
  })();
