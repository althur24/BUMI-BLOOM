import { prisma } from "@bumi/db";
import { corsHeaders, jsonWithCors } from "@/lib/checkout";
import { reconcileCheckout } from "@/lib/checkout-service";
import { getOrderStatusUrl } from "@/lib/shopify-checkout";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(
  request: Request,
  context: { params: { id: string } },
) {
  const respond = (body: unknown, status: number) =>
    jsonWithCors(body, status, { "Cache-Control": "no-store" }, request);

  const id = context.params.id;
  if (!id) return respond({ error: "Checkout not found." }, 404);

  let checkout;
  try {
    checkout = await prisma.stripeCheckout.findUnique({ where: { id } });
  } catch (err: any) {
    console.error("[checkout] status lookup failed", id, err?.message);
    return respond({ error: "Checkout is temporarily unavailable." }, 503);
  }
  if (!checkout) {
    return respond({ error: "Checkout not found." }, 404);
  }

  if (
    !checkout.shopifyOrderId &&
    (checkout.status === "PENDING" || checkout.status === "PAID")
  ) {
    try {
      const reconciled = await reconcileCheckout(id);
      if (reconciled) checkout = reconciled;
    } catch (err) {
      console.error("[checkout] status reconciliation failed", id, err);
    }
  }

  let stripeStatus: string | null = null;
  let paymentStatus: string | null = null;
  let clientSecret: string | null = null;
  try {
    const session = await getStripe().checkout.sessions.retrieve(
      checkout.stripeSessionId,
    );
    stripeStatus = session.status || null;
    paymentStatus = session.payment_status || null;
    if (session.status === "open") {
      clientSecret = session.client_secret || null;
    }
  } catch (err: any) {
    console.error("[checkout] failed to read Stripe session", id, err?.message);
  }

  // Customer-facing "Track order" link. Cached on the row so polling the
  // success page does not hit the Shopify Admin API every 2 seconds.
  let statusPageUrl = checkout.statusPageUrl;
  if (!statusPageUrl && checkout.shopifyOrderId) {
    statusPageUrl = await getOrderStatusUrl(checkout.shopifyOrderId);
    if (statusPageUrl) {
      try {
        await prisma.stripeCheckout.updateMany({
          where: { id: checkout.id, statusPageUrl: null },
          data: { statusPageUrl },
        });
      } catch (err: any) {
        console.error(
          "[checkout] failed to cache statusPageUrl",
          checkout.id,
          err?.message,
        );
      }
    }
  }

  return respond(
    {
      ok: true,
      checkoutId: checkout.id,
      status: checkout.status,
      orderName: checkout.shopifyOrderName,
      email: checkout.customerEmail,
      processingIssue: Boolean(checkout.errorMessage),
      stripeStatus,
      paymentStatus,
      clientSecret,
      statusPageUrl,
    },
    200,
  );
}
