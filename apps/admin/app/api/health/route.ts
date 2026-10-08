import { checkEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Lightweight readiness probe for Railway health checks.
// Reports config presence WITHOUT exposing secret values (placeholders are
// detected as "not configured").
export async function GET() {
  const checks = checkEnv();
  const ok = checks.shopify && checks.supabase && checks.database;
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
