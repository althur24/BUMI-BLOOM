/* ============================================
   BUMI / BLOOM — Wishlist Management
   Stores product ids in localStorage and resolves
   full details via BumiData. Mirrors the BumiCart
   pattern (events, counts, formatting).
   ============================================ */

const BumiWishlist = {
  STORAGE_KEY: 'bb-wishlist',

  getItems() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  },

  saveItems(ids) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent('wishlist-updated'));
  },

  isWishlisted(id) {
    return this.getItems().includes(id);
  },

  add(id) {
    const ids = this.getItems();
    if (!ids.includes(id)) {
      ids.push(id);
      this.saveItems(ids);
    }
  },

  remove(id) {
    this.saveItems(this.getItems().filter(x => x !== id));
  },

  toggle(id) {
    if (this.isWishlisted(id)) { this.remove(id); return false; }
    this.add(id); return true;
  },

  clear() {
    this.saveItems([]);
  },

  /* Resolve stored ids to full product objects (skips missing). */
  getProducts() {
    if (!window.BumiData) return [];
    return this.getItems()
      .map(id => BumiData.getProduct(id))
      .filter(Boolean);
  },

  getItemCount() {
    return this.getItems().length;
  },

  /* Move a wishlisted item into the bag with its first size/colour. */
  moveToCart(id) {
    const product = window.BumiData ? BumiData.getProduct(id) : null;
    if (!product) return;
    if (window.BumiCart) {
      BumiCart.addItem({
        id: product.id,
        name: product.name,
        brand: product.brand,
        price: product.price,
        size: (product.sizes && product.sizes[0]) || 'One Size',
        color: (product.colors && product.colors[0] && product.colors[0].name) || '—',
        image: product.image
      });
    }
    this.remove(id);
  }
};

/* ---- Header wishlist badge ---- */
function updateWishlistCount() {
  const el = document.getElementById('wishlist-count');
  if (!el) return;
  const count = BumiWishlist.getItemCount();
  el.textContent = count;
  el.dataset.count = String(count);
  el.style.display = count > 0 ? 'flex' : 'none';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateWishlistCount);
else updateWishlistCount();
window.addEventListener('wishlist-updated', updateWishlistCount);
window.addEventListener('storage', (e) => {
  if (e.key === BumiWishlist.STORAGE_KEY) updateWishlistCount();
});

window.BumiWishlist = BumiWishlist;
