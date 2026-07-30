/* ============================================
   BUMI / BLOOM — Currency Switcher (AUD ⇄ IDR)
   - AUD is the base currency: every stored price,
     cart total and checkout charge stays in AUD
   - IDR is display-only, converted at a fixed rate
   - Choice persists in localStorage; changing it fires
     'currency-updated' so pages can re-render prices
   ============================================ */

const BumiCurrency = {
  STORAGE_KEY: 'bb_currency',

  /* Fixed rate: 1 AUD = IDR_RATE rupiah.
     Update this single number when the rate moves. */
  IDR_RATE: 10500,

  get() {
    return localStorage.getItem(this.STORAGE_KEY) === 'IDR' ? 'IDR' : 'AUD';
  },

  set(currency) {
    const next = currency === 'IDR' ? 'IDR' : 'AUD';
    if (next === this.get()) return;
    localStorage.setItem(this.STORAGE_KEY, next);
    this.syncSwitch();
    window.dispatchEvent(new CustomEvent('currency-updated'));
  },

  /* Format an AUD amount in the active currency. */
  format(amountAud) {
    const n = Number(amountAud);
    if (this.get() === 'IDR') {
      return 'Rp' + Math.round(n * this.IDR_RATE).toLocaleString('id-ID');
    }
    return '$' + (Number.isInteger(n)
      ? n.toLocaleString('en-AU')
      : n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  },

  /* Reflect the active currency on every switch in the page. */
  syncSwitch() {
    const active = this.get();
    document.querySelectorAll('.currency-switch__btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.currency === active);
    });
  },

  init() {
    document.querySelectorAll('.currency-switch__btn').forEach(btn => {
      btn.addEventListener('click', () => this.set(btn.dataset.currency));
    });
    this.syncSwitch();
  }
};

window.BumiCurrency = BumiCurrency;
document.addEventListener('DOMContentLoaded', () => BumiCurrency.init());
