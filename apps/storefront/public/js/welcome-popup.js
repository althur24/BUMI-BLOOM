/**
 * BUMI / BLOOM — Promo popup ("Any 3 for $69")
 *
 * - Shows a single modal to new visitors (default 4s), once per ~30 days.
 * - Never auto-opens on checkout / order pages.
 * - It explains the current automatic offer; there is no email capture and no
 *   discount code (the previous 10% welcome-code offer is archived).
 * - Cleans up any 10% code left in localStorage by the old offer so it does
 *   not linger in the bag.
 */
(function () {
  'use strict';
  if (window.BumiWelcomePopup) return;

  const SEEN_KEY = 'bb-welcome-seen';
  const PROMO_KEY = 'bb-promo';
  const ARCHIVED_CODES = ['WELCOME10', 'WELCOME-10'];
  const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const SHOW_DELAY_MS = 4000;
  const EXCLUDED_PATH = /^\/(checkout|cart|order)(\/|$)/;

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let dialog = null;
  let isOpen = false;
  let returnFocus = null;

  /* ── Storage helpers (private mode safe) ─────────────────────────────── */
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }
  function recentlySeen() {
    const at = Number(storageGet(SEEN_KEY) || 0);
    return at > 0 && Date.now() - at < SEEN_TTL_MS;
  }

  /* The 10% welcome code is no longer offered. If a returning visitor still
     has it stored, drop it so the bag never shows a stale discount. */
  function purgeArchivedPromo() {
    let stored = null;
    try { stored = JSON.parse(storageGet(PROMO_KEY) || 'null'); } catch (e) { /* ignore */ }
    const code = stored && stored.code ? String(stored.code).toUpperCase() : '';
    if (!code || ARCHIVED_CODES.indexOf(code) === -1) return;
    if (window.BumiCart && typeof BumiCart.clearPromo === 'function') {
      BumiCart.clearPromo();
    } else {
      try { localStorage.removeItem(PROMO_KEY); } catch (e) { /* ignore */ }
    }
  }

  /* ── Markup ──────────────────────────────────────────────────────────── */
  function build() {
    if (dialog) return;

    const root = document.createElement('div');
    root.className = 'welcome-popup';
    root.id = 'welcome-popup';
    root.hidden = true;
    root.innerHTML =
      '<div class="welcome-popup__overlay" data-welcome-close></div>' +
      '<div class="welcome-popup__dialog" role="dialog" aria-modal="true" ' +
        'aria-labelledby="welcome-popup-title" aria-describedby="welcome-popup-text">' +
        '<button class="welcome-popup__close" type="button" data-welcome-close aria-label="Close offer">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
        '<div class="welcome-popup__art" aria-hidden="true">' +
          '<img src="/images/characters/turtle.webp" alt="" loading="lazy">' +
        '</div>' +
        '<div class="welcome-popup__body" data-welcome-body>' +
          '<p class="welcome-popup__eyebrow">New offer</p>' +
          '<h2 class="welcome-popup__title" id="welcome-popup-title">Any 3 for <span class="script-accent">$69</span></h2>' +
          '<p class="welcome-popup__text" id="welcome-popup-text">Pick any 3 clothing or accessory pieces — mix sizes, colours and brands — and we\'ll reprice them to a flat $69. Busy books are excluded.</p>' +
          '<ul class="welcome-popup__list">' +
            '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><span>Applies automatically in your bag — no code needed</span></li>' +
            '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><span>Stacks with free AU shipping over $99</span></li>' +
          '</ul>' +
          '<a class="btn btn--primary welcome-popup__cta" href="/products?category=kids">Shop the offer</a>' +
          '<button class="welcome-popup__decline" type="button" data-welcome-close>Maybe later</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(root);
    dialog = root.querySelector('.welcome-popup__dialog');

    root.addEventListener('click', (event) => {
      const closer = event.target.closest('[data-welcome-close]');
      if (closer) {
        event.preventDefault();
        close();
      }
    });

    root.addEventListener('keydown', trapFocus);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen) close();
    });
  }

  /* ── Open / close ────────────────────────────────────────────────────── */
  function open() {
    build();
    const root = document.getElementById('welcome-popup');
    if (!root || isOpen) return;
    returnFocus = document.activeElement;
    root.hidden = false;
    // next frame so the CSS transition runs
    requestAnimationFrame(() => root.classList.add('is-open'));
    isOpen = true;
    // Record the impression, not just an explicit dismissal. The CTA navigates
    // away without calling close(), so marking only on close made the popup
    // reappear after every "Shop the offer" tap (especially on mobile).
    storageSet(SEEN_KEY, String(Date.now()));
    const first = dialog.querySelector('a[href], button');
    if (first) setTimeout(() => first.focus(), 200);
  }

  function close() {
    const root = document.getElementById('welcome-popup');
    if (!root || !isOpen) return;
    isOpen = false;
    root.classList.remove('is-open');
    // remember the dismissal so a "maybe later" is respected
    storageSet(SEEN_KEY, String(Date.now()));
    setTimeout(() => { root.hidden = true; }, 250);
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    returnFocus = null;
  }

  function trapFocus(event) {
    if (event.key !== 'Tab' || !dialog) return;
    const items = dialog.querySelectorAll(FOCUSABLE_SELECTOR);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ── Auto-show for new visitors ──────────────────────────────────────── */
  function scheduleAutoShow() {
    if (recentlySeen() || EXCLUDED_PATH.test(location.pathname)) return;
    setTimeout(() => {
      if (isOpen || document.hidden) return;
      if (document.querySelector('.mobile-nav.is-open, .search-modal.is-open')) return;
      const active = document.activeElement;
      if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
      open();
    }, SHOW_DELAY_MS);
  }

  function init() {
    purgeArchivedPromo();
    // Any element marked with data-welcome-open opens the offer manually
    // (homepage offer band, in-page promos).
    if (!window.__bumiWelcomeBound) {
      window.__bumiWelcomeBound = true;
      document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-welcome-open]');
        if (!trigger) return;
        event.preventDefault();
        open();
      });
    }
    scheduleAutoShow();
  }

  window.BumiWelcomePopup = { init: init, open: open, close: close };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
