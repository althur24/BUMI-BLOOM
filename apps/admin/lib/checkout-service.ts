import { prisma } from "@bumi/db";
import { StripeCheckoutStatus } from "@prisma/client";
import {
  CheckoutError,
  checkoutCartHash,
  computeShippingCents,
  isMissingTableError,
  normalizePromoCode,
  parseCheckoutItems,
  totalsWithShipping,
  warnMissingTable,
  type CheckoutQuote,
  type CheckoutShippingOption,
  type ResolvedCheckoutItem,
} from "./checkout";
import {
  assertDiscountUsable,
  computeDiscountCents,
  createShopifyOrderFromCheckout,
  fetchCheckoutVariants,
  fetchShopifyDiscount,
  fetchShopifyShippingRates,
} from "./shopify-checkout";
import { sendPurchaseAnalytics } from "./checkout-analytics";
import { getStripe } from "./stripe";
import { createTrackingToken } from "./tracking";

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

  // Shopify is the single source of truth for shipping methods. Pulling the
  // rates here means editing them in Shopify Admin automatically updates the
  // options shown in the Stripe payment form.
  let shippingOptions: CheckoutShippingOption[] | undefined;
  try {
    const rates = await fetchShopifyShippingRates(
      items.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
        priceAudCents: item.priceAudCents,
      })),
      subtotalAudCents,
      undefined,
      discountAudCents,
    );
    if (rates.length) {
      shippingOptions = rates.map((rate) => ({
        title: rate.title,
        amountCents: rate.amountCents,
      }));
    }
  } catch (err: any) {
    console.error(
      "[checkout] failed to load Shopify shipping rates",
      err?.message,
    );
  }

  const baseTotals = totalsWithShipping(
    subtotalAudCents,
    discountAudCents,
    shippingOptions
      ? Math.min(...shippingOptions.map((option) => option.amountCents))
      : computeShippingCents(
          subtotalAudCents -
            Math.max(0, Math.min(discountAudCents, subtotalAudCents)),
        ),
  );
  const quote: CheckoutQuote = {
    ...baseTotals,
    ...(shippingOptions ? { shippingOptions } : {}),
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

// Order confirmation is sent by Shopify itself: draftOrderComplete triggers
// the store's notification automatically. We must NOT send a second email via
// orderInvoiceSend, so no explicit confirmation step exists here.
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
    // Order already exists. Shopify sent its own confirmation on completion.
    return checkout;
  }

  if (inFlightOrders.has(checkout.id)) {
    // Another concurrent delivery is creating this order. Skip — the in-flight
    // call, or a subsequent webhook/status poll, will handle it.
    return checkout;
  }
  inFlightOrders.add(checkout.id);

  try {
    // Deterministic from the checkout id, so it exists before the draft order
    // is created and can be embedded in its custom attributes. The same value
    // is persisted on the row below.
    const trackingToken = checkout.trackingToken || createTrackingToken(checkout.id);
    const order = await createShopifyOrderFromCheckout(
      checkout,
      session,
      trackingToken,
    );
    // The chosen shipping method can differ from the pre-payment estimate, so
    // reconcile against what Stripe actually charged.
    const actualShippingCents = Math.max(
      0,
      Number(session?.shipping_cost?.amount_total ?? checkout.shippingAudCents) ||
        0,
    );
    const actualTotalCents = Math.max(
      0,
      Number(session?.amount_total ?? checkout.amountAudCents) || 0,
    );
    const issues: string[] = [];
    if (order.totalAudCents == null) {
      issues.push("Shopify order total is unavailable.");
    } else if (order.totalAudCents !== actualTotalCents) {
      issues.push(
        `Shopify total ${order.totalAudCents} differs from Stripe ${actualTotalCents}.`,
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
        shippingAudCents: actualShippingCents,
        amountAudCents: actualTotalCents,
        trackingToken,
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
    // Order already exists; Shopify sent its own confirmation on completion.
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
