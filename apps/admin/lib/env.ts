// Non-secret env presence checks for dashboard/health display.
// Detects placeholder values (TODO_, <...>, "example") so the check reflects
// real configuration, not just a non-empty string. Never returns secret values.

function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  const s = v.trim();
  if (!s) return true;
  return (
    s.startsWith("TODO_") ||
    s.startsWith("<") ||
    /example|change-me|fill/i.test(s)
  );
}

function real(...vals: (string | undefined)[]): boolean {
  return vals.every((v) => !isPlaceholder(v));
}

// Stripe must be configured AND in the right mode. A test key in production
// (without the staging escape hatch) means real money cannot be taken, so the
// health probe must report unhealthy rather than "ok".
function stripeReady(): boolean {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!real(secret, process.env.STRIPE_WEBHOOK_SECRET)) return false;
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.ALLOW_TEST_KEYS === "true") return true;
  return !String(secret).startsWith("sk_test_");
}

export function checkEnv() {
  return {
    shopify: real(
      process.env.SHOPIFY_SHOP,
      process.env.SHOPIFY_CLIENT_ID,
      process.env.SHOPIFY_CLIENT_SECRET,
    ),
    supabase: real(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    database: real(process.env.DATABASE_URL),
    stripe: stripeReady(),
    storefront: real(process.env.STOREFRONT_URL),
  };
}
