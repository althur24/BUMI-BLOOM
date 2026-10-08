import { NextResponse } from "next/server";
import { requireAdmin, jsonError } from "@/lib/auth";
import { getAnalyticsSummary } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// GET ?range=7d|30d → sales summary from Shopify Admin API.
// Visitor counts are not available via API (see shopifyAnalyticsUrl link).
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  const u = new URL(request.url);
  const range = u.searchParams.get("range") === "30d" ? "30d" : "7d";

  try {
    const summary = await getAnalyticsSummary(range);
    const shop = process.env.SHOPIFY_SHOP;
    return NextResponse.json({
      ...summary,
      shopifyAnalyticsUrl: shop
        ? `https://${shop}.myshopify.com/admin/reports`
        : null,
    });
  } catch (e: any) {
    return jsonError(502, `Analytics gagal: ${e?.message || e}`);
  }
}
