(function () {
  'use strict';

  // Order tracking page: /order/<token>
  //
  // Reads the token from the path, fetches the read-only summary from the
  // admin API, and renders it. No PII beyond the shipping city/zip/country is
  // ever returned by the endpoint. The GST row stays hidden until the store is
  // registered for GST.

  const env = window.__BB_PUBLIC_ENV__ || {};
  const API_BASE = String(env.checkoutApiUrl || '').replace(/\/+$/, '');

  const match = window.location.pathname.match(/\/order\/([a-f0-9]{32})\/?$/i);
  const token = match ? match[1].toLowerCase() : null;

  const els = {
    loading: document.getElementById('track-loading'),
    preparing: document.getElementById('track-preparing'),
    error: document.getElementById('track-error'),
    missing: document.getElementById('track-missing'),
    order: document.getElementById('track-order'),
    badgeRow: document.getElementById('track-status-badge-row'),
    badge: document.getElementById('track-status-badge'),
    orderName: document.getElementById('track-order-name'),
    placed: document.getElementById('track-placed'),
    shippingCard: document.getElementById('track-shipping-card'),
    address: document.getElementById('track-address'),
    items: document.getElementById('track-items'),
    subtotal: document.getElementById('track-subtotal'),
    shipping: document.getElementById('track-shipping'),
    total: document.getElementById('track-total'),
    fulfilmentCard: document.getElementById('track-fulfilment-card'),
    fulfilment: document.getElementById('track-fulfilment'),
  };

  const STATES = ['loading', 'preparing', 'error', 'missing', 'order'];
  let attempts = 0;
  let failures = 0;
  let timer = null;

  // Give up polling after this many attempts (~2 minutes at the normal cadence)
  // and show the "temporarily unavailable" state instead of a false 404.
  const MAX_ATTEMPTS = 40;
  const MAX_FAILURES = 8;
  // Progressive retry: 4s, then 8s, then 15s for repeated failures.
  const RETRY_DELAYS = [4000, 8000, 15000];

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

  function money(cents) {
    if (cents == null) return '—';
    if (window.BumiCurrency && typeof window.BumiCurrency.format === 'function') {
      return window.BumiCurrency.format(cents / 100);
    }
    return '$' + (cents / 100).toFixed(2);
  }

  function formatDate(value) {
    if (!value) return 'recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'recently';
    return date.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function paymentLabel(financialStatus) {
    const value = String(financialStatus || '').toUpperCase();
    if (value === 'REFUNDED' || value === 'PARTIALLY_REFUNDED') return 'Refunded';
    if (value === 'VOIDED') return 'Cancelled';
    return 'Paid';
  }

  function renderSteps(financialStatus, fulfillmentStatus) {
    const financial = String(financialStatus || '').toUpperCase();
    const fulfilment = String(fulfillmentStatus || '').toUpperCase();

    // Shopify's displayFulfillmentStatus has no DELIVERED value — delivery is
    // inferred from carrier tracking events, so the stepper tops out at Shipped.
    let reached = 0; // 0 = paid only
    if (fulfilment === 'FULFILLED') reached = 2;
    else if (fulfilment === 'PARTIALLY_FULFILLED' || fulfilment === 'IN_PROGRESS') reached = 1;

    const steps = document.querySelectorAll('.track-step');
    steps.forEach((step, index) => {
      step.classList.remove('is-done', 'is-current');
      if (index < reached) step.classList.add('is-done');
      if (index === reached) step.classList.add('is-current');
    });

    if (financial === 'REFUNDED' || financial === 'VOIDED') {
      steps.forEach((step) => step.classList.remove('is-done', 'is-current'));
    }
  }

  function renderTotals(data) {
    const totals = data.totals || {};
    if (els.subtotal) els.subtotal.textContent = money(totals.subtotalAudCents);
    if (els.shipping) els.shipping.textContent = money(totals.shippingAudCents);
    if (els.total) els.total.textContent = money(totals.totalAudCents);
  }

  function renderItems(items) {
    if (!els.items) return;
    els.items.innerHTML = (items || [])
      .map((item) => {
        const media = item.image
          ? '<img class="track-item__media" src="' + escapeAttr(item.image) + '" alt="" loading="lazy">'
          : '<span class="track-item__media" aria-hidden="true"></span>';
        const meta = [item.variant, 'Qty ' + item.quantity].filter(Boolean).join(' · ');
        return (
          '<li class="track-item">' +
          media +
          '<div class="track-item__body">' +
          '<div class="track-item__title">' + escapeHtml(item.title || 'Item') + '</div>' +
          '<div class="track-item__meta">' + escapeHtml(meta) + '</div>' +
          '</div>' +
          '<div class="track-item__price">' + money(item.priceAudCents) + '</div>' +
          '</li>'
        );
      })
      .join('');
  }

  function renderAddress(shipping) {
    if (!shipping || !els.address || !els.shippingCard) return;
    const parts = [shipping.name, shipping.city, shipping.zip, shipping.country]
      .filter(Boolean)
      .map(escapeHtml);
    if (!parts.length) return;
    els.address.innerHTML = '<strong>' + (parts[0] || '') + '</strong><br>' + parts.slice(1).join(' · ');
    els.shippingCard.hidden = false;
  }

  function renderFulfilment(fulfillments) {
    if (!els.fulfilment || !els.fulfilmentCard) return;
    const rows = (fulfillments || []).filter(
      (f) => f.trackingNumber || f.trackingUrl,
    );
    if (!rows.length) {
      els.fulfilmentCard.hidden = true;
      return;
    }
    els.fulfilment.innerHTML = rows
      .map((f) => {
        const parts = [];
        if (f.company) parts.push('<div class="track-fulfilment__row"><span>Carrier</span><strong>' + escapeHtml(f.company) + '</strong></div>');
        if (f.trackingNumber) parts.push('<div class="track-fulfilment__row"><span>Tracking number</span><strong>' + escapeHtml(f.trackingNumber) + '</strong></div>');
        if (f.trackingUrl) parts.push('<div class="track-fulfilment__row"><a class="btn btn--secondary btn--sm" href="' + escapeAttr(f.trackingUrl) + '" target="_blank" rel="noopener">Track shipment</a></div>');
        return parts.join('');
      })
      .join('');
    els.fulfilmentCard.hidden = false;
  }

  function renderOrder(data) {
    if (els.orderName) els.orderName.textContent = data.orderName || 'Your order';
    if (els.placed) els.placed.textContent = 'Placed ' + formatDate(data.createdAt);

    const label = paymentLabel(data.financialStatus);
    if (els.badge) {
      els.badge.textContent = label;
      els.badge.className = 'track-badge' + (label === 'Refunded' || label === 'Cancelled' ? ' track-badge--refunded' : '');
    }

    renderSteps(data.financialStatus, data.fulfillmentStatus);
    renderAddress(data.shipping);
    renderItems(data.items);
    renderTotals(data);
    renderFulfilment(data.fulfillments);
    show('order');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  async function poll() {
    attempts += 1;
    if (attempts > MAX_ATTEMPTS) {
      // Never report "not found" for a transient outage — that would tell the
      // customer their order disappeared.
      show('error');
      return;
    }

    let res = null;
    try {
      res = await fetch(
        API_BASE + '/api/order/track/' + encodeURIComponent(token),
        { cache: 'no-store' },
      );
    } catch {
      res = null;
    }

    if (res) {
      if (res.status === 404) {
        show('missing');
        return;
      }

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) {
          failures = 0;
          if (data.state === 'PREPARING') {
            show('preparing');
          } else {
            renderOrder(data);
            return;
          }
        } else {
          failures += 1;
        }
      } else if (res.status === 429) {
        // Rate limited: keep the last state and wait longer before retrying.
        timer = setTimeout(poll, 10000);
        return;
      } else {
        // 5xx / 503: server or Shopify unavailable.
        failures += 1;
      }
    } else {
      // Network failure.
      failures += 1;
    }

    if (failures >= MAX_FAILURES) {
      show('error');
      return;
    }

    const delay = RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length - 1)];
    timer = setTimeout(poll, delay);
  }

  function init() {
    if (!token) {
      show('missing');
      return;
    }
    show('loading');
    poll();
  }

  // Manual retry resets the counters so the customer is not stuck on the error
  // screen after a short hiccup.
  function retry() {
    stop();
    attempts = 0;
    failures = 0;
    show('loading');
    poll();
  }

  const retryBtn = document.getElementById('track-retry');
  if (retryBtn) retryBtn.addEventListener('click', retry);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', stop);
})();
