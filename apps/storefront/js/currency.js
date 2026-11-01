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
    this.syncChargeNote();
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

  /* IDR is display-only. Make the AUD charge explicit wherever the switch
     is shown so customers are not surprised at checkout. */
  syncChargeNote() {
    const show = this.get() === 'IDR';
    document.querySelectorAll('.currency-switch').forEach((group) => {
      let note = group.querySelector('.currency-switch__note');
      if (!show) {
        if (note) note.remove();
        return;
      }
      if (!note) {
        note = document.createElement('span');
        note.className = 'currency-switch__note';
        note.textContent = 'Charged in AUD';
        note.style.cssText = 'font-size:10px;line-height:1.2;color:inherit;opacity:.7;margin-left:6px;white-space:nowrap;';
        group.appendChild(note);
      }
    });
  },

  init() {
    document.querySelectorAll('.currency-switch__btn').forEach(btn => {
      btn.addEventListener('click', () => this.set(btn.dataset.currency));
    });
    this.syncSwitch();
    this.syncChargeNote();
  }
};

window.BumiCurrency = BumiCurrency;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => BumiCurrency.init());
else BumiCurrency.init();
