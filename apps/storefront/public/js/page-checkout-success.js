(function () {
  'use strict';

  const env = window.__BB_PUBLIC_ENV__ || {};
  const API_BASE = String(env.checkoutApiUrl || '').replace(/\/+$/, '');

  const params = new URLSearchParams(window.location.search);
  const checkoutId = params.get('checkoutId');

  const els = {
    loading: document.getElementById('order-loading'),
    confirmed: document.getElementById('order-confirmed'),
    pending: document.getElementById('order-pending'),
    missing: document.getElementById('order-missing'),
    number: document.getElementById('order-number'),
    email: document.getElementById('order-email'),
    track: document.getElementById('order-track'),
    trackNote: document.getElementById('order-track-note'),
  };

  const STATES = ['loading', 'confirmed', 'pending', 'missing'];
  let attempts = 0;
  let timer = null;

  function show(name) {
    for (const key of STATES) {
      const el = els[key];
      if (el) el.hidden = key !== name;
    }
  }

  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function renderConfirmed(data) {
    if (els.number) {
      els.number.textContent = data.orderName || '—';
    }
    if (els.email) {
      els.email.textContent = data.email || 'Your email address';
    }
    // Prefer our own tracking page; fall back to the Shopify status page only
    // if the token could not be produced.
    const trackHref = data.trackingUrl || data.statusPageUrl || '';
    if (trackHref && els.track) {
      els.track.href = trackHref;
      els.track.hidden = false;
      if (els.trackNote) els.trackNote.hidden = true;
    } else if (els.trackNote) {
      els.trackNote.hidden = false;
    }
    show('confirmed');
  }

  async function poll() {
    attempts += 1;
    if (attempts > 60) {
      show('pending');
      return;
    }

    try {
      const res = await fetch(
        API_BASE +
          '/api/checkout/session/' +
          encodeURIComponent(checkoutId) +
          '/status',
        { cache: 'no-store' },
      );

      if (res.status === 404) {
        show('missing');
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.status === 'PAID' || data.orderName) {
          renderConfirmed(data);
          return;
        }
        if (data.status === 'FAILED' || data.status === 'EXPIRED') {
          show('missing');
          return;
        }
      }
    } catch {}

    timer = setTimeout(poll, 2000);
  }

  function init() {
    if (!checkoutId) {
      show('missing');
      return;
    }
    show('loading');
    poll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', stop);
})();
