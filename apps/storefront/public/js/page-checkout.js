(function () {
  'use strict';

  const env = window.__BB_PUBLIC_ENV__ || {};
  const MODE = env.checkoutMode || 'stripe';
  const API_BASE = String(env.checkoutApiUrl || '').replace(/\/+$/, '');
  const state = {
    quote: null,
    checkoutId: null,
    sessionId: null,
    embedded: null,
    pollTimer: null,
    pollCount: 0,
    busy: false,
    confirming: false,
    redirecting: false,
    paymentInfoTracked: false,
    promoCode: null,
    lines: [],
    unavailable: [],
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    empty: $('checkout-empty'),
    ready: $('checkout-ready'),
    items: $('checkout-items'),
    promoInput: $('checkout-promo-input'),
    promoApply: $('checkout-promo-apply'),
    promoMsg: $('checkout-promo-msg'),
    consent: $('checkout-consent'),
    error: $('checkout-error'),
    unavailable: $('checkout-unavailable'),
    continue: $('checkout-continue'),
    stripeSection: $('checkout-stripe-section'),
    stripeMount: $('stripe-checkout'),
    paymentBanner: $('checkout-payment-banner'),
    paymentBannerText: $('checkout-payment-banner-text'),
    processing: $('checkout-processing'),
    processingNote: $('checkout-processing-note'),
    processingSteps: $('checkout-processing-steps'),
    failed: $('checkout-failed'),
    failedMessage: $('checkout-failed-message'),
    failedActions: $('checkout-failed-actions'),
    retry: $('checkout-retry'),
    summarySubtotal: $('checkout-summary-subtotal'),
    summaryDiscountRow: $('checkout-summary-discount-row'),
    summaryDiscountLabel: $('checkout-summary-discount-label'),
    summaryDiscount: $('checkout-summary-discount'),
    summaryShipping: $('checkout-summary-shipping'),
    summaryTax: $('checkout-summary-tax'),
    summaryTotal: $('checkout-summary-total'),
    summaryNote: $('checkout-summary-note'),
    badges: $('checkout-payment-badges'),
  };

  const PAYMENT_METHOD_LABELS = {
    card: 'Card',
    link: 'Link',
    afterpay_clearpay: 'Afterpay',
    klarna: 'Klarna',
    zip: 'Zip',
    amazon_pay: 'Amazon Pay',
    cashapp: 'Cash App',
    us_bank_account: 'Bank',
  };

  function renderPaymentBadges(methods) {
    if (!els.badges || !Array.isArray(methods) || !methods.length) return;
    const labels = methods
      .map((method) => PAYMENT_METHOD_LABELS[method])
      .filter(Boolean);
    els.badges.innerHTML = labels
      .map((label) => '<span>' + esc(label) + '</span>')
      .join('');
  }

  const SESSION_KEY = 'bb-checkout-session';

  function money(cents) {
    const value = Number(cents || 0) / 100;
    if (window.BumiCurrency) return window.BumiCurrency.format(value);
    return '$' + value.toFixed(2);
  }

  function readStoredSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.checkoutId ? parsed : null;
    } catch {
      return null;
    }
  }

  function storeSession(data) {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          checkoutId: data.checkoutId,
          sessionId: data.sessionId || null,
          cartHash: data.cartHash || null,
          paid: Boolean(data.alreadyPaid),
          createdAt: Date.now(),
        }),
      );
    } catch {}
  }

  function clearStoredSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  function destroyEmbedded() {
    try {
      if (state.embedded && typeof state.embedded.destroy === 'function') {
        state.embedded.destroy();
      } else if (state.embedded && typeof state.embedded.unmount === 'function') {
        state.embedded.unmount();
      }
    } catch {}
    state.embedded = null;
    if (els.stripeMount) els.stripeMount.innerHTML = '';
  }

  function showPaymentBanner(message, kind) {
    if (!els.paymentBanner) return;
    els.paymentBanner.hidden = false;
    els.paymentBanner.classList.toggle(
      'checkout-payment-banner--error',
      kind === 'error',
    );
    els.paymentBanner.classList.toggle(
      'checkout-payment-banner--info',
      kind !== 'error',
    );
    if (els.paymentBannerText) {
      els.paymentBannerText.textContent = message;
    }
  }

  function hidePaymentBanner() {
    if (!els.paymentBanner) return;
    els.paymentBanner.hidden = true;
    els.paymentBanner.classList.remove(
      'checkout-payment-banner--error',
      'checkout-payment-banner--info',
    );
  }

  // The Stripe Checkout form owns the Pay button. Stripe fires `confirm` when
  // the customer clicks it, and our integration MUST call actions.confirm()
  // to actually start the payment. Without that call Stripe simply waits and
  // nothing happens — no loading state, no error, no redirect.
  function attachFormEvents(form, actions) {
    if (!form || typeof form.on !== 'function') return;

    form.on('confirm', async (event) => {
      // Guard against double submits (double click / slow network).
      if (state.confirming) return;
      state.confirming = true;
      showPaymentBanner('Processing your payment…', 'info');

      // The customer clicked Pay: they've entered payment details and are about
      // to be charged. Fire once per checkout session.
      if (window.BumiTrack && !state.paymentInfoTracked) {
        state.paymentInfoTracked = true;
        // getCheckoutLines() only returns {variantId, quantity}; use the cart
        // items themselves (id/name/price/quantity, same shape as add_to_cart).
        const cartItems = (window.BumiCart && BumiCart.getCart()) || [];
        const items = cartItems.map((item) => ({
          id: item.id,
          name: item.name,
          price: Number(item.price || 0),
          quantity: Number(item.quantity || 1),
        }));
        BumiTrack.event('add_payment_info', {
          currency: 'AUD',
          value: state.quote ? Number(state.quote.totalAudCents || 0) / 100 : 0,
          items,
        });
      }

      try {
        const result = await actions.confirm({
          formConfirmEvent: event,
          // Keep card/wallet payments on this page so the stepper can take
          // over. Only redirect-based methods (BNPL etc.) leave the page.
          redirect: 'if_required',
        });

        if (result && result.type === 'success') {
          // Payment confirmed. Keep the banner up; the stepper takes over.
          showProcessing();
          return;
        }

        // Stripe rejected the confirmation (card declined, 3DS cancelled, …).
        // The form keeps rendering its own inline error; show a short summary
        // above it, then clear it so a retry starts clean.
        const message =
          (result && result.error && result.error.message) ||
          'Payment could not be completed. Please check your details and try again.';
        showPaymentBanner(message, 'error');
      } catch (err) {
        console.error('[checkout] confirm failed', err);
        showPaymentBanner(
          'Payment could not be completed. Please check your details and try again.',
          'error',
        );
      } finally {
        state.confirming = false;
      }
    });

    form.on('change', (event) => {
      const status = event && event.session && event.session.status;
      // Clear a previous payment error as soon as the customer edits the form.
      if (
        !state.confirming &&
        els.paymentBanner &&
        !els.paymentBanner.hidden &&
        els.paymentBanner.classList.contains('checkout-payment-banner--error')
      ) {
        hidePaymentBanner();
      }
      // Redirect-based methods resolve asynchronously; treat `complete` as
      // the authoritative "payment finished" signal.
      if (status === 'complete') showProcessing();
      if (status === 'expired') {
        clearStoredSession();
        showFailed('This checkout session expired. Please try again.', true);
      }
    });

    form.on('loaderror', (event) => {
      console.error('[checkout] Stripe form load error', event);
      hidePaymentBanner();
      destroyEmbedded();
      setVisible('ready');
      showError('We could not load the payment form. Please try again.');
    });
  }

  async function mountCheckoutForm(clientSecret, checkoutId) {
    const stripe = window.Stripe(env.stripePublishableKey);
    if (typeof stripe.initCheckoutFormSdk !== 'function') {
      throw new Error('Stripe checkout form is not available.');
    }

    const sdk = stripe.initCheckoutFormSdk({ clientSecret, loader: 'auto' });
    const form = sdk.createForm({ layout: 'expanded' });

    // Actions are required to confirm the session when the Pay button is used.
    const actionsResult = await sdk.loadActions();
    if (!actionsResult || actionsResult.type !== 'success') {
      const reason =
        (actionsResult && actionsResult.error && actionsResult.error.message) ||
        'Payment is not available right now.';
      throw new Error(reason);
    }

    attachFormEvents(form, actionsResult.actions);

    state.checkoutId = checkoutId;
    state.embedded = form;
    state.confirming = false;
    hidePaymentBanner();
    setVisible('stripeSection');
    form.mount('#stripe-checkout');
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setVisible(name) {
    ['empty', 'ready', 'stripeSection', 'processing', 'failed'].forEach((key) => {
      if (els[key]) els[key].hidden = key !== name;
    });
  }

  function showError(message) {
    if (!els.error) return;
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    if (!els.error) return;
    els.error.textContent = '';
    els.error.hidden = true;
  }

  function setBusy(busy) {
    state.busy = busy;
    if (els.promoApply) els.promoApply.disabled = busy;
    syncContinueState();
  }

  function getCookie(name) {
    const match = document.cookie.match(
      new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'),
    );
    return match ? decodeURIComponent(match[1]) : '';
  }

  function getGaClientId() {
    const match = document.cookie.match(/(?:^|;\s*)_ga=GA\d+\.\d+\.(\d+\.\d+)/);
    return match ? match[1] : '';
  }

  function attribution() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem('bb-attribution') || '{}') || {};
    } catch {}

    const params = new URLSearchParams(window.location.search);
    const current = {
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_term: params.get('utm_term') || '',
      utm_content: params.get('utm_content') || '',
      gclid: params.get('gclid') || '',
      fbclid: params.get('fbclid') || '',
    };

    return {
      ...stored,
      ...Object.fromEntries(
        Object.entries(current).filter(([, value]) => Boolean(value)),
      ),
      fbp: getCookie('_fbp') || stored.fbp || '',
      fbc: getCookie('_fbc') || stored.fbc || '',
      gaClientId: getGaClientId() || stored.gaClientId || '',
      eventSourceUrl: stored.eventSourceUrl || window.location.href,
    };
  }

  async function postJson(path, body) {
    if (!API_BASE) throw new Error('Checkout service is not configured.');
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  }

  function cartLines() {
    if (!window.BumiCart) {
      return { lines: [], unavailable: [], total: 0, missing: true };
    }
    return window.BumiCart.getCheckoutLines();
  }

  function renderUnavailable(items) {
    if (!els.unavailable) return;
    if (!items || !items.length) {
      els.unavailable.hidden = true;
      els.unavailable.innerHTML = '';
      return;
    }

    els.unavailable.hidden = false;
    els.unavailable.innerHTML =
      '<p class="checkout-unavailable__title">' +
        (items.length === 1
          ? '1 item is no longer available'
          : items.length + ' items are no longer available') +
      '</p>' +
      '<p class="checkout-unavailable__hint">Remove them to continue with the rest of your bag.</p>' +
      '<div class="checkout-unavailable__list">' +
        items
          .map(
            (item) =>
              '<div class="checkout-unavailable__row">' +
                '<span class="checkout-unavailable__name">' +
                  esc(item.name) +
                  (item.size ? ' · ' + esc(item.size) : '') +
                  (item.color ? ' · ' + esc(item.color) : '') +
                '</span>' +
                '<span class="checkout-unavailable__reason">' + esc(item.reason) + '</span>' +
                '<button type="button" class="checkout-unavailable__remove" data-remove-index="' +
                  esc(item.index) +
                '">Remove</button>' +
              '</div>',
          )
          .join('') +
      '</div>';
  }

  function syncContinueState() {
    if (!els.continue) return;
    const hasLines = state.lines.length > 0;
    els.continue.disabled = state.busy || !hasLines;
    if (!state.busy) {
      els.continue.textContent = hasLines
        ? 'Continue to payment'
        : 'Remove unavailable items to continue';
    }
  }

  function renderItems() {
    if (!els.items) return;
    const cart = window.BumiCart ? window.BumiCart.getCart() : [];
    if (!cart.length) {
      if (els.empty) els.empty.hidden = false;
      if (els.ready) els.ready.hidden = true;
      return;
    }
    if (els.empty) els.empty.hidden = true;
    if (els.ready) els.ready.hidden = false;

    const unavailableIndexes = new Set(state.unavailable.map((entry) => entry.index));

    const fallbackImage = '/images/placeholder.png';
    els.items.innerHTML = cart
      .map((item, index) => {
        const product = window.BumiData ? window.BumiData.getProduct(item.id) : null;
        const variant = window.BumiCart ? window.BumiCart.resolveItemVariant(item) : null;
        const image = (product && product.image) || item.image || fallbackImage;
        const priceCents = variant
          ? Math.round(Number(variant.price || 0) * 100)
          : Math.round(Number(item.price || 0) * 100);
        const qty = Number(item.quantity || 1);
        const isUnavailable = unavailableIndexes.has(index);
        return (
          '<div class="checkout-item' + (isUnavailable ? ' checkout-item--unavailable' : '') + '">' +
            '<div class="checkout-item__image"><img src="' + esc(image) + '" alt="' + esc(item.name) + '" loading="lazy"></div>' +
            '<div>' +
              '<p class="checkout-item__brand">' + esc(item.brand || '') + '</p>' +
              '<p class="checkout-item__name">' + esc(item.name || '') + '</p>' +
              '<p class="checkout-item__meta">' + esc(item.color || '') + (item.color && item.size ? ' · ' : '') + esc(item.size || '') + ' · Qty ' + qty + '</p>' +
            '</div>' +
            '<div class="checkout-item__price">' + money(priceCents * qty) + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderSummary(quote) {
    if (!quote) {
      if (els.summarySubtotal) els.summarySubtotal.textContent = '—';
      if (els.summaryShipping) els.summaryShipping.textContent = '—';
      if (els.summaryTax) els.summaryTax.textContent = '—';
      if (els.summaryTotal) els.summaryTotal.textContent = '—';
      if (els.summaryDiscountRow) els.summaryDiscountRow.hidden = true;
      return;
    }
    if (els.summarySubtotal) els.summarySubtotal.textContent = money(quote.subtotalAudCents);
    if (els.summaryShipping) {
      els.summaryShipping.textContent =
        quote.shippingAudCents === 0 ? 'Free' : money(quote.shippingAudCents);
    }
    if (els.summaryTax) els.summaryTax.textContent = money(quote.taxAudCents);
    if (els.summaryTotal) els.summaryTotal.textContent = money(quote.totalAudCents);

    const promo = quote.promo;
    if (els.summaryDiscountRow && els.summaryDiscount) {
      if (promo && promo.discountAudCents > 0) {
        els.summaryDiscountRow.hidden = false;
        if (els.summaryDiscountLabel) {
          els.summaryDiscountLabel.textContent = 'Discount (' + promo.code + ')';
        }
        els.summaryDiscount.textContent = '−' + money(promo.discountAudCents);
      } else {
        els.summaryDiscountRow.hidden = true;
      }
    }

    if (els.summaryNote) {
      const discounted = quote.subtotalAudCents - quote.discountAudCents;
      const remaining = quote.freeShippingThresholdAudCents - discounted;
      if (quote.shippingAudCents === 0) {
        els.summaryNote.textContent = 'Free AU shipping applied. All prices in AUD.';
      } else if (remaining > 0) {
        els.summaryNote.textContent =
          'Add ' + money(remaining) + ' for free AU shipping. All prices in AUD.';
      } else {
        els.summaryNote.textContent = 'All prices in AUD.';
      }
    }
  }

  function showPromoMessage(message, ok) {
    if (!els.promoMsg) return;
    if (!message) {
      els.promoMsg.hidden = true;
      els.promoMsg.textContent = '';
      return;
    }
    els.promoMsg.hidden = false;
    els.promoMsg.textContent = message;
    els.promoMsg.className =
      'checkout-promo__msg' + (ok ? ' checkout-promo__msg--ok' : '');
  }

  async function refreshQuote() {
    const cart = cartLines();
    state.lines = cart.lines;
    state.unavailable = cart.unavailable || [];
    renderUnavailable(state.unavailable);
    renderItems();
    syncContinueState();

    if (!state.lines.length) {
      state.quote = null;
      renderSummary(null);
      if (state.unavailable.length) {
        showError('Remove the unavailable items above to continue.');
      }
      return null;
    }

    clearError();
    const data = await postJson('/api/checkout/validate-promo', {
      items: cart.lines,
      promoCode: state.promoCode || undefined,
    });
    state.quote = data.quote;
    renderSummary(state.quote);
    if (state.quote && state.quote.promo) {
      showPromoMessage(
        state.quote.promo.label + ' applied — ' + money(state.quote.promo.discountAudCents) + ' off.',
        true,
      );
    } else if (!state.promoCode) {
      showPromoMessage('', false);
    }
    return state.quote;
  }

  async function applyPromo() {
    if (state.busy) return;
    const code = String(els.promoInput && els.promoInput.value ? els.promoInput.value : '')
      .trim()
      .toUpperCase();

    if (!code) {
      state.promoCode = null;
      if (window.BumiCart) window.BumiCart.clearPromo();
      showPromoMessage('', false);
      clearError();
      try {
        await refreshQuote();
      } catch (err) {
        showError(err.message);
      }
      return;
    }

    setBusy(true);
    clearError();
    showPromoMessage('Checking code…', true);
    state.promoCode = code;
    try {
      await refreshQuote();
      if (window.BumiCart) window.BumiCart.applyPromo(code);
      if (els.promoInput) els.promoInput.value = code;
    } catch (err) {
      state.promoCode = null;
      if (window.BumiCart) window.BumiCart.clearPromo();
      showPromoMessage('', false);
      showError(err.message);
      try {
        await refreshQuote();
      } catch {
        state.quote = null;
      }
    } finally {
      setBusy(false);
    }
  }

  // Checkout form mode (initCheckoutFormSdk) requires the dahlia build of
  // Stripe.js. The default /v3/ build does not expose it.
  const STRIPE_JS_URL = 'https://js.stripe.com/dahlia/stripe.js';

  function loadStripeJs() {
    if (window.Stripe && window.__BB_STRIPE_DAHLIA__) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-bb-stripe-dahlia]');
      if (existing) {
        const done = () => {
          window.__BB_STRIPE_DAHLIA__ = true;
          resolve();
        };
        if (window.Stripe && window.__BB_STRIPE_DAHLIA__) return done();
        existing.addEventListener('load', done);
        existing.addEventListener('error', () =>
          reject(new Error('Stripe failed to load.')),
        );
        return;
      }
      const script = document.createElement('script');
      script.src = STRIPE_JS_URL;
      script.async = true;
      script.dataset.bbStripeDahlia = '1';
      script.onload = () => {
        window.__BB_STRIPE_DAHLIA__ = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Stripe failed to load.'));
      document.head.appendChild(script);
    });
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function showSuccess(data) {
    // `confirm` and the `change` event can both land here; only hand off once.
    if (state.redirecting) return;
    state.redirecting = true;

    stopPolling();
    markAllStepsDone();
    // Hand off to the dedicated confirmation page so the order reference is
    // bookmarkable and survives a reload. The cart is cleared first.
    const checkoutId = data.checkoutId || state.checkoutId;
    if (window.BumiCart) {
      window.BumiCart.clearCart();
      window.BumiCart.clearPromo();
    }
    destroyEmbedded();
    clearStoredSession();
    // Missing checkoutId means the order state is unknown. Send the customer
    // back to the cart (which is still populated) instead of a broken
    // success page. The email confirmation remains the backstop if the
    // payment actually succeeded.
    const target = checkoutId
      ? '/checkout/success?checkoutId=' + encodeURIComponent(checkoutId)
      : '/cart';

    // Let the progress bar finish animating to 100% and the final checkmarks
    // land before leaving the page. Reduced-motion users skip the wait.
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : 700;
    window.setTimeout(() => {
      window.location.replace(target);
    }, delay);
  }

  function showFailed(message, allowRetry = true) {
    stopPolling();
    destroyEmbedded();
    setVisible('failed');
    if (els.failedMessage) {
      els.failedMessage.textContent =
        message ||
        "We couldn't confirm your order yet. If you've been charged, please contact us.";
    }
    if (els.failedActions) els.failedActions.hidden = !allowRetry;
    if (els.retry) els.retry.hidden = !allowRetry;
  }

  async function pollStatus({ paymentStarted = false } = {}) {
    if (!state.checkoutId) return;
    state.pollCount += 1;
    if (state.pollCount > 90) {
      showFailed(
        paymentStarted
          ? "We're still confirming your order. Please check your email in a few minutes or contact us. Do not pay again."
          : "We're still confirming your order. Please check your email in a few minutes or contact us.",
        !paymentStarted,
      );
      return;
    }
    try {
      const res = await fetch(
        API_BASE + '/api/checkout/session/' + encodeURIComponent(state.checkoutId) + '/status',
        { cache: 'no-store' },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Update progress steps based on real status from the server.
        if (paymentStarted) {
          if (data.paymentStatus === 'paid') {
            updateProcessingStep(data.orderName ? 'email' : 'order');
          } else if (data.stripeStatus === 'complete') {
            updateProcessingStep('order');
          }
        }
        if (data.status === 'PAID') {
          updateProcessingStep('done');
          showSuccess(data);
          return;
        }
        if (data.status === 'EXPIRED') {
          clearStoredSession();
          showFailed(
            paymentStarted
              ? 'This checkout expired before we could confirm it. If you were charged, please contact us before retrying.'
              : 'This checkout session expired. Please try again.',
            !paymentStarted,
          );
          return;
        }
        if (data.status === 'FAILED') {
          if (!paymentStarted) clearStoredSession();
          showFailed(
            paymentStarted
              ? 'Payment could not be confirmed. If you were charged, please contact us before retrying.'
              : 'Payment could not be completed. Please try again.',
            !paymentStarted,
          );
          return;
        }
        if (!paymentStarted && data.stripeStatus === 'open' && data.clientSecret) {
          try {
            await mountEmbedded(data.clientSecret, data.checkoutId);
          } catch (mountErr) {
            console.error('[checkout] failed to mount resumed form', mountErr);
            clearStoredSession();
            hidePaymentBanner();
            setVisible('ready');
            state.checkoutId = null;
            state.sessionId = null;
            showError(
              'We could not load the payment form. Please try again.',
            );
          }
          return;
        }
      }
    } catch {}
    state.pollTimer = setTimeout(
      () => pollStatus({ paymentStarted }),
      2000,
    );
  }

  function updateProcessingStep(step, data) {
    if (els.processingSteps) {
      const steps = els.processingSteps.querySelectorAll('[data-step]');
      for (const el of steps) {
        const name = el.dataset.step;
        const spinner = el.querySelector('.checkout-step__spinner');
        const check = el.querySelector('.checkout-step__check');
        if (name === step) {
          el.classList.add('is-active');
          if (spinner) spinner.hidden = false;
          if (check) check.hidden = true;
        } else if (el.classList.contains('is-active')) {
          el.classList.remove('is-active');
          el.classList.add('is-done');
          if (spinner) spinner.hidden = true;
          if (check) check.hidden = false;
        }
      }
    }

    const bar = document.getElementById('checkout-processing-bar');
    if (bar) {
      const pct = { payment: 20, order: 60, email: 88, done: 100 };
      bar.style.width = (pct[step] || 10) + '%';
    }

    if (els.processingNote) {
      const messages = {
        payment: 'Confirming your payment with Stripe…',
        order: 'Creating your order…',
        email: 'Finalising your order…',
        done: 'All done! Redirecting…',
      };
      const next = messages[step] || 'Processing…';
      // Swap the copy while it is faded out so the text does not snap between
      // states. Skipped when the message is unchanged to avoid a pointless blink.
      if (els.processingNote.textContent !== next) {
        els.processingNote.classList.add('is-fading');
        window.setTimeout(() => {
          els.processingNote.textContent = next;
          els.processingNote.classList.remove('is-fading');
        }, 150);
      }
    }
  }

  function markAllStepsDone() {
    if (!els.processingSteps) return;
    els.processingSteps.querySelectorAll('[data-step]').forEach((el) => {
      el.classList.remove('is-active');
      el.classList.add('is-done');
      const spinner = el.querySelector('.checkout-step__spinner');
      const check = el.querySelector('.checkout-step__check');
      if (spinner) spinner.hidden = true;
      if (check) check.hidden = false;
    });
    const bar = document.getElementById('checkout-processing-bar');
    if (bar) bar.style.width = '100%';
  }

  function showProcessing() {
    // `confirm` success and the `change` event can both fire. Only start the
    // stepper/polling once.
    if (els.processing && !els.processing.hidden) return;
    hidePaymentBanner();
    setVisible('processing');
    state.pollCount = 0;
    updateProcessingStep('payment');
    stopPolling();
    pollStatus({ paymentStarted: true });
  }

  async function mountEmbedded(clientSecret, checkoutId) {
    await loadStripeJs();
    destroyEmbedded();
    await mountCheckoutForm(clientSecret, checkoutId);
  }

  async function startPayment() {
    if (state.busy) return;
    if (!state.lines.length) {
      showError('Remove the unavailable items above to continue.');
      return;
    }
    clearError();
    showPromoMessage('', false);

    let quote;
    try {
      quote = await refreshQuote();
    } catch (err) {
      showError(err.message);
      return;
    }

    if (!quote || !state.lines.length) {
      return;
    }

    if (!env.stripePublishableKey) {
      showError('Stripe is not configured yet.');
      return;
    }

    setBusy(true);
    try {
      const data = await postJson('/api/checkout/session', {
        items: state.lines,
        promoCode: state.promoCode || undefined,
        consentMarketing: Boolean(els.consent && els.consent.checked),
        attribution: attribution(),
      });

      state.checkoutId = data.checkoutId;
      state.sessionId = data.sessionId;
      storeSession(data);
      if (data.paymentMethods) renderPaymentBadges(data.paymentMethods);

      if (data.quote) {
        state.quote = data.quote;
        renderSummary(data.quote);
      }

      if (data.alreadyPaid || data.processing) {
        setBusy(false);
        setVisible('processing');
        state.pollCount = 0;
        pollStatus({ paymentStarted: Boolean(data.alreadyPaid) });
        return;
      }

      if (!data.clientSecret) {
        throw new Error('Checkout could not start. Please try again.');
      }

      await mountEmbedded(data.clientSecret, data.checkoutId);
      setBusy(false);
    } catch (err) {
      setBusy(false);
      destroyEmbedded();
      clearStoredSession();
      hidePaymentBanner();
      setVisible('ready');
      state.checkoutId = null;
      state.sessionId = null;
      showError(err.message || 'Checkout could not start.');
    }
  }

  async function init() {
    if (MODE !== 'stripe') {
      window.location.replace('/cart');
      return;
    }

    const stored = readStoredSession();
    const cart = window.BumiCart ? window.BumiCart.getCart() : [];
    if (!cart.length) {
      if (stored) {
        state.checkoutId = stored.checkoutId;
        state.sessionId = stored.sessionId || null;
        setVisible('processing');
        pollStatus({ paymentStarted: Boolean(stored.paid) });
        return;
      }
      setVisible('empty');
      return;
    }

    setVisible('ready');
    renderItems();
    if (stored) {
      const stale = Date.now() - Number(stored.createdAt || 0) > 2 * 60 * 60_000;
      if (stale) {
        clearStoredSession();
      } else {
        state.checkoutId = stored.checkoutId;
        state.sessionId = stored.sessionId || null;
        setVisible('processing');
        setBusy(false);
        pollStatus({ paymentStarted: Boolean(stored.paid) });
        return;
      }
    }

    if (window.BumiData && window.BumiData.ready) {
      try {
        await window.BumiData.ready();
      } catch {}
    }

    // Catalog is now loaded: drop lines whose product/variant no longer exists
    // so a stale bag cannot wedge checkout.
    if (window.BumiCart && typeof window.BumiCart.purgeStaleCart === 'function') {
      try {
        const purged = window.BumiCart.purgeStaleCart();
        if (purged?.removed) {
          console.info('[checkout] removed ' + purged.removed + ' unavailable item(s)');
        }
      } catch {}
    }

    if (!(window.BumiCart ? window.BumiCart.getCart() : []).length) {
      setVisible('empty');
      return;
    }

    renderItems();

    const existingPromo = window.BumiCart ? window.BumiCart.getPromo() : null;
    if (existingPromo && existingPromo.code) {
      state.promoCode = String(existingPromo.code).toUpperCase();
      if (els.promoInput) els.promoInput.value = state.promoCode;
    }

    try {
      await refreshQuote();
    } catch (err) {
      if (state.promoCode) {
        state.promoCode = null;
        if (window.BumiCart) window.BumiCart.clearPromo();
        if (els.promoInput) els.promoInput.value = '';
        showPromoMessage(
          'Discount code removed — it is no longer valid for this order.',
          false,
        );
        try {
          await refreshQuote();
        } catch (retryErr) {
          showError(retryErr.message);
        }
      } else {
        showError(err.message);
      }
    }
  }

  if (els.continue) els.continue.addEventListener('click', startPayment);
  if (els.promoApply) els.promoApply.addEventListener('click', applyPromo);
  if (els.promoInput) {
    els.promoInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyPromo();
      }
    });
  }
  if (els.retry) {
    els.retry.addEventListener('click', () => {
      clearStoredSession();
      state.checkoutId = null;
      state.sessionId = null;
      window.location.reload();
    });
  }
  if (els.unavailable) {
    els.unavailable.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-remove-index]');
      if (!button || state.busy) return;
      const index = parseInt(button.dataset.removeIndex, 10);
      if (!Number.isInteger(index)) return;
      button.disabled = true;
      try {
        if (window.BumiCart) window.BumiCart.removeUnavailableItem(index);
        clearError();
        await refreshQuote();
      } catch (err) {
        showError(err.message || 'Could not update your bag. Please try again.');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
