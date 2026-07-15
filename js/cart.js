/* ============================================
   BUMI / BLOOM — Cart Management
   ============================================ */

const BumiCart = {
  STORAGE_KEY: 'bb-cart',

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

  formatPrice(amount) {
    return 'Rp' + amount.toLocaleString('id-ID');
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
        <a href="cart.html" class="cart-notification__link">View Bag</a>
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
