export const STOREFRONT_CHAIN = [
  '/js/analytics.js',
  '/js/app.js',
  '/js/cart.js',
  '/js/currency.js',
  '/js/data.js',
  '/js/wishlist.js',
  '/js/welcome-popup.js',
];

// Pages that carry a capability token in their URL (e.g. /order/<token>) must
// not hand that URL to GA4/Meta. This chain keeps the app scripts but leaves
// analytics.js out.
export const STOREFRONT_CHAIN_NO_ANALYTICS = STOREFRONT_CHAIN.filter(
  (src) => src !== '/js/analytics.js',
);
