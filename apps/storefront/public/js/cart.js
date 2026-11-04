/* ============================================
   BUMI / BLOOM — Cart Management (AU / AUD)
   - localStorage persistence
   - AU shipping + working promo (WELCOME10)
   - fires add_to_cart analytics
   ============================================ */

// Resolve the Shopify variant for a cart line. Products without Color/Size
// options (single-variant, color-only) store empty strings; older carts used
// "—"/"One Size" placeholders, so normalize those too and fall back to the
// only variant when the product has exactly one.
function findCartVariant(product, color, size) {
  if (!product || !product.variants || !product.variants.length) return null;
  const variants = product.variants;
  const c = color === '—' ? '' : (color || '');
  const s = size === 'One Size' ? '' : (size || '');

  const exact = variants.find((v) => v.color === c && v.size === s);
  if (exact) return exact;

  // Match only the dimensions the product actually has. This covers
  // color-only products, size-only products whose colors are cosmetic
  // (metafield-only), and legacy cart lines with "One Size"/"—".
  const hasColors = variants.some((v) => v.color);
  const hasSizes = variants.some((v) => v.size);
  if (!hasColors && hasSizes) return variants.find((v) => v.size === s) || null;
  if (hasColors && !hasSizes) return variants.find((v) => v.color === c) || null;
  if (variants.length === 1) return variants[0];
  return null;
}

const BumiCart = {
  STORAGE_KEY: 'bb-cart',
  PROMO_KEY: 'bb-promo',

  /* AU shipping (AUD). freeThreshold applies to the post-discount subtotal. */
  SHIPPING: { flat: 15, express: 14.95, freeThreshold: 99 },

  /* Promo codes — kini dikelola sebagai Shopify discount codes (Fase 6).
     Local config ini hanya untuk tampilan ringkasan cart; validasi nyata
     dilakukan Shopify saat checkout. */
  PROMOS: {
    WELCOME10: { rate: 0.10, label: 'Welcome — 10% off' },
  },

  _drawer: {
    root: null,
    items: null,
    recs: null,
    ship: null,
    footer: null,
    count: null,
    subtotal: null,
    discountRow: null,
    discountLabel: null,
    discountValue: null,
    checkout: null,
    live: null,
    lastFocus: null,
    prevOverflow: '',
    prevPaddingRight: '',
  },
  _highlightKey: null,

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
    const fullProduct = window.BumiData ? BumiData.getProduct(product.id) : null;
    if (fullProduct && fullProduct.variants && fullProduct.variants.length) {
      const variant = findCartVariant(fullProduct, product.color, product.size);
      if (variant && !variant.available) {
        this.showOutOfStockNotification(product.name, product.id);
        return null;
      }
    }

    const cart = this.getCart();
    const existingIndex = cart.findIndex(item =>
      item.id === product.id &&
      item.size === product.size &&
      item.color === product.color
    );

    if (existingIndex > -1) {
      cart[existingIndex].quantity = Math.min(10, (cart[existingIndex].quantity || 1) + 1);
    } else {
      cart.push({
        ...product,
        quantity: 1,
        addedAt: Date.now()
      });
    }

    this.saveCart(cart);
    this.openDrawer({ highlightKey: this._itemKey({ ...product, quantity: 1 }) });
    this._announce(product.name + ' added to bag');

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

  resolveItemVariant(item) {
    const product = window.BumiData ? BumiData.getProduct(item.id) : null;
    return findCartVariant(product, item.color, item.size);
  },

  /* Resolve a cart line against the live Shopify catalog.
     Returns { variant } when buyable, otherwise { reason } explaining why
     the line cannot be checked out. Reasons are customer-facing copy. */
  resolveCheckoutItem(item) {
    const product = window.BumiData ? BumiData.getProduct(item.id) : null;
    if (!product) {
      return { reason: 'No longer available' };
    }
    const variant = findCartVariant(product, item.color, item.size);
    if (!variant) {
      return { reason: 'This colour/size is no longer available' };
    }
    if (variant.available === false) {
      return { reason: 'Sold out' };
    }
    return { variant };
  },

  /* Split the cart into what can be checked out and what cannot.
     Never throws: an unavailable line must not block the rest of the bag. */
  getCheckoutLines() {
    const lines = [];
    const unavailable = [];
    const cart = this.getCart();

    cart.forEach((item, index) => {
      const resolved = this.resolveCheckoutItem(item);
      if (resolved.variant) {
        lines.push({
          variantId: resolved.variant.id,
          quantity: Math.min(10, Number(item.quantity) || 1),
        });
      } else {
        unavailable.push({
          index,
          id: item.id,
          name: item.name || item.id,
          brand: item.brand || '',
          color: item.color || '',
          size: item.size || '',
          reason: resolved.reason,
        });
      }
    });

    return { lines, unavailable, total: cart.length };
  },

  /* Remove a single cart line by its stored index. */
  removeUnavailableItem(index) {
    return this.removeItem(index);
  },

  /* Drop every line whose product/variant no longer exists in the catalog.
     Used on checkout load so a stale bag cannot wedge the flow. */
  purgeStaleCart() {
    const cart = this.getCart();
    if (!cart.length) return { removed: 0 };

    const keep = [];
    let removed = 0;
    for (const item of cart) {
      const product = window.BumiData ? BumiData.getProduct(item.id) : null;
      if (!product || !findCartVariant(product, item.color, item.size)) {
        removed += 1;
        continue;
      }
      keep.push(item);
    }

    if (removed > 0) this.saveCart(keep);
    return { removed };
  },

  getItemCount() {
    const cart = this.getCart();
    return cart.reduce((count, item) => count + (item.quantity || 1), 0);
  },

  /* AU shipping cost for a given method + subtotal. Free shipping is based
     on the subtotal after discounts, matching Shopify's order-price rule. */
  shippingCost(method, subtotal) {
    if (method === 'express') return this.SHIPPING.express;
    const discounted = subtotal - this.getDiscount(subtotal);
    return discounted >= this.SHIPPING.freeThreshold ? 0 : this.SHIPPING.flat;
  },

  /* ── Promo codes ──
     Shopify discount codes are the source of truth. Known codes get a local
     estimate for the cart summary; any other code is stored and passed to
     Shopify checkout for validation. */
  async applyPromo(code) {
    const key = String(code || '').trim().toUpperCase();
    if (!key) {
      this.clearPromo();
      return { valid: false };
    }
    const known = this.PROMOS[key];
    const stored = known
      ? { code: key, ...known }
      : { code: key, label: 'Discount code', pending: true };
    localStorage.setItem(this.PROMO_KEY, JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent('promo-updated'));
    return { valid: true, ...stored };
  },

  getPromo() {
    try {
      const p = JSON.parse(localStorage.getItem(this.PROMO_KEY) || 'null');
      return (p && p.code) ? p : null;
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
    if (!p || p.pending) return 0;
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
      const variant = findCartVariant(product, item.color, item.size);
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

    // BUMI / BLOOM sells to Australia. Sending the buyer country keeps the
    // Shopify checkout in AUD / en-AU instead of falling back to the visitor's
    // IP country (which produced en-ID and comma-decimal prices).
    const input = {
      lines: lineItems,
      buyerIdentity: { countryCode: 'AU' },
    };
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

  /* Display formatting — delegates to BumiCurrency (AUD only). */
  formatPrice(amount) {
    if (window.BumiCurrency) return BumiCurrency.format(amount);
    return '$' + Number(amount || 0).toFixed(2);
  },

  /* ── Cart drawer (slide-out mini cart) ───────────────────────────── */
  _esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _itemKey(item) {
    return (item.id || '') + '|' + (item.size || '') + '|' + (item.color || '');
  },

  _isCartPath() {
    const path = window.location.pathname.replace(/\/+$/, '');
    return /\/(cart|checkout)(\.html)?$/.test(path);
  },

  _syncTriggers(open) {
    if (this._isCartPath()) return;
    document.querySelectorAll('#cart-toggle, [data-cart-open]').forEach((el) => {
      el.setAttribute('aria-haspopup', 'dialog');
      el.setAttribute('aria-controls', 'bb-cart-drawer');
      el.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  },

  initDrawerTriggers() {
    this._syncTriggers(false);
  },

  _announce(message) {
    const live = this._drawer.live;
    if (!live) return;
    live.textContent = '';
    window.setTimeout(() => { live.textContent = message; }, 60);
  },

  _onDrawerKeyDown(event) {
    if (!this.isDrawerOpen()) return;

    if (event.key === 'Escape') {
      this.closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusables = Array.from(this._drawer.root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.getClientRects().length > 0);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  },

  /* Static HTML pages use clean relative links; Next uses absolute routes.
     The header cart link tells us which environment we're running in. */
  _storeHref() {
    const link = document.querySelector('.header__cart-btn, #cart-toggle');
    const href = link && link.getAttribute('href');
    return href && href.startsWith('/') ? '/cart' : 'cart';
  },

  _productHref(id) {
    return this._storeHref() === 'cart'
      ? 'product-detail?id=' + encodeURIComponent(id)
      : '/products/' + encodeURIComponent(id);
  },

  /* Public helper so other scripts (e.g. quick-add) use the same routing. */
  productHref(id) {
    return this._productHref(id);
  },

  ensureDrawer() {
    if (this._drawer.root) return this._drawer;

    const root = document.createElement('div');
    root.className = 'bb-cart-drawer';
    root.id = 'bb-cart-drawer';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Shopping bag');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="bb-cart-drawer__overlay" data-cart-close></div>
      <aside class="bb-cart-drawer__panel">
        <header class="bb-cart-drawer__header">
          <div>
            <p class="bb-cart-drawer__eyebrow">BUMI / BLOOM</p>
            <h2 class="bb-cart-drawer__title">Your Bag <span class="bb-cart-drawer__count" data-cart-count>0</span></h2>
          </div>
          <button class="bb-cart-drawer__close" type="button" data-cart-close aria-label="Close bag">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </header>
        <p class="bb-cart-drawer__sr" data-cart-live role="status" aria-live="polite"></p>
        <div class="bb-cart-drawer__ship" data-cart-ship hidden></div>
        <div class="bb-cart-drawer__body">
          <div class="bb-cart-drawer__items" data-cart-items></div>
          <section class="bb-cart-drawer__recs" data-cart-recs hidden></section>
        </div>
        <footer class="bb-cart-drawer__footer" data-cart-footer hidden>
          <div class="bb-cart-drawer__totals">
            <div class="bb-cart-drawer__total-row"><span>Subtotal</span><strong data-cart-subtotal>—</strong></div>
            <div class="bb-cart-drawer__total-row bb-cart-drawer__total-row--discount" data-cart-discount hidden><span data-cart-discount-label>Discount</span><strong data-cart-discount-value>—</strong></div>
          </div>
          <p class="bb-cart-drawer__note">Shipping &amp; GST finalized at checkout.</p>
          <button class="btn btn--primary btn--full" type="button" data-cart-checkout>Checkout</button>
          <a class="btn btn--ghost btn--full" data-cart-view href="${this._storeHref()}">View Bag</a>
        </footer>
      </aside>
    `;
    document.body.appendChild(root);

    const d = this._drawer;
    d.root = root;
    d.items = root.querySelector('[data-cart-items]');
    d.recs = root.querySelector('[data-cart-recs]');
    d.ship = root.querySelector('[data-cart-ship]');
    d.footer = root.querySelector('[data-cart-footer]');
    d.count = root.querySelector('[data-cart-count]');
    d.subtotal = root.querySelector('[data-cart-subtotal]');
    d.discountRow = root.querySelector('[data-cart-discount]');
    d.discountLabel = root.querySelector('[data-cart-discount-label]');
    d.discountValue = root.querySelector('[data-cart-discount-value]');
    d.checkout = root.querySelector('[data-cart-checkout]');
    d.live = root.querySelector('[data-cart-live]');

    root.addEventListener('click', (e) => this._onDrawerClick(e));
    document.addEventListener('keydown', (e) => this._onDrawerKeyDown(e));

    return d;
  },

  isDrawerOpen() {
    return !!(this._drawer.root && this._drawer.root.classList.contains('is-open'));
  },

  openDrawer(options) {
    const d = this.ensureDrawer();
    const opts = options || {};
    if (opts.highlightKey) this._highlightKey = opts.highlightKey;

    this.renderDrawer();

    if (!this.isDrawerOpen()) {
      d.lastFocus = document.activeElement;
      d.prevOverflow = document.body.style.overflow;
      d.prevPaddingRight = document.body.style.paddingRight;
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (scrollbar > 0) document.body.style.paddingRight = scrollbar + 'px';
      d.root.classList.add('is-open');
      d.root.setAttribute('aria-hidden', 'false');
      this._syncTriggers(true);
      requestAnimationFrame(() => {
        const closeBtn = d.root.querySelector('.bb-cart-drawer__close');
        if (closeBtn) closeBtn.focus({ preventScroll: true });
      });
    }

    if (opts.highlightKey) {
      requestAnimationFrame(() => {
        const newItem = d.root.querySelector('.bb-cart-drawer__item.is-new');
        if (!newItem) return;
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        newItem.scrollIntoView({ block: 'nearest', behavior });
      });
    }
  },

  closeDrawer() {
    const d = this._drawer;
    if (!d.root || !this.isDrawerOpen()) return;

    d.root.classList.remove('is-open');
    d.root.setAttribute('aria-hidden', 'true');
    this._syncTriggers(false);
    this._unlockScroll();

    setTimeout(() => {
      if (this.isDrawerOpen()) return;
      this._unlockScroll();
      if (d.lastFocus && typeof d.lastFocus.focus === 'function') {
        d.lastFocus.focus({ preventScroll: true });
      }
    }, 400);
  },

  _unlockScroll() {
    const d = this._drawer;
    document.body.style.overflow = d.prevOverflow || '';
    document.body.style.paddingRight = d.prevPaddingRight || '';
  },

  renderDrawer() {
    const d = this._drawer;
    if (!d.root) return;

    const items = this.getCart();
    const count = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
    d.count.textContent = count;
    d.root.classList.toggle('is-ship-free', false);

    if (!items.length) {
      d.items.innerHTML = `
        <div class="bb-cart-drawer__empty">
          <div class="bb-cart-drawer__empty-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </div>
          <h3 class="bb-cart-drawer__empty-title">Your bag is empty</h3>
          <p>Find something playful for the little ones.</p>
          <a href="${this._storeHref() === 'cart' ? 'products' : '/products'}" class="btn btn--primary btn--sm">Continue Shopping</a>
        </div>
      `;
      d.ship.hidden = true;
      d.footer.hidden = true;
    } else {
      const highlight = this._highlightKey;
      d.items.innerHTML = items.map((item, index) => {
        const qty = item.quantity || 1;
        const isNew = highlight && highlight === this._itemKey(item);
        return `
          <div class="bb-cart-drawer__item${isNew ? ' is-new' : ''}" data-cart-index="${index}">
            <a class="bb-cart-drawer__img" href="${this._productHref(item.id)}">
              <img src="${this._esc(item.image || '/images/categories/dresses.png')}" alt="${this._esc(item.name)}" loading="lazy">
            </a>
            <div class="bb-cart-drawer__meta">
              <p class="bb-cart-drawer__brand">${this._esc(item.brand || '')}</p>
              <a class="bb-cart-drawer__name" href="${this._productHref(item.id)}">${this._esc(item.name)}</a>
              <p class="bb-cart-drawer__variant">Size: ${this._esc(item.size || '—')} · Colour: ${this._esc(item.color || '—')}</p>
              <div class="bb-cart-drawer__qty">
                <button type="button" data-cart-minus aria-label="Decrease quantity">−</button>
                <span>${qty}</span>
                <button type="button" data-cart-plus aria-label="Increase quantity">+</button>
              </div>
            </div>
            <div class="bb-cart-drawer__side">
              <p class="bb-cart-drawer__price">${this.formatPrice(item.price * qty)}</p>
              <button class="bb-cart-drawer__remove" type="button" data-cart-remove>Remove</button>
            </div>
          </div>
        `;
      }).join('');

      this._highlightKey = null;
      d.footer.hidden = false;
      this._renderShipping(items);
      this._renderTotals(items);
    }

    this.renderRecommendations();
  },

  _renderShipping(items) {
    const d = this._drawer;
    const subtotal = items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
    const eligible = Math.max(0, subtotal - this.getDiscount(subtotal));
    const threshold = this.SHIPPING.freeThreshold;
    const remaining = Math.max(0, threshold - eligible);
    const pct = Math.min(100, Math.round((eligible / threshold) * 100));

    d.ship.hidden = false;
    d.root.classList.toggle('is-ship-free', remaining <= 0);

    let textEl = d.ship.querySelector('[data-cart-ship-text]');
    let bar = d.ship.querySelector('[data-cart-ship-bar]');
    let fill = d.ship.querySelector('[data-cart-ship-fill]');

    if (!textEl || !bar || !fill) {
      d.ship.innerHTML = `
        <p data-cart-ship-text></p>
        <div class="bb-cart-drawer__ship-bar" data-cart-ship-bar role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Free shipping progress">
          <span class="bb-cart-drawer__ship-fill" data-cart-ship-fill></span>
        </div>
      `;
      textEl = d.ship.querySelector('[data-cart-ship-text]');
      bar = d.ship.querySelector('[data-cart-ship-bar]');
      fill = d.ship.querySelector('[data-cart-ship-fill]');
    }

    textEl.innerHTML = remaining > 0
      ? 'You’re <strong>' + this.formatPrice(remaining) + '</strong> away from free AU shipping'
      : 'You’ve unlocked <strong>free AU shipping</strong> ✦';
    bar.setAttribute('aria-valuenow', String(pct));
    fill.style.width = pct + '%';
  },

  _renderTotals(items) {
    const d = this._drawer;
    const subtotal = items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
    const discount = this.getDiscount(subtotal);
    const promo = this.getPromo();

    d.subtotal.textContent = this.formatPrice(subtotal);
    if (promo && discount > 0) {
      d.discountRow.hidden = false;
      d.discountLabel.textContent = 'Discount (' + promo.code + ')';
      d.discountValue.textContent = '–' + this.formatPrice(discount);
    } else {
      d.discountRow.hidden = true;
    }
  },

  renderRecommendations() {
    const d = this._drawer;
    if (!d.recs) return;

    const paint = () => {
      if (!d.recs) return;
      const cartIds = this.getCart().map((item) => item.id);
      const pool = (window.BumiData && BumiData.getFeatured ? BumiData.getFeatured(10) : [])
        .filter((product) => cartIds.indexOf(product.id) === -1 && !product.soldOut)
        .slice(0, 3);

      if (!pool.length) {
        d.recs.hidden = true;
        d.recs.innerHTML = '';
        return;
      }

      d.recs.hidden = false;
      d.recs.innerHTML = `
        <h3 class="bb-cart-drawer__recs-title">You might also like</h3>
        ${pool.map((product) => `
          <div class="bb-cart-drawer__rec">
            <a class="bb-cart-drawer__rec-img" href="${this._productHref(product.id)}">
              <img src="${this._esc(product.image)}" alt="${this._esc(product.name)}" loading="lazy">
            </a>
            <div class="bb-cart-drawer__rec-meta">
              <a class="bb-cart-drawer__rec-name" href="${this._productHref(product.id)}">${this._esc(product.name)}</a>
              <span class="bb-cart-drawer__rec-brand">${this._esc(product.brand || '')}</span>
              <span class="bb-cart-drawer__rec-price">${this.formatPrice(product.price)}</span>
            </div>
            <button class="bb-cart-drawer__rec-add" type="button" data-cart-add="${this._esc(product.id)}" aria-label="Add ${this._esc(product.name)} to bag">+</button>
          </div>
        `).join('')}
      `;
    };

    if (window.BumiData && BumiData.ready) {
      BumiData.ready().then(paint).catch(() => {});
    } else {
      paint();
    }
  },

  _onDrawerClick(e) {
    if (!(e.target instanceof Element)) return;

    if (e.target.closest('[data-cart-close]')) {
      this.closeDrawer();
      return;
    }

    const addBtn = e.target.closest('[data-cart-add]');
    if (addBtn) {
      const product = window.BumiData ? BumiData.getProduct(addBtn.dataset.cartAdd) : null;
      if (!product) return;
      const hasMultipleSizes = product.sizes && product.sizes.length > 1;
      const hasMultipleColors = product.colors && product.colors.length > 1;
      if (hasMultipleSizes || hasMultipleColors) {
        window.location.href = this._productHref(product.id);
        return;
      }
      this.addItem({
        id: product.id, name: product.name, brand: product.brand, price: product.price,
        size: (product.sizes && product.sizes[0]) || 'One Size',
        color: (product.colors && product.colors[0] && product.colors[0].name) || '—',
        image: product.image
      });
      return;
    }

    const checkoutBtn = e.target.closest('[data-cart-checkout]');
    if (checkoutBtn) {
      this._handleCheckout(checkoutBtn);
      return;
    }

    const itemEl = e.target.closest('[data-cart-index]');
    if (!itemEl) return;

    const index = parseInt(itemEl.dataset.cartIndex, 10);
    const current = this.getCart()[index];
    if (!current) return;

    if (e.target.closest('[data-cart-minus]')) {
      const next = (current.quantity || 1) - 1;
      if (next <= 0) this.removeItem(index); else this.updateQuantity(index, next);
    } else if (e.target.closest('[data-cart-plus]')) {
      this.updateQuantity(index, Math.min(10, (current.quantity || 1) + 1));
    } else if (e.target.closest('[data-cart-remove]')) {
      this.removeItem(index);
    }
    // `saveCart()` already dispatches `cart-updated`, which re-renders the drawer.
  },

  async _handleCheckout(button) {
    if (button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing checkout…';
    try {
      if (window.BumiData && BumiData.ready) await BumiData.ready();

      if (window.BumiTrack) {
        const items = this.getCart().map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity || 1,
        }));
        BumiTrack.event('begin_checkout', {
          currency: 'AUD',
          value: this.getTotal() - this.getDiscount(this.getTotal()),
          items,
        });
      }

      const mode = window.__BB_PUBLIC_ENV__ && window.__BB_PUBLIC_ENV__.checkoutMode;
      if (mode === 'stripe') {
        window.location.href = '/checkout';
        return;
      }

      const url = await this.createShopifyCart();
      window.location.href = url;
    } catch (err) {
      console.error('Checkout failed', err);
      alert('Sorry, checkout could not start: ' + (err.message || err) + '. Please try again.');
      button.disabled = false;
      button.textContent = original;
    }
  },

  showOutOfStockNotification(productName, productId) {
    const existing = document.querySelector('.cart-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'cart-notification cart-notification--warning';
    notification.innerHTML = `
      <div class="cart-notification__inner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <div style="display:flex;flex-direction:column;gap:2px;">
          <span><strong>${productName}</strong> is out of stock</span>
          <span style="opacity:0.7;font-size:12px;">Try a different size or colour.</span>
        </div>
        <a href="${this._productHref(productId)}" class="cart-notification__link">Choose Another</a>
      </div>
    `;
    document.body.appendChild(notification);

    requestAnimationFrame(() => {
      notification.classList.add('is-visible');
    });

    setTimeout(() => {
      notification.classList.remove('is-visible');
      setTimeout(() => notification.remove(), 400);
    }, 4000);
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
  .cart-notification--warning .cart-notification__inner {
    background: var(--color-coral);
  }
  @media (max-width: 480px) {
    .cart-notification {
      bottom: 16px;
      left: 16px;
      right: 16px;
    }
  }

  /* ── Cart drawer ── */
  .bb-cart-drawer {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    visibility: hidden;
    pointer-events: none;
    transition: visibility 0s linear var(--duration-slow);
  }
  .bb-cart-drawer [hidden] {
    display: none !important;
  }
  .bb-cart-drawer__sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .bb-cart-drawer.is-open {
    visibility: visible;
    pointer-events: auto;
    transition-delay: 0s;
  }
  .bb-cart-drawer__overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 64, 140, 0.35);
    opacity: 0;
    transition: opacity var(--duration-slow) var(--ease-smooth);
  }
  .bb-cart-drawer.is-open .bb-cart-drawer__overlay {
    opacity: 1;
  }
  .bb-cart-drawer__panel {
    position: absolute;
    top: 0;
    right: 0;
    width: min(420px, 100vw);
    height: 100%;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--color-cream);
    border-left: 2px solid var(--border-color);
    box-shadow: -16px 0 48px rgba(0, 64, 140, 0.18);
    transform: translateX(100%);
    transition: transform var(--duration-slow) var(--ease-smooth);
  }
  .bb-cart-drawer.is-open .bb-cart-drawer__panel {
    transform: translateX(0);
  }
  .bb-cart-drawer__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid rgba(0, 64, 140, 0.1);
  }
  .bb-cart-drawer__eyebrow {
    font-size: var(--text-xs);
    font-weight: var(--fw-bold);
    letter-spacing: var(--ls-wider);
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 2px;
  }
  .bb-cart-drawer__title {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    color: var(--color-dark);
  }
  .bb-cart-drawer__count {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
    color: var(--text-muted);
  }
  .bb-cart-drawer__close {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    color: var(--color-dark);
    transition: background-color var(--duration-fast) var(--ease-smooth);
  }
  .bb-cart-drawer__close:hover {
    background: rgba(0, 64, 140, 0.08);
  }
  .bb-cart-drawer__ship {
    padding: var(--space-4) var(--space-6);
    background: var(--color-cream-light);
    border-bottom: 1px solid rgba(0, 64, 140, 0.08);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .bb-cart-drawer__ship strong {
    color: var(--color-dark);
  }
  .bb-cart-drawer__ship-bar {
    height: 8px;
    margin-top: var(--space-2);
    border-radius: var(--radius-pill);
    background: rgba(0, 64, 140, 0.1);
    overflow: hidden;
  }
  .bb-cart-drawer__ship-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--color-blue-dark);
    transition: width var(--duration-slow) var(--ease-smooth);
  }
  .bb-cart-drawer.is-ship-free .bb-cart-drawer__ship-fill {
    background: var(--color-dark);
  }
  .bb-cart-drawer__body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: var(--space-3) var(--space-6) var(--space-5);
  }
  .bb-cart-drawer__item {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr) auto;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-1);
    border-bottom: 1px solid rgba(0, 64, 140, 0.08);
  }
  .bb-cart-drawer__item:last-child {
    border-bottom: 0;
  }
  .bb-cart-drawer__item.is-new {
    border-radius: var(--radius-md);
    animation: bb-cart-highlight 1.2s var(--ease-smooth);
  }
  @keyframes bb-cart-highlight {
    0%, 45% { background: var(--color-peach-light); }
    100% { background: transparent; }
  }
  .bb-cart-drawer__img {
    display: block;
    width: 76px;
    aspect-ratio: 4 / 5;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-cream-light);
  }
  .bb-cart-drawer__img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .bb-cart-drawer__meta {
    min-width: 0;
  }
  .bb-cart-drawer__brand {
    font-size: var(--text-xs);
    font-weight: var(--fw-bold);
    letter-spacing: var(--ls-wide);
    text-transform: uppercase;
    color: var(--color-coral);
  }
  .bb-cart-drawer__name {
    display: block;
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
    line-height: 1.3;
    color: var(--color-dark);
    text-decoration: none;
    margin: 2px 0;
  }
  .bb-cart-drawer__name:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .bb-cart-drawer__variant {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .bb-cart-drawer__qty {
    display: inline-flex;
    align-items: center;
    margin-top: var(--space-2);
    border: 1.5px solid var(--border-color);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .bb-cart-drawer__qty button {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-dark);
    font-size: 16px;
    line-height: 1;
  }
  .bb-cart-drawer__qty button:hover {
    background: var(--color-cream-light);
  }
  .bb-cart-drawer__qty span {
    min-width: 26px;
    text-align: center;
    font-size: var(--text-sm);
    font-weight: var(--fw-bold);
  }
  .bb-cart-drawer__side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .bb-cart-drawer__price {
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--fw-bold);
    color: var(--color-dark);
    white-space: nowrap;
  }
  .bb-cart-drawer__remove {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .bb-cart-drawer__remove:hover {
    color: var(--color-coral);
  }
  .bb-cart-drawer__empty {
    text-align: center;
    padding: var(--space-10) var(--space-2) var(--space-8);
  }
  .bb-cart-drawer__empty-icon {
    color: var(--color-peach-dark);
    margin-bottom: var(--space-3);
  }
  .bb-cart-drawer__empty-title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    margin-bottom: var(--space-2);
  }
  .bb-cart-drawer__empty p {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin-bottom: var(--space-4);
  }
  .bb-cart-drawer__recs {
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: 1px solid rgba(0, 64, 140, 0.08);
  }
  .bb-cart-drawer__recs-title {
    font-family: var(--font-heading);
    font-size: var(--text-xs);
    font-weight: var(--fw-bold);
    letter-spacing: var(--ls-wide);
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: var(--space-2);
  }
  .bb-cart-drawer__rec {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }
  .bb-cart-drawer__rec-img {
    flex-shrink: 0;
    width: 52px;
    aspect-ratio: 4 / 5;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-cream-light);
  }
  .bb-cart-drawer__rec-img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .bb-cart-drawer__rec-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .bb-cart-drawer__rec-name {
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
    color: var(--color-dark);
    text-decoration: none;
    line-height: 1.3;
  }
  .bb-cart-drawer__rec-brand {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .bb-cart-drawer__rec-price {
    font-size: var(--text-xs);
    font-weight: var(--fw-bold);
    color: var(--color-dark);
  }
  .bb-cart-drawer__rec-add {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    background: var(--color-dark);
    color: var(--color-cream);
    font-size: 18px;
    line-height: 1;
    transition: background-color var(--duration-fast) var(--ease-smooth);
  }
  .bb-cart-drawer__rec-add:hover {
    background: var(--color-dark-light);
  }
  .bb-cart-drawer__footer {
    padding: var(--space-4) var(--space-6) var(--space-5);
    background: var(--color-cream-light);
    border-top: 1px solid rgba(0, 64, 140, 0.1);
    padding-bottom: calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
  }
  .bb-cart-drawer__total-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .bb-cart-drawer__total-row strong {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    color: var(--color-dark);
  }
  .bb-cart-drawer__total-row--discount,
  .bb-cart-drawer__total-row--discount strong {
    color: var(--color-red);
    font-size: var(--text-sm);
  }
  .bb-cart-drawer__note {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: var(--space-1) 0 var(--space-3);
  }
  .bb-cart-drawer__footer .btn {
    margin-top: var(--space-2);
  }
  @media (max-width: 480px) {
    .bb-cart-drawer__panel {
      width: 100vw;
      border-left: 0;
    }
    .bb-cart-drawer__header,
    .bb-cart-drawer__ship,
    .bb-cart-drawer__body,
    .bb-cart-drawer__footer {
      padding-left: var(--space-4);
      padding-right: var(--space-4);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bb-cart-drawer__panel,
    .bb-cart-drawer__overlay,
    .bb-cart-drawer__ship-fill {
      transition: none;
    }
    .bb-cart-drawer__item.is-new {
      animation: none;
    }
  }
`;
document.head.appendChild(notifStyle);

// Make BumiCart globally available
window.BumiCart = BumiCart;

// Header cart icon opens the drawer (except on cart / checkout pages,
// where it should keep navigating).
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const trigger = event.target.closest('#cart-toggle, [data-cart-open]');
  if (!trigger) return;
  if (BumiCart._isCartPath()) return;

  event.preventDefault();
  BumiCart.openDrawer();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => BumiCart.initDrawerTriggers());
} else {
  BumiCart.initDrawerTriggers();
}

// Keep an open drawer in sync with stock, promo and currency changes.
['cart-updated', 'promo-updated', 'currency-updated'].forEach((eventName) => {
  window.addEventListener(eventName, () => {
    if (BumiCart._drawer.root) BumiCart.renderDrawer();
  });
});

// Cart changes from another tab: the badge is handled by app.js, mirror it here.
window.addEventListener('storage', (event) => {
  if ((event.key === 'bb-cart' || event.key === 'bb-promo') && BumiCart._drawer.root) {
    BumiCart.renderDrawer();
  }
});

// Promo kini local config (tidak perlu fetch). Trigger initial cart badge.
window.dispatchEvent(new CustomEvent('cart-updated'));

(function persistCheckoutAttribution() {
  try {
    const params = new URLSearchParams(window.location.search);
    const keys = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gclid', 'fbclid'
    ];
    const stored = JSON.parse(localStorage.getItem('bb-attribution') || '{}') || {};
    let changed = false;
    for (const key of keys) {
      const value = params.get(key);
      if (value) {
        stored[key] = value;
        changed = true;
      }
    }
    if (changed) {
      stored.eventSourceUrl = window.location.href;
      stored.ts = Date.now();
      localStorage.setItem('bb-attribution', JSON.stringify(stored));
    }
  } catch (e) {}
})();
