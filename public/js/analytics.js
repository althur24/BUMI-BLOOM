/* ============================================
   BUMI / BLOOM — Analytics (GA4 + Meta Pixel)
   Self-contained: bootstraps both tags from the IDs
   below and exposes BumiTrack.event(). With the
   placeholder IDs it stays dormant (logs to console)
   so the site works locally; replace the IDs to go live.
   ============================================ */
(function () {
  'use strict';

  // TODO: replace these, then tracking goes live.
  const GA_ID = 'G-XXXXXXXXXX';        // GA4 Measurement ID
  const PIXEL_ID = 'YOUR_PIXEL_ID';    // Meta Pixel ID

  const enabled = {
    ga: !!GA_ID && GA_ID.indexOf('XXXX') === -1,
    px: !!PIXEL_ID && PIXEL_ID.indexOf('YOUR_') === -1
  };

  // gtag stub so calls before the library loads don't throw
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  if (enabled.ga) {
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  if (enabled.px) {
    /* Meta Pixel base code (standard loader) */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', PIXEL_ID);
    fbq('track', 'PageView');
  }

  const FB_MAP = {
    view_item_list: 'ViewContent',
    view_item: 'ViewContent',
    add_to_cart: 'AddToCart',
    begin_checkout: 'InitiateCheckout',
    purchase: 'Purchase',
    generate_lead: 'Lead'
  };

  function event(name, params) {
    params = params || {};
    if (enabled.ga && typeof window.gtag === 'function') {
      window.gtag('event', name, params);
    }
    if (enabled.px && typeof window.fbq === 'function') {
      try {
        window.fbq('track', FB_MAP[name] || 'CustomEvent', {
          value: params.value,
          currency: params.currency || 'AUD',
          content_ids: (params.items || []).map(function (i) { return i.id; })
        });
      } catch (e) { /* ignore */ }
    }
    // Dev visibility when no real IDs configured
    if (!enabled.ga && !enabled.px) console.debug('[BumiTrack]', name, params);
  }

  window.BumiTrack = { event: event, enabled: enabled };
})();
