/* ============================================
   BUMI / BLOOM — Currency (AUD only)
   - AUD is the base currency for all prices, cart totals and checkout.
   - The IDR display toggle has been removed; formatting is always en-AU.
   ============================================ */

const BumiCurrency = {
  get() {
    return 'AUD';
  },

  set(currency) {
    if (currency !== 'AUD') return;
    this.syncSwitch();
  },

  /* Format an AUD amount for display. */
  format(amountAud) {
    const n = Number(amountAud);
    return '$' + (Number.isInteger(n)
      ? n.toLocaleString('en-AU')
      : n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  },

  /* Reflect the active currency on every switch in the page. */
  syncSwitch() {
    document.querySelectorAll('.currency-switch__btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.currency === 'AUD');
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
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => BumiCurrency.init());
else BumiCurrency.init();
