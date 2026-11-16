/**
 * BUMI / BLOOM — Welcome offer (email capture → 10% code)
 *
 * - Shows a single modal to new visitors (default 4s), once per ~30 days.
 * - Never auto-opens on checkout / order pages; instead those pages use an
 *   inline form marked with `data-welcome-form` (see checkout.html).
 * - The discount code is only revealed after a successful signup. Nothing in
 *   this file (or any other public asset) contains the code.
 */
(function () {
  'use strict';
  if (window.BumiWelcomePopup) return;

  const SEEN_KEY = 'bb-welcome-seen';
  const SUBSCRIBED_KEY = 'bb-welcome-subscribed';
  const PROMO_KEY = 'bb-promo';
  const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const SHOW_DELAY_MS = 4000;
  const EXCLUDED_PATH = /^\/(checkout|cart|order)(\/|$)/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let dialog = null;
  let form = null;
  let msg = null;
  let body = null;
  let done = null;
  let codeEl = null;
  let isOpen = false;
  let returnFocus = null;

  /* ── Storage helpers (private mode safe) ─────────────────────────────── */
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }
  function isSubscribed() {
    return storageGet(SUBSCRIBED_KEY) === '1';
  }
  function recentlySeen() {
    const at = Number(storageGet(SEEN_KEY) || 0);
    return at > 0 && Date.now() - at < SEEN_TTL_MS;
  }

  function apiBase() {
    const env = window.__BB_PUBLIC_ENV__ || {};
    return String(
      (window.BumiConfig && BumiConfig.adminApiUrl) ||
        env.checkoutApiUrl ||
        'http://localhost:4001',
    ).replace(/\/+$/, '');
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
          '<p class="welcome-popup__eyebrow">Welcome offer</p>' +
          '<h2 class="welcome-popup__title" id="welcome-popup-title">Get <span class="script-accent">10% off</span> your first order</h2>' +
          '<p class="welcome-popup__text" id="welcome-popup-text">Join the BUMI / BLOOM list for new drops, restocks and local stories — we\'ll show your welcome code right here.</p>' +
          '<form class="welcome-popup__form" data-welcome-form="POPUP" novalidate>' +
            '<label class="sr-only" for="welcome-popup-email">Email address</label>' +
            '<input class="welcome-popup__input" id="welcome-popup-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="Your email address" required>' +
            '<button class="btn btn--primary welcome-popup__submit" type="submit">Get my 10% off</button>' +
          '</form>' +
          '<p class="welcome-popup__msg" data-welcome-msg role="status" aria-live="polite"></p>' +
          '<p class="welcome-popup__fine">No spam, unsubscribe anytime.</p>' +
          '<button class="welcome-popup__decline" type="button" data-welcome-close>No thanks</button>' +
        '</div>' +
        '<div class="welcome-popup__body welcome-popup__body--done" data-welcome-done hidden>' +
          '<p class="welcome-popup__eyebrow">You\'re in 🎉</p>' +
          '<h2 class="welcome-popup__title">Here\'s your <span class="script-accent">10% off</span></h2>' +
          '<div class="welcome-popup__code">' +
            '<span class="welcome-popup__code-value" data-welcome-code>—</span>' +
            '<button class="welcome-popup__copy" type="button" data-welcome-copy>Copy code</button>' +
          '</div>' +
          '<p class="welcome-popup__text">Applied to your bag automatically — it will also be waiting on the checkout page.</p>' +
          '<a class="btn btn--primary welcome-popup__cta" href="/products?category=new">Start shopping</a>' +
          '<button class="welcome-popup__decline" type="button" data-welcome-close>Maybe later</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(root);
    dialog = root.querySelector('.welcome-popup__dialog');
    form = root.querySelector('[data-welcome-body] .welcome-popup__form');
    msg = root.querySelector('[data-welcome-body] [data-welcome-msg]');
    body = root.querySelector('[data-welcome-body]');
    done = root.querySelector('[data-welcome-done]');
    codeEl = root.querySelector('[data-welcome-code]');

    root.addEventListener('click', (event) => {
      const closer = event.target.closest('[data-welcome-close]');
      if (closer) {
        close();
        return;
      }
      if (event.target.closest('[data-welcome-copy]')) copyCode();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitEmail(form);
    });

    root.addEventListener('keydown', trapFocus);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen) close();
    });

    root.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => setMessage('', null));
    });
  }

  function setMessage(text, tone) {
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'welcome-popup__msg' + (tone ? ' welcome-popup__msg--' + tone : '');
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
    const first = dialog.querySelector('input, button, a[href]');
    if (first) setTimeout(() => first.focus(), 200);
  }

  function close() {
    const root = document.getElementById('welcome-popup');
    if (!root || !isOpen) return;
    isOpen = false;
    root.classList.remove('is-open');
    // remember the dismissal so a careful "no thanks" is respected
    if (!isSubscribed()) storageSet(SEEN_KEY, String(Date.now()));
    setTimeout(() => { root.hidden = true; }, 250);
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    returnFocus = null;
  }

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
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

  /* ── Signup ──────────────────────────────────────────────────────────── */
  async function postSubscribe(email, source) {
    const res = await fetch(apiBase() + '/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, source: source }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  function submitEmail(formEl, sourceOverride) {
    const source = sourceOverride || formEl.dataset.welcomeForm || 'POPUP';
    const input = formEl.querySelector('input[type="email"]');
    const button = formEl.querySelector('button[type="submit"]');
    const inline = source !== 'POPUP';
    const inlineMsg = formEl.parentElement
      ? formEl.parentElement.querySelector('[data-welcome-inline-msg]')
      : null;
    const report = (text, tone) => {
      if (inline && inlineMsg) {
        inlineMsg.textContent = text || '';
        inlineMsg.className =
          'welcome-inline__msg' + (tone ? ' welcome-inline__msg--' + tone : '');
      } else {
        setMessage(text, tone);
      }
    };

    const email = String((input && input.value) || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      report('Please enter a valid email address.', 'err');
      if (input) input.focus();
      return;
    }

    const original = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Just a moment…';
    }
    report('', null);

    postSubscribe(email, source)
      .then((data) => {
        const code = String((data && data.code) || '').trim();
        if (!code) throw new Error('No code returned');
        remember(data);
        if (window.BumiTrack) {
          BumiTrack.event('generate_lead', { currency: 'AUD', value: 0 });
        }
        if (inline) {
          report('Code ' + code + ' applied — see your discount below. Valid at checkout.', 'ok');
          if (input) input.disabled = true;
          if (button) button.textContent = 'Code applied ✓';
          const block = formEl.closest('.welcome-inline');
          if (block) block.dataset.welcomeDone = '1';
        } else {
          if (codeEl) codeEl.textContent = code;
          if (body) body.hidden = true;
          if (done) done.hidden = false;
        }
      })
      .catch((err) => {
        report((err && err.message) || 'Something went wrong. Please try again.', 'err');
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
      });
  }

  /* Store the welcome promo + mark this visitor as subscribed. */
  function remember(data) {
    const code = String((data && data.code) || '').trim();
    if (!code) return;
    storageSet(SUBSCRIBED_KEY, '1');
    storageSet(SEEN_KEY, String(Date.now()));
    if (window.BumiCart && typeof BumiCart.applyPromo === 'function') {
      BumiCart.applyPromo(code, {
        code: code,
        label: (data && data.label) || 'Welcome — 10% off',
        rate: data && Number.isFinite(Number(data.rate)) ? Number(data.rate) : undefined,
      });
    } else {
      storageSet(
        PROMO_KEY,
        JSON.stringify({
          code: code,
          label: (data && data.label) || 'Welcome — 10% off',
          ...(data && Number.isFinite(Number(data.rate)) ? { rate: Number(data.rate) } : {}),
        }),
      );
    }
  }

  function copyCode() {
    const code = codeEl ? codeEl.textContent.trim() : '';
    if (!code) return;
    const doneCopy = () => {
      const btn = dialog.querySelector('[data-welcome-copy]');
      if (!btn) return;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = 'Copy code'; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(doneCopy, doneCopy);
    } else {
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      sel.removeAllRanges();
      doneCopy();
    }
  }

  /* ── Inline forms (checkout / cart) ──────────────────────────────────── */
  function initInlineForms() {
    document.querySelectorAll('form[data-welcome-form]').forEach((formEl) => {
      if (formEl.dataset.welcomeBound === '1') return;
      formEl.dataset.welcomeBound = '1';
      formEl.addEventListener('submit', (event) => {
        event.preventDefault();
        submitEmail(formEl);
      });
    });
    syncInlineVisibility();
    window.addEventListener('promo-updated', syncInlineVisibility);
  }

  // The inline offer sits next to the discount field, so once a code is already
  // applied it would just be noise. Keep it visible if the shopper just used it.
  function syncInlineVisibility() {
    const promo = window.BumiCart && typeof BumiCart.getPromo === 'function' ? BumiCart.getPromo() : null;
    const hasPromo = !!(promo && promo.code);
    document.querySelectorAll('.welcome-inline').forEach((block) => {
      if (block.dataset.welcomeDone === '1') return;
      block.hidden = hasPromo;
    });
  }

  /* ── Auto-show for new visitors ──────────────────────────────────────── */
  function scheduleAutoShow() {
    if (isSubscribed() || recentlySeen() || EXCLUDED_PATH.test(location.pathname)) return;
    setTimeout(() => {
      if (isOpen || document.hidden) return;
      if (document.querySelector('.mobile-nav.is-open, .search-modal.is-open')) return;
      const active = document.activeElement;
      if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
      open();
    }, SHOW_DELAY_MS);
  }

  function init() {
    initInlineForms();
    // Any button/link marked with data-welcome-open opens the offer manually
    // (homepage offer band, future in-page promos).
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

  window.BumiWelcomePopup = {
    init: init,
    open: open,
    close: close,
    remember: remember,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
