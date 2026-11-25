// Non-secret env presence checks for dashboard/health display.
// Detects placeholder values (TODO_, <...>, "example") so the check reflects
// real configuration, not just a non-empty string. Never returns secret values.
import { stripeMode } from "./stripe";

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
    stripe: real(
      process.env.STRIPE_SECRET_KEY,
      process.env.STRIPE_WEBHOOK_SECRET,
    ),
    // Not part of the ok/503 decision — surfaced so operators can see which
    // Stripe mode is active (staging runs test keys on purpose).
    stripeMode: stripeMode(),
    storefront: real(process.env.STOREFRONT_URL),
    // Server-side purchase tracking: presence only, so an operator can confirm
    // Meta CAPI / GA4 MP are wired up without exposing the token/secret.
    metaCapi: real(
      process.env.META_PIXEL_ID,
      process.env.META_CAPI_ACCESS_TOKEN,
    ),
    ga4MeasurementProtocol: real(
      process.env.GA4_MEASUREMENT_ID,
      process.env.GA4_API_SECRET,
    ),
  };
}
