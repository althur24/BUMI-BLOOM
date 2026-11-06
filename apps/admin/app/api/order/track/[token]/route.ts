import { prisma } from "@bumi/db";
import {
  corsHeaders,
  getClientIp,
  isRateLimited,
  jsonWithCors,
} from "@/lib/checkout";
import { getOrderForTracking } from "@/lib/shopify-checkout";
import { verifyTrackingToken } from "@/lib/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, read-only endpoint behind an unguessable token. No login.
// 30 requests / minute / IP is generous for page reloads and blocks scraping.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(
  request: Request,
  context: { params: { token: string } },
) {
  const respond = (body: unknown, status: number) =>
    jsonWithCors(body, status, { "Cache-Control": "no-store" }, request);

  const ip = getClientIp(request);
  if (isRateLimited(`track:${ip}`, RATE_MAX, RATE_WINDOW_MS)) {
    return respond(
      { ok: false, error: "Too many requests. Please try again shortly." },
      429,
    );
  }

  const token = (context.params.token || "").trim();
  // Tokens are 32 lowercase hex chars. Reject anything else without touching
  // the database so malformed or probing values are cheap and never throw.
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return respond({ ok: false, error: "Order not found." }, 404);
  }

  let checkout;
  try {
    checkout = await prisma.stripeCheckout.findUnique({
      where: { trackingToken: token },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderName: true,
        status: true,
      },
    });
  } catch (err: any) {
    console.error("[tracking] lookup failed", err?.message);
    return respond(
      { ok: false, error: "Order tracking is temporarily unavailable." },
      503,
    );
  }

  if (!checkout) {
    return respond({ ok: false, error: "Order not found." }, 404);
  }

  // Defensive: confirm the stored token matches the deterministic HMAC. Guards
  // against a manually edited or corrupted row.
  if (!verifyTrackingToken(checkout.id, token)) {
    return respond({ ok: false, error: "Order not found." }, 404);
  }

  if (!checkout.shopifyOrderId) {
    // Checkout is paid but Shopify has not produced the order yet. The page
    // shows "Preparing your order…" and polls again.
    return respond(
      { ok: true, state: "PREPARING", orderName: checkout.shopifyOrderName },
      200,
    );
  }

  let order = null;
  try {
    order = await getOrderForTracking(checkout.shopifyOrderId);
  } catch (err: any) {
    console.error(
      "[tracking] Shopify order read failed",
      checkout.shopifyOrderId,
      err?.message,
    );
  }

  if (!order) {
    return respond(
      { ok: false, error: "Order tracking is temporarily unavailable." },
      503,
    );
  }

  return respond(
    {
      ok: true,
      state: "READY",
      orderName: order.orderName || checkout.shopifyOrderName,
      createdAt: order.createdAt,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      totals: {
        subtotalAudCents: order.subtotalAudCents,
        shippingAudCents: order.shippingAudCents,
        totalAudCents: order.totalAudCents,
      },
      items: order.items,
      shipping: order.shipping,
      fulfillments: order.fulfillments,
    },
    200,
  );
}
