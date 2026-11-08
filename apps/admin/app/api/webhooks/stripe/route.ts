import { prisma } from "@bumi/db";
import { StripeCheckoutStatus } from "@prisma/client";
import { ensureShopifyOrder } from "@/lib/checkout-service";
import { createShopifyRefund } from "@/lib/shopify-checkout";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function paymentIntentId(value: any): string | null {
  if (typeof value === "string") return value;
  return value?.id || null;
}

async function resolveChargeRefund(charge: any): Promise<any | null> {
  const embedded = charge.refunds?.data?.[0];
  if (embedded) return embedded;
  const list = await getStripe().refunds.list({
    charge: charge.id,
    limit: 1,
  });
  return list.data[0] || null;
}

// Record a chargeback and link it back to our checkout when the payment intent
// matches a known StripeCheckout row. Idempotent: Stripe replays events.
async function recordDispute(dispute: any): Promise<void> {
  if (!dispute?.id) return;

  const paymentIntent = paymentIntentId(dispute.payment_intent);
  let checkoutId: string | null = null;
  let shopifyOrderId: string | null = null;

  if (paymentIntent) {
    const checkout = await prisma.stripeCheckout.findFirst({
      where: { stripePaymentIntentId: paymentIntent },
      select: { id: true, shopifyOrderId: true },
    });
    checkoutId = checkout?.id || null;
    shopifyOrderId = checkout?.shopifyOrderId || null;
  }

  const evidenceDueBy =
    typeof dispute.evidence_details?.due_by === "number"
      ? new Date(dispute.evidence_details.due_by * 1000)
      : null;

  const data = {
    stripeChargeId: String(dispute.charge || ""),
    stripePaymentIntentId: paymentIntent,
    checkoutId,
    shopifyOrderId,
    amountAudCents: Number(dispute.amount) || 0,
    currency: dispute.currency || null,
    reason: dispute.reason || null,
    status: String(dispute.status || "warning_needs_response"),
    evidenceDueBy,
  };

  try {
    await prisma.dispute.upsert({
      where: { id: String(dispute.id) },
      create: { id: String(dispute.id), ...data },
      update: data,
    });
  } catch (err: any) {
    // Never let dispute bookkeeping fail the webhook ack — Stripe would retry
    // the whole event and the money-relevant handlers already succeeded.
    console.error("[stripe] dispute record failed", dispute.id, err?.message);
  }

  console.error(
    `[stripe] dispute ${dispute.status || "created"} ${dispute.id} ` +
      `amount=${data.amountAudCents} reason=${data.reason || "-"}`,
  );
}

async function markPendingSession(session: any): Promise<void> {
  if (!session?.id) return;
  await prisma.stripeCheckout.updateMany({
    where: {
      stripeSessionId: session.id,
      status: StripeCheckoutStatus.PENDING,
    },
    data: {
      customerEmail: session?.customer_details?.email || undefined,
      stripePaymentIntentId: paymentIntentId(session.payment_intent) || undefined,
    },
  });
}

async function handleEvent(event: any): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.payment_status === "paid") {
      await ensureShopifyOrder(session);
    } else {
      await markPendingSession(session);
    }
    return;
  }

  if (event.type === "checkout.session.async_payment_succeeded") {
    await ensureShopifyOrder(event.data.object);
    return;
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    await prisma.stripeCheckout.updateMany({
      where: {
        stripeSessionId: session.id,
        status: StripeCheckoutStatus.PENDING,
      },
      data: { status: StripeCheckoutStatus.EXPIRED },
    });
    return;
  }

  if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object;
    await prisma.stripeCheckout.updateMany({
      where: {
        stripePaymentIntentId: intent.id,
        status: StripeCheckoutStatus.PENDING,
      },
      data: {
        status: StripeCheckoutStatus.FAILED,
        errorMessage:
          intent.last_payment_error?.message || "Payment failed.",
      },
    });
    return;
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object;
    const intentId = paymentIntentId(charge.payment_intent);
    if (!intentId) return;

    const checkout = await prisma.stripeCheckout.findFirst({
      where: { stripePaymentIntentId: intentId },
    });
    if (!checkout) return;

    const refund = await resolveChargeRefund(charge);
    const stripeRefundId = refund?.id || null;
    const amountAudCents = Number(refund?.amount ?? charge.amount_refunded ?? 0);
    if (!stripeRefundId || amountAudCents <= 0) {
      console.error("[stripe] refund event without a refund id", charge.id);
      return;
    }

    const record = await prisma.refund.upsert({
      where: { stripeRefundId },
      create: {
        checkoutId: checkout.id,
        stripeRefundId,
        stripePaymentIntentId: intentId,
        shopifyOrderId: checkout.shopifyOrderId,
        amountAudCents,
        reason: refund?.reason || null,
        status: "STRIPE_REFUNDED",
      },
      update: {
        amountAudCents,
        shopifyOrderId: checkout.shopifyOrderId,
      },
    });

    if (record.status !== "COMPLETED") {
      if (!checkout.shopifyOrderId) {
        await prisma.refund.update({
          where: { id: record.id },
          data: {
            status: "NO_SHOPIFY_ORDER",
            errorMessage: "Shopify order mapping is missing.",
          },
        });
      } else {
        try {
          const shopifyRefundId = await createShopifyRefund(
            checkout.shopifyOrderId,
            amountAudCents,
            `Stripe refund ${stripeRefundId}`,
            {
              // Restock only on a full refund: partial refunds may keep the item.
              restock: Boolean(charge.refunded),
              locationId: process.env.SHOPIFY_INVENTORY_LOCATION_ID || null,
            },
          );
          await prisma.refund.update({
            where: { id: record.id },
            data: {
              shopifyRefundId,
              status: "COMPLETED",
              errorMessage: null,
            },
          });
        } catch (err: any) {
          await prisma.refund.update({
            where: { id: record.id },
            data: {
              status: "FAILED",
              errorMessage: err?.message || "Shopify refund failed.",
            },
          });
          throw err;
        }
      }
    }

    if (charge.refunded) {
      await prisma.stripeCheckout.update({
        where: { id: checkout.id },
        data: { status: StripeCheckoutStatus.REFUNDED },
      });
    }
    return;
  }

  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.updated" || event.type === "charge.dispute.closed") {
    await recordDispute(event.data.object);
    return;
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: "Stripe webhook secret is not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: any;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err: any) {
    console.error("[stripe] signature verification failed", err?.message);
    return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  let recorded = false;
  try {
    await prisma.stripeWebhookEvent.create({
      data: { id: event.id, type: event.type },
    });
    recorded = true;
  } catch (err: any) {
    if (err?.code === "P2002") {
      return Response.json({ received: true, duplicate: true });
    }
    console.error("[stripe] failed to record webhook event", err);
    return Response.json({ error: "Webhook storage failed." }, { status: 500 });
  }

  try {
    await handleEvent(event);
    return Response.json({ received: true });
  } catch (err: any) {
    console.error("[stripe] webhook handler failed", event.type, err?.message);
    if (recorded) {
      try {
        await prisma.stripeWebhookEvent.delete({ where: { id: event.id } });
      } catch {
        console.error("[stripe] failed to release webhook event", event.id);
      }
    }
    return Response.json({ error: "Webhook handler failed." }, { status: 500 });
  }
}
