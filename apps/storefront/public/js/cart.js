/* ============================================
   BUMI / BLOOM — Cart Management (AU / AUD)
   - localStorage persistence
   - AU shipping + working promo (WELCOME10)
   - fires add_to_cart analytics
   ============================================ */

const BumiCart = {
  STORAGE_KEY: 'bb-cart',
  PROMO_KEY: 'bb-promo',

  /* AU shipping (AUD). freeThreshold applies to the (pre-discount) subtotal. */
  SHIPPING: { flat: 9.95, express: 14.95, freeThreshold: 60 },

  /* Promo codes — kini dikelola sebagai Shopify discount codes (Fase 6).
     Local config ini hanya untuk tampilan ringkasan cart; validasi nyata
     dilakukan Shopify saat checkout. */
  PROMOS: {
    WELCOME10: { rate: 0.10, label: 'Welcome — 10% off' },
  },

  getCart() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  },

  saveCart(cart) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent('cart-updated'));
  },

  addItem(product) {
    const cart = this.getCart();
    const existingIndex = cart.findIndex(item =>
      item.id === product.id &&
      item.size === product.size &&
      item.color === product.color
    );

    if (existingIndex > -1) {
      cart[existingIndex].quantity = (cart[existingIndex].quantity || 1) + 1;
    } else {
      cart.push({
        ...product,
        quantity: 1,
        addedAt: Date.now()
      });
    }

    this.saveCart(cart);
    this.showNotification(product.name);

    if (window.BumiTrack) {
      BumiTrack.event('add_to_cart', {
        currency: 'AUD',
        value: product.price,
        items: [{ id: product.id, name: product.name, price: product.price, quantity: 1 }]
      });
    }
    return cart;
  },

  removeItem(index) {
    const cart = this.getCart();
    cart.splice(index, 1);
    this.saveCart(cart);
    return cart;
  },

  updateQuantity(index, quantity) {
    const cart = this.getCart();
    if (quantity <= 0) {
      cart.splice(index, 1);
    } else {
      cart[index].quantity = quantity;
    }
    this.saveCart(cart);
    return cart;
  },

  clearCart() {
    this.saveCart([]);
  },

  getTotal() {
    const cart = this.getCart();
    return cart.reduce((total, item) => total + (item.price * (item.quantity || 1)), 0);
  },

  getItemCount() {
    const cart = this.getCart();
    return cart.reduce((count, item) => count + (item.quantity || 1), 0);
  },

  /* AU shipping cost for a given method + subtotal. */
  shippingCost(method, subtotal) {
    if (method === 'express') return this.SHIPPING.express;
    return subtotal >= this.SHIPPING.freeThreshold ? 0 : this.SHIPPING.flat;
  },

  /* ── Promo codes ── */
  async applyPromo(code) {
    const key = String(code || '').trim().toUpperCase();
    const promo = this.PROMOS[key];
    if (!promo) {
      this.clearPromo();
      return { valid: false };
    }
    const stored = { code: key, ...promo };
    localStorage.setItem(this.PROMO_KEY, JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent('promo-updated'));
    return { valid: true, ...stored };
  },

  getPromo() {
    try {
      const p = JSON.parse(localStorage.getItem(this.PROMO_KEY) || 'null');
      return (p && this.PROMOS[p.code]) ? p : null;
    } catch {
      return null;
    }
  },

  clearPromo() {
    localStorage.removeItem(this.PROMO_KEY);
    window.dispatchEvent(new CustomEvent('promo-updated'));
  },

  getDiscount(subtotal) {
    const p = this.getPromo();
    if (!p) return 0;
    if (p.fixed != null) return Math.min(p.fixed, subtotal);
    return subtotal * (p.rate || 0);
  },

  /* ── Shopify checkout (Fase 4/5) ──
     Bangun Shopify cart dari isi localStorage cart, lalu kembalikan
     checkoutUrl Shopify (pembayaran asli). Promo code (kalau ada) dikirim
     sebagai discountCodes — Shopify yang validasi. */
  async createShopifyCart() {
    const items = this.getCart();
    if (!items.length) throw new Error('Cart is empty');

    const lineItems = [];
    const skipped = [];
    for (const item of items) {
      const product = window.BumiData ? BumiData.getProduct(item.id) : null;
      const variant = product && product.variants
        ? product.variants.find((v) => v.color === item.color && v.size === item.size)
        : null;
      if (!variant) { skipped.push(item); continue; }
      lineItems.push({ merchandiseId: variant.id, quantity: item.quantity || 1 });
    }
    if (skipped.length) {
      // Jangan diam-diam drop item — beri tahu customer agar bisa hapus & retry.
      throw new Error('Some cart items could not be matched to a variant: '
        + skipped.map((s) => s.name || s.id).join(', ')
        + '. Please remove them and try again.');
    }
    if (!lineItems.length) throw new Error('No matching product variants (catalog not loaded?)');

    const input = { lines: lineItems };
    const promo = this.getPromo();
    if (promo && promo.code) input.discountCodes = [promo.code];

    const shop = window.BumiShop;
    if (!shop) throw new Error('Shopify config missing');
    const res = await fetch(shop.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': shop.token },
      body: JSON.stringify({
        query: `mutation CartCreate($input: CartInput!) {
          cartCreate(input: $input) {
            cart { id checkoutUrl }
            userErrors { field message code }
          }
        }`,
        variables: { input },
      }),
    });
    if (!res.ok) throw new Error(`Storefront HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors && json.errors.length) throw new Error('Cart GraphQL: ' + JSON.stringify(json.errors));
    const cart = json.data.cartCreate.cart;
    if (json.data.cartCreate.userErrors && json.data.cartCreate.userErrors.length) {
      throw new Error('Cart errors: ' + json.data.cartCreate.userErrors.map((e) => e.message).join('; '));
    }
    if (!cart) throw new Error('Shopify did not return a cart');
    return cart.checkoutUrl;
  },

  /* Display formatting — delegates to BumiCurrency (AUD base, IDR
     display). Amounts themselves always stay AUD. */
  formatPrice(amount) {
    return BumiCurrency.format(amount);
  },

  showNotification(productName) {
    // Remove existing notification
    const existing = document.querySelector('.cart-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'cart-notification';
    notification.innerHTML = `
      <div class="cart-notification__inner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span><strong>${productName}</strong> added to bag</span>
        <a href="/cart" class="cart-notification__link">View Bag</a>
      </div>
    `;
    document.body.appendChild(notification);

    // Animate in
    requestAnimationFrame(() => {
      notification.classList.add('is-visible');
    });

    // Auto dismiss
    setTimeout(() => {
      notification.classList.remove('is-visible');
      setTimeout(() => notification.remove(), 400);
    }, 3000);
  }
};

// Inject notification styles
const notifStyle = document.createElement('style');
notifStyle.textContent = `
  .cart-notification {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999;
    transform: translateY(120%);
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .cart-notification.is-visible {
    transform: translateY(0);
  }
  .cart-notification__inner {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--color-dark);
    color: var(--color-cream);
    padding: 14px 20px;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    font-size: 14px;
    max-width: 380px;
  }
  .cart-notification__link {
    color: var(--color-yellow);
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
    margin-left: auto;
  }
  @media (max-width: 480px) {
    .cart-notification {
      bottom: 16px;
      left: 16px;
      right: 16px;
    }
  }
`;
document.head.appendChild(notifStyle);

// Make BumiCart globally available
window.BumiCart = BumiCart;

// Promo kini local config (tidak perlu fetch). Trigger initial cart badge.
window.dispatchEvent(new CustomEvent('cart-updated'));
