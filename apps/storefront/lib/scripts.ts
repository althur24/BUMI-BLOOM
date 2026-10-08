export const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

export const STOREFRONT_CHAIN = [
  '/js/analytics.js',
  '/js/app.js',
  '/js/cart.js',
  SUPABASE_CDN,
  '/js/supabase.js',
  '/js/currency.js',
  '/js/data.js',
  '/js/wishlist.js',
];

export const ADMIN_CHAIN = [
  SUPABASE_CDN,
  '/js/supabase.js',
  '/js/admin.js',
];
