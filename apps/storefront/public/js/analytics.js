/* ============================================
   BUMI / BLOOM — Analytics (GA4 + Meta Pixel)
   Self-contained: bootstraps both tags from the IDs
   injected via window.__BB_PUBLIC_ENV__ (set in
   app/layout.tsx from NEXT_PUBLIC_GA_ID /
   NEXT_PUBLIC_META_PIXEL_ID) and exposes
   BumiTrack.event() / BumiTrack.purchase().

   With empty IDs it stays dormant (logs to console)
   so the site works locally. Consent is granted
   directly — this store runs without a cookie banner.

   Every event carries an `eventId`. The server-side
   purchase (apps/admin/lib/checkout-analytics.ts)
   sends the SAME id as `event_id`, so Meta / GA4
   deduplicate browser + server hits.
   ============================================ */
(function () {
  'use strict';

  var env = window.__BB_PUBLIC_ENV__ || {};
  var GA_ID = String(env.gaId || '').trim();
  var PIXEL_ID = String(env.metaPixelId || '').trim();

  var enabled = {
    ga: /^G-[A-Z0-9]+$/i.test(GA_ID),
    px: /^\d{6,}$/.test(PIXEL_ID)
  };

  function newEventId() {
    // Meta expects a string id; a UUID-ish value keeps GA4 + Meta aligned.
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'bb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ── GA4 ──────────────────────────────────────────────────────────── */
  // gtag stub so calls before the library loads don't throw.
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  if (enabled.ga) {
    // No cookie banner: grant consent up front.
    window.gtag('consent', 'default', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted'
    });
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var gaScript = document.createElement('script');
    gaScript.async = true;
    gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(gaScript);
  }

  /* ── Meta Pixel ───────────────────────────────────────────────────── */
  if (enabled.px) {
    /* Meta Pixel base code (standard loader) */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('consent', 'grant');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  /* ── Event name mapping ───────────────────────────────────────────── */
  var FB_MAP = {
    view_item_list: 'ViewContent',
    view_item: 'ViewContent',
    add_to_cart: 'AddToCart',
    add_to_wishlist: 'AddToWishlist',
    begin_checkout: 'InitiateCheckout',
    add_payment_info: 'AddPaymentInfo',
    purchase: 'Purchase',
    generate_lead: 'Lead'
  };

  function toFbPayload(params) {
    var items = params.items || [];
    var payload = {
      value: Number(params.value || 0),
      currency: params.currency || 'AUD',
      content_ids: items.map(function (i) { return i.id; }),
      content_type: 'product',
      num_items: items.reduce(function (sum, i) { return sum + Number(i.quantity || 1); }, 0)
    };
    if (params.transaction_id) payload.order_id = params.transaction_id;
    if (items.length === 1 && items[0].name) payload.content_name = items[0].name;
    return payload;
  }

  /**
   * Fire a standard event at GA4 + Meta Pixel.
   * @param {string} name  GA4 event name (snake_case)
   * @param {object} [params] { value, currency, items:[{id,name,price,quantity}], transaction_id, event_id }
   */
  function event(name, params) {
    params = params || {};
    var eventId = params.event_id || newEventId();
    var items = params.items || [];

    if (enabled.ga) {
      var gaParams = {};
      for (var key in params) {
        if (key === 'event_id' || key === 'items') continue;
        gaParams[key] = params[key];
      }
      if (items.length) {
        gaParams.currency = params.currency || 'AUD';
        gaParams.items = items.map(function (i) {
          return { item_id: i.id, item_name: i.name, price: Number(i.price || 0), quantity: Number(i.quantity || 1) };
        });
      }
      window.gtag('event', name, gaParams);
    }

    if (enabled.px && typeof window.fbq === 'function') {
      var fbName = FB_MAP[name] || 'CustomEvent';
      try {
        var opts = { eventID: eventId };
        if (fbName === 'CustomEvent') {
          window.fbq('trackCustom', name, toFbPayload(params), opts);
        } else {
          window.fbq('track', fbName, toFbPayload(params), opts);
        }
      } catch (e) { /* ignore */ }
    }

    if (!enabled.ga && !enabled.px) console.debug('[BumiTrack]', name, params, eventId);
    return eventId;
  }

  /**
   * Fire the purchase event. Browser + server (Meta CAPI / GA4 MP) share the
   * same event_id so the platforms deduplicate.
   * @param {object} data { transaction_id, value, currency, items, event_id }
   */
  function purchase(data) {
    data = data || {};
    return event('purchase', {
      transaction_id: data.transaction_id || data.event_id,
      value: Number(data.value || 0),
      currency: data.currency || 'AUD',
      items: data.items || [],
      event_id: data.event_id
    });
  }

  window.BumiTrack = {
    event: event,
    purchase: purchase,
    enabled: enabled,
    newEventId: newEventId
  };
})();
