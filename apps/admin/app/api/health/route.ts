import { checkEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Lightweight readiness probe for Railway health checks.
// Reports config presence WITHOUT exposing secret values (placeholders are
// detected as "not configured"). checks.stripeMode shows which Stripe mode is
// active ("test"/"live") so a test-key-in-production is visible at a glance.
export async function GET() {
  const checks = checkEnv();
  // Stripe is included: a build that cannot take payments must not be promoted
  // as healthy by the platform health check.
  const ok =
    checks.shopify && checks.supabase && checks.database && checks.stripe;
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      service: "bumi-admin",
      time: new Date().toISOString(),
      checks,
    },
    { status: ok ? 200 : 503 },
  );
}
