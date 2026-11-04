import { prisma } from "@bumi/db";
import { StripeCheckoutStatus } from "@prisma/client";
import {
  CheckoutError,
  checkoutCartHash,
  computeTotals,
  isMissingTableError,
  normalizePromoCode,
  parseCheckoutItems,
  warnMissingTable,
  type CheckoutQuote,
  type ResolvedCheckoutItem,
} from "./checkout";
import {
  assertDiscountUsable,
  computeDiscountCents,
  createShopifyOrderFromCheckout,
  fetchCheckoutVariants,
  fetchShopifyDiscount,
  sendOrderInvoice,
} from "./shopify-checkout";
import { sendPurchaseAnalytics } from "./checkout-analytics";
import { getStripe } from "./stripe";

const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "fbp",
  "fbc",
  "gaClientId",
  "ga_client_id",
  "eventSourceUrl",
] as const;

function sanitizeAttribution(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const raw = source[key];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, 512);
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length ? out : null;
}

export interface PreparedCheckout {
  items: ResolvedCheckoutItem[];
  quote: CheckoutQuote;
  cartHash: string;
  promoCode: string | null;
  shopifyDiscountId: string | null;
  consentMarketing: boolean;
  attribution: Record<string, string> | null;
}

export async function prepareCheckout(body: any): Promise<PreparedCheckout> {
  const itemInputs = parseCheckoutItems(body?.items);
  const promoCode = normalizePromoCode(body?.promoCode);
  const variants = await fetchCheckoutVariants(
    itemInputs.map((item) => item.variantId),
  );

  const items: ResolvedCheckoutItem[] = itemInputs.map((item) => {
    const variant = variants.get(item.variantId);
    if (!variant) {
      throw new CheckoutError(
        409,
        "One or more items are no longer available. Please refresh your bag.",
      );
    }
    if (
      typeof variant.quantityAvailable === "number" &&
      variant.quantityAvailable < item.quantity
    ) {
      throw new CheckoutError(
        409,
        `Only ${variant.quantityAvailable} left of ${variant.productTitle}.`,
      );
    }
    return { ...variant, quantity: item.quantity };
  });

  const subtotalAudCents = items.reduce(
    (sum, item) => sum + item.priceAudCents * item.quantity,
    0,
  );
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);

  let discountAudCents = 0;
  let shopifyDiscountId: string | null = null;
  let promoLabel: string | null = null;

  if (promoCode) {
    const discount = await fetchShopifyDiscount(promoCode);
    if (!discount) {
      throw new CheckoutError(400, "Discount code not found.");
    }
    let webRedemptions = 0;
    try {
      webRedemptions = await prisma.promoRedemption.count({
        where: { code: promoCode },
      });
    } catch (err: any) {
      if (!isMissingTableError(err)) throw err;
      warnMissingTable("promo validation");
    }
    assertDiscountUsable(
      discount,
      subtotalAudCents,
      quantity,
      webRedemptions,
    );
    discountAudCents = computeDiscountCents(
      discount,
      subtotalAudCents,
      quantity,
    );
    shopifyDiscountId = discount.id;
    promoLabel = discount.title;
  }

  const totals = computeTotals(subtotalAudCents, discountAudCents);
  const quote: CheckoutQuote = {
    ...totals,
    promo: promoCode
      ? {
          code: promoCode,
          label: promoLabel || promoCode,
          discountAudCents,
        }
      : undefined,
  };

  return {
    items,
    quote,
    cartHash: checkoutCartHash(itemInputs, promoCode),
    promoCode,
    shopifyDiscountId,
    consentMarketing: Boolean(body?.consentMarketing),
    attribution: sanitizeAttribution(body?.attribution),
  };
}

const inFlightOrders = new Set<string>();

function paymentIntentId(session: any): string | null {
  const intent = session?.payment_intent;
  if (typeof intent === "string") return intent;
  return intent?.id || null;
}

// Sends the Shopify order confirmation exactly once.
// draftOrderComplete has no notify argument, so this is the only confirmation
// the buyer receives. Safe to call repeatedly.
//
// Two-phase claim prevents both duplicate sends and lost retries:
//   Phase 1: claim emailSendingAt = null → emailSendingAt = now
//            (atomic updateMany, so concurrent callers cannot both claim)
//   Phase 2: mark emailSentAt = now after successful delivery
//
// If phase 2 fails (DB down after email sent), the row keeps emailSendingAt
// set but emailSentAt null. The email was already delivered, so on retry we
// detect this stale claim and mark it sent rather than resending.
async function maybeSendConfirmationEmail(checkout: any): Promise<void> {
  if (!checkout?.id || !checkout.shopifyOrderId) return;
  if (checkout.emailSentAt) return;

  // Phase 1: atomic claim.
  const claimed = await prisma.stripeCheckout.updateMany({
    where: {
      id: checkout.id,
      emailSentAt: null,
      emailSendingAt: null,
    },
    data: { emailSendingAt: new Date() },
  });
  if (claimed.count === 0) {
    // Someone else is sending or already sent. Check for a stale claim
    // (emailSendingAt set but emailSentAt null for a long time) — treat as
    // already sent because the email most likely went out.
    const current = await prisma.stripeCheckout.findUnique({
      where: { id: checkout.id },
      select: { emailSendingAt: true, emailSentAt: true },
    });
    if (current?.emailSendingAt && !current.emailSentAt) {
      const claimedAt = new Date(current.emailSendingAt).getTime();
      const stale = Date.now() - claimedAt > 5 * 60_000; // 5 minutes
      if (stale) {
        await prisma.stripeCheckout.updateMany({
          where: { id: checkout.id, emailSentAt: null },
          data: { emailSentAt: current.emailSendingAt },
        });
        console.warn(
          "[checkout] stale email claim resolved",
          checkout.id,
        );
      }
    }
    return;
  }

  // Phase 2: send.
  try {
    const sent = await sendOrderInvoice(
      checkout.shopifyOrderId,
      checkout.customerEmail,
    );
    if (!sent) {
      // Email rejected. Release the claim so the next retry can attempt again.
      await prisma.stripeCheckout.updateMany({
        where: { id: checkout.id, emailSentAt: null },
        data: { emailSendingAt: null },
      });
      console.error(
        "[checkout] confirmation email rejected",
        checkout.id,
        checkout.shopifyOrderId,
      );
      return;
    }
    await prisma.stripeCheckout.updateMany({
      where: { id: checkout.id, emailSentAt: null },
      data: { emailSentAt: new Date() },
    });
  } catch (err: any) {
    // Email threw. Release the claim so the next retry can attempt again.
    try {
      await prisma.stripeCheckout.updateMany({
        where: { id: checkout.id, emailSentAt: null },
        data: { emailSendingAt: null },
      });
    } catch {}
    console.error(
      "[checkout] confirmation email error",
      checkout.id,
      err?.message,
    );
  }
}

export async function ensureShopifyOrder(session: any): Promise<any | null> {
  if (!session?.id) return null;
  if (session.payment_status !== "paid") return null;

  let checkout;
  try {
    checkout = await prisma.stripeCheckout.findUnique({
      where: { stripeSessionId: session.id },
    });
  } catch (err: any) {
    if (!isMissingTableError(err)) throw err;
    warnMissingTable("order sync");
    throw new CheckoutError(
      503,
      "Checkout tables are not migrated yet; the order cannot be recorded.",
    );
  }
  if (!checkout) return null;
  if (checkout.shopifyOrderId) {
    // Retry path: the order exists but a previous confirmation email may have
    // failed. maybeSendConfirmationEmail is idempotent, so this is safe.
    await maybeSendConfirmationEmail(checkout);
    return checkout;
  }

  if (inFlightOrders.has(checkout.id)) {
    // Another concurrent delivery is creating this order. We cannot safely
    // retry email yet (the Shopify order ID may not exist), so skip — the
    // in-flight call, or a subsequent webhook/status poll, will handle it.
    return checkout;
  }
  inFlightOrders.add(checkout.id);

  try {
    const order = await createShopifyOrderFromCheckout(checkout, session);
    const issues: string[] = [];
    if (order.totalAudCents == null) {
      issues.push("Shopify order total is unavailable.");
    } else if (order.totalAudCents !== checkout.amountAudCents) {
      issues.push(
        `Shopify total ${order.totalAudCents} differs from Stripe ${checkout.amountAudCents}.`,
      );
    }
    if (
      order.financialStatus &&
      !["PAID", "PARTIALLY_PAID"].includes(order.financialStatus)
    ) {
      issues.push(`Shopify financial status is ${order.financialStatus}.`);
    }
    const errorMessage = issues.length ? issues.join(" ") : null;
    if (errorMessage) {
      console.error("[checkout] order created with warnings", checkout.id, errorMessage);
    }

    // Write the Shopify mapping before any secondary bookkeeping so a failure
    // in promo/analytics can never cause the order to be created twice.
    const updated = await prisma.stripeCheckout.update({
      where: { id: checkout.id },
      data: {
        status: StripeCheckoutStatus.PAID,
        stripePaymentIntentId: paymentIntentId(session),
        customerEmail: session?.customer_details?.email || null,
        shopifyOrderId: order.orderId,
        shopifyOrderName: order.orderName,
        shopifyTotalAudCents: order.totalAudCents,
        shopifyFinancialStatus: order.financialStatus,
        errorMessage,
      },
    });

    if (checkout.promoCode) {
      try {
        await prisma.promoRedemption.upsert({
          where: { checkoutId: checkout.id },
          create: {
            code: checkout.promoCode,
            checkoutId: checkout.id,
            shopifyOrderId: order.orderId,
            customerEmail: updated.customerEmail,
            amountAudCents: checkout.discountAudCents,
          },
          update: {
            shopifyOrderId: order.orderId,
            customerEmail: updated.customerEmail,
            amountAudCents: checkout.discountAudCents,
          },
        });
      } catch (err: any) {
        if (!isMissingTableError(err)) throw err;
        warnMissingTable("promo redemption");
      }
    }

    await sendPurchaseAnalytics(updated, session);

    // Send the order confirmation once (idempotent, never fails the order).
    await maybeSendConfirmationEmail(updated);

    return updated;
  } catch (err: any) {
    const message = err?.message || "Shopify order sync failed.";
    console.error("[checkout] Shopify order sync failed", checkout.id, message);
    try {
      await prisma.stripeCheckout.update({
        where: { id: checkout.id },
        data: { errorMessage: message },
      });
    } catch {}
    throw err;
  } finally {
    inFlightOrders.delete(checkout.id);
  }
}

export async function reconcileCheckout(checkoutId: string): Promise<any | null> {
  let checkout;
  try {
    checkout = await prisma.stripeCheckout.findUnique({
      where: { id: checkoutId },
    });
  } catch (err: any) {
    if (!isMissingTableError(err)) throw err;
    warnMissingTable("status reconciliation");
    return null;
  }
  if (!checkout) return null;
  if (checkout.shopifyOrderId) {
    // Retry email on polling, not just on webhook retry. Without this, a
    // customer sitting on the success page would never get a failed email
    // reattempted until Stripe retries the webhook.
    await maybeSendConfirmationEmail(checkout);
    return checkout;
  }
  if (checkout.status === StripeCheckoutStatus.EXPIRED) return checkout;
  if (checkout.status === StripeCheckoutStatus.FAILED) return checkout;

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(
    checkout.stripeSessionId,
  );
  if (session.payment_status !== "paid") return checkout;
  return ensureShopifyOrder(session);
}
