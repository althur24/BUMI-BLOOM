import { prisma } from "@bumi/db";
import { StripeCheckoutStatus } from "@prisma/client";
import {
  BUNDLE_FLAT_CENTS,
  BUNDLE_MIN_QUANTITY,
  CheckoutError,
  checkoutCartHash,
  computeBundleDiscountCents,
  computeShippingCents,
  isMissingTableError,
  normalizeCartId,
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
  findOrderByCheckoutTag,
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
  "clientIp",
  "clientUserAgent",
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
  anonymousCartId: string | null;
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
      variant.quantityAvailable > 0 &&
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

  let promoDiscountAudCents = 0;
  let shopifyDiscountId: string | null = null;
  let promoLabel: string | null = null;

  // Automatic "3 for $69" bundle. Clothing and accessories only — busy books
  // are excluded (see isBundleEligibleProduct). It cannot be combined with a
  // discount code: when the bundle applies, the code is validated but not
  // charged, so the customer can save it for a later order.
  const bundleDiscountAudCents = computeBundleDiscountCents(items);

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
    promoDiscountAudCents = computeDiscountCents(
      discount,
      subtotalAudCents,
      quantity,
    );
    shopifyDiscountId = discount.id;
    promoLabel = discount.title;
  }

  const bundleApplied = bundleDiscountAudCents > 0;
  const appliedPromoDiscount = bundleApplied ? 0 : promoDiscountAudCents;
  const totalDiscountAudCents = Math.min(
    subtotalAudCents,
    bundleDiscountAudCents + appliedPromoDiscount,
  );

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
      totalDiscountAudCents,
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
    totalDiscountAudCents,
    shippingOptions
      ? Math.min(...shippingOptions.map((option) => option.amountCents))
      : computeShippingCents(subtotalAudCents - totalDiscountAudCents),
  );
  const quote: CheckoutQuote = {
    ...baseTotals,
    ...(shippingOptions ? { shippingOptions } : {}),
    promo: promoCode
      ? {
          code: promoCode,
          label: promoLabel || promoCode,
          discountAudCents: appliedPromoDiscount,
          ...(bundleApplied && promoDiscountAudCents > 0
            ? { blockedByBundle: true }
            : {}),
        }
      : undefined,
    bundle:
      bundleDiscountAudCents > 0
        ? {
            code: "BUNDLE3",
            label: `Any ${BUNDLE_MIN_QUANTITY} for $${BUNDLE_FLAT_CENTS / 100} — clothing & accessories`,
            discountAudCents: bundleDiscountAudCents,
          }
        : undefined,
  };

  return {
    items,
    quote,
    cartHash: checkoutCartHash(itemInputs, promoCode),
    anonymousCartId: normalizeCartId(body?.cartId),
    // A code suppressed by the bundle must not be recorded as redeemed on this
    // order, so downstream Stripe/Shopify writes treat it as absent.
    promoCode: bundleApplied ? null : promoCode,
    shopifyDiscountId: bundleApplied ? null : shopifyDiscountId,
    consentMarketing: Boolean(body?.consentMarketing),
    attribution: sanitizeAttribution(body?.attribution),
  };
}

function paymentIntentId(session: any): string | null {
  const intent = session?.payment_intent;
  if (typeof intent === "string") return intent;
  return intent?.id || null;
}

// Order confirmation is sent by Shopify itself: draftOrderComplete triggers
// the store's notification automatically. We must NOT send a second email via
// orderInvoiceSend, so no explicit confirmation step exists here.

// A crash between `stripe.checkout.sessions.create` and the DB insert leaves a
// payable session with no row. The session carries checkoutId in metadata, so
// the webhook can rebuild the minimum row needed to create the order.
async function recoverCheckoutFromSession(session: any): Promise<any | null> {
  const checkoutId = session?.metadata?.checkoutId || session?.client_reference_id;
  if (!checkoutId || typeof checkoutId !== "string") return null;

  const existing = await prisma.stripeCheckout.findUnique({
    where: { id: checkoutId },
  });
  if (existing) return existing;

  const full = await getStripe().checkout.sessions.retrieve(session.id, {
    expand: ["line_items.data.price.product"],
  } as any);
  const lineItems = (full as any).line_items?.data || [];
  const items = lineItems.map((line: any) => {
    const product = line?.price?.product;
    return {
      variantId: product?.metadata?.variantId || "",
      handle: product?.metadata?.handle || "",
      productTitle: product?.name || line?.description || "Item",
      variantTitle: line?.description || "",
      imageUrl: null,
      productType: "",
      priceAudCents: Number(line?.amount_subtotal ?? 0) /
        Math.max(1, Number(line?.quantity || 1)),
      quantity: Number(line?.quantity || 1),
    };
  }).filter((item: any) => item.variantId);

  const data = {
    id: checkoutId,
    stripeSessionId: full.id,
    stripePaymentIntentId: paymentIntentId(full),
    status: StripeCheckoutStatus.PENDING,
    cartHash: String(full.metadata?.cartHash || ""),
    subtotalAudCents: Number(full.amount_subtotal || 0),
    shippingAudCents: Number(full.total_details?.amount_shipping || 0),
    discountAudCents: Number(full.total_details?.amount_discount || 0),
    taxAudCents: Number(full.total_details?.amount_tax || 0),
    amountAudCents: Number(full.amount_total || 0),
    currency: "AUD",
    customerEmail: full.customer_details?.email || null,
    promoCode: full.metadata?.promoCode || null,
    consentMarketing: full.metadata?.consentMarketing === "true",
    itemsJson: items as any,
  };

  try {
    return await prisma.stripeCheckout.create({ data });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return prisma.stripeCheckout.findUnique({ where: { id: checkoutId } });
    }
    throw err;
  }
}

// Short enough that a crashed attempt is retried well within the customer's
// success-page polling window, long enough to cover the Shopify round-trips.
const ORDER_SYNC_CLAIM_MS = 90_000;

// Atomically claim the right to create the Shopify order for a checkout. The
// old guard was a process-local Set, which two instances do not share; this
// claim is enforced by the database.
async function claimOrderSync(checkoutId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - ORDER_SYNC_CLAIM_MS);
  const claimed = await prisma.stripeCheckout.updateMany({
    where: {
      id: checkoutId,
      shopifyOrderId: null,
      OR: [
        { orderSyncStartedAt: null },
        { orderSyncStartedAt: { lt: staleBefore } },
      ],
    },
    data: { orderSyncStartedAt: new Date() },
  });
  return claimed.count > 0;
}

export async function ensureShopifyOrder(session: any): Promise<any | null> {
  if (!session?.id) return null;
  if (session.payment_status !== "paid") return null;

  let checkout;
  try {
    checkout = await prisma.stripeCheckout.findUnique({
      where: { stripeSessionId: session.id },
    });
    if (!checkout) {
      // The session exists in Stripe but its row never reached the database.
      checkout = await recoverCheckoutFromSession(session);
    }
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

  if (!(await claimOrderSync(checkout.id))) {
    // Another delivery (webhook, status poll, second instance) holds the claim.
    // If it already finished, return the order; otherwise make the caller retry
    // instead of acking a paid event with no order.
    const latest = await prisma.stripeCheckout.findUnique({
      where: { id: checkout.id },
    });
    if (latest?.shopifyOrderId) return latest;
    throw new Error("Shopify order sync is already in progress. Retrying.");
  }

  try {
    // Tracking tokens are deterministic, so they can be embedded in the draft
    // order before completion. A missing/misconfigured secret must never stop
    // an order Shopify has already been paid for: fall back to the Shopify
    // status page link when the token cannot be produced.
    let trackingToken: string | null = checkout.trackingToken;
    if (!trackingToken) {
      try {
        trackingToken = createTrackingToken(checkout.id);
      } catch (err: any) {
        console.error(
          "[checkout] tracking token unavailable; order will fall back to the Shopify status page",
          checkout.id,
          err?.message,
        );
      }
    }

    // Crash recovery: if a previous attempt created the order but the DB write
    // failed, the order carries a `bb-checkout-<id>` tag. Reuse it instead of
    // creating a duplicate order (and a duplicate confirmation email).
    let order = await findOrderByCheckoutTag(checkout.id);
    if (!order) {
      order = await createShopifyOrderFromCheckout(
        checkout,
        session,
        trackingToken,
      );
    } else {
      console.warn(
        "[checkout] recovered existing Shopify order for checkout",
        checkout.id,
        order.orderId,
      );
    }
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
        orderSyncStartedAt: null,
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

    // Analytics must not delay the webhook ack: Stripe times the endpoint out
    // after a few seconds and then retries, which used to race order creation.
    void sendPurchaseAnalytics(updated, session).catch((err) => {
      console.error(
        "[checkout] purchase analytics failed",
        checkout.id,
        err?.message,
      );
    });

    return updated;
  } catch (err: any) {
    const message = err?.message || "Shopify order sync failed.";
    console.error("[checkout] Shopify order sync failed", checkout.id, message);
    try {
      await prisma.stripeCheckout.update({
        where: { id: checkout.id },
        data: { errorMessage: message, orderSyncStartedAt: null },
      });
    } catch {}
    throw err;
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
  if (checkout.status === StripeCheckoutStatus.REFUNDED) return checkout;

  // A failed first payment attempt or an expired session can still end up paid
  // (customer retried inside the mounted form, or the webhook was missed).
  // Always ask Stripe before concluding the checkout is dead.
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(
    checkout.stripeSessionId,
  );
  if (session.payment_status !== "paid") return checkout;
  return ensureShopifyOrder(session);
}
