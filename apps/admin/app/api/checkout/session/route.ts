import { randomUUID } from "crypto";
import { prisma } from "@bumi/db";
import { StripeCheckoutStatus } from "@prisma/client";
import {
  CheckoutError,
  SESSION_TTL_MINUTES,
  corsHeaders,
  getClientIp,
  isMissingTableError,
  isRateLimited,
  jsonWithCors,
  warnMissingTable,
} from "@/lib/checkout";
import { ensureShopifyOrder, prepareCheckout } from "@/lib/checkout-service";
import {
  getPaymentMethodOverride,
  getStripe,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function paidResponse(checkout: any) {
  return {
    alreadyPaid: true,
    checkoutId: checkout.id,
    status: checkout.status,
    orderName: checkout.shopifyOrderName,
    email: checkout.customerEmail,
    cartHash: checkout.cartHash,
  };
}

function processingResponse(checkout: any) {
  return {
    processing: true,
    checkoutId: checkout.id,
    status: checkout.status,
    cartHash: checkout.cartHash,
  };
}

// A Stripe Checkout Session is immutable. If Shopify shipping methods (or the
// quoted totals) changed since an open session was created, reusing it would
// keep showing the old options, so sign the quote to detect that case.
function quoteSignature(quote: any): string {
  const options = Array.isArray(quote?.shippingOptions)
    ? quote.shippingOptions
    : [];
  const shipping = options
    .map((option: any) => [String(option.title), Number(option.amountCents)])
    .sort();
  return JSON.stringify([
    shipping,
    Number(quote?.subtotalAudCents || 0),
    Number(quote?.discountAudCents || 0),
    Number(quote?.shippingAudCents || 0),
  ]);
}

async function reusableSession(cartHash: string, quote: any) {
  let existing;
  try {
    existing = await prisma.stripeCheckout.findFirst({
      where: {
        cartHash,
        createdAt: { gt: new Date(Date.now() - 30 * 60_000) },
        status: {
          in: [StripeCheckoutStatus.PENDING, StripeCheckoutStatus.PAID],
        },
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (err: any) {
    if (!isMissingTableError(err)) throw err;
    warnMissingTable("session reuse");
    throw new CheckoutError(
      503,
      "Checkout is not ready yet. Please try again shortly.",
    );
  }
  if (!existing) return null;
  if (existing.status === StripeCheckoutStatus.PAID || existing.shopifyOrderId) {
    return paidResponse(existing);
  }

  let session: any;
  try {
    session = await getStripe().checkout.sessions.retrieve(
      existing.stripeSessionId,
    );
  } catch (err: any) {
    console.error(
      "[checkout] failed to retrieve Stripe session",
      existing.id,
      err?.message,
    );
    return processingResponse(existing);
  }

  if (session.status === "open" && session.client_secret) {
    if (quoteSignature(existing.quoteJson) !== quoteSignature(quote)) {
      // Shipping/totals changed: retire the stale session and let the caller
      // create a fresh one with the current Shopify shipping options.
      try {
        await getStripe().checkout.sessions.expire(existing.stripeSessionId);
      } catch (err: any) {
        console.error(
          "[checkout] failed to expire stale session",
          existing.id,
          err?.message,
        );
      }
      try {
        await prisma.stripeCheckout.update({
          where: { id: existing.id },
          data: { status: StripeCheckoutStatus.EXPIRED },
        });
      } catch (err: any) {
        if (!isMissingTableError(err)) throw err;
        warnMissingTable("session expiry");
      }
      return null;
    }

    return {
      checkoutId: existing.id,
      sessionId: existing.stripeSessionId,
      clientSecret: session.client_secret,
      quote: existing.quoteJson,
      cartHash: existing.cartHash,
      paymentMethods: session.payment_method_types || null,
    };
  }

  if (session.payment_status === "paid" || session.status === "complete") {
    try {
      await ensureShopifyOrder(session);
    } catch (err: any) {
      console.error(
        "[checkout] reused session order sync failed",
        existing.id,
        err?.message,
      );
      // Never fall through to a new session when money was already captured.
      return processingResponse(existing);
    }
    let updated;
    try {
      updated = await prisma.stripeCheckout.findUnique({
        where: { id: existing.id },
      });
    } catch (err: any) {
      if (!isMissingTableError(err)) throw err;
      warnMissingTable("session resume");
      return processingResponse(existing);
    }
    if (updated?.status === StripeCheckoutStatus.PAID || updated?.shopifyOrderId) {
      return paidResponse(updated);
    }
    return processingResponse(updated || existing);
  }

  return null;
}

export async function POST(request: Request) {
  const respond = (body: unknown, status: number) =>
    jsonWithCors(body, status, {}, request);

  const ip = getClientIp(request);
  if (isRateLimited(`session:${ip}`, 20, 60_000)) {
    return respond(
      { error: "Too many checkout attempts. Please try again shortly." },
      429,
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Invalid request body." }, 400);
  }

  try {
    const prepared = await prepareCheckout(body);

    if (prepared.quote.totalAudCents < 50) {
      throw new CheckoutError(
        400,
        "This order total is too low to process online. Please contact us.",
      );
    }

    const reusable = await reusableSession(prepared.cartHash, prepared.quote);
    if (reusable) {
      return respond(
        {
          ok: true,
          cartHash: prepared.cartHash,
          ...reusable,
          quote: prepared.quote,
        },
        200,
      );
    }

    const stripe = getStripe();
    const paymentMethodOverride = getPaymentMethodOverride();
    const checkoutId = randomUUID();
    const stripeSessionKey = `checkout_${checkoutId}`;

    let couponId: string | null = null;
    if (prepared.quote.discountAudCents > 0) {
      const coupon = await stripe.coupons.create(
        {
          amount_off: prepared.quote.discountAudCents,
          currency: "aud",
          duration: "once",
          name: prepared.promoCode || "Discount",
          metadata: {
            checkoutId,
            promoCode: prepared.promoCode || "",
          },
        },
        { idempotencyKey: `coupon_${checkoutId}` },
      );
      couponId = coupon.id;
    }

    const lineItems = prepared.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "aud",
        unit_amount: item.priceAudCents,
        product_data: {
          name: `${item.productTitle} — ${item.variantTitle}`,
          images: item.imageUrl ? [item.imageUrl] : undefined,
          metadata: {
            variantId: item.variantId,
            handle: item.handle,
          },
        },
      },
    }));

    // Shipping methods come straight from Shopify Admin. If Shopify returns
    // none (e.g. a transient API error), fall back to a single flat option so
    // checkout still works.
    const shopifyShippingOptions = prepared.quote.shippingOptions || [];
    const shippingOptions = shopifyShippingOptions.length
      ? shopifyShippingOptions.slice(0, 5).map((option) => ({
          shipping_rate_data: {
            type: "fixed_amount" as const,
            fixed_amount: {
              amount: option.amountCents,
              currency: "aud" as const,
            },
            display_name: option.title,
          },
        }))
      : [
          {
            shipping_rate_data: {
              type: "fixed_amount" as const,
              fixed_amount: {
                amount: prepared.quote.shippingAudCents,
                currency: "aud" as const,
              },
              display_name:
                prepared.quote.shippingAudCents === 0
                  ? "Free standard shipping (5-8 business days)"
                  : "Standard shipping (5-8 business days)",
              delivery_estimate: {
                minimum: { unit: "business_day" as const, value: 5 },
                maximum: { unit: "business_day" as const, value: 8 },
              },
            },
          },
        ];

    const storefrontUrl = (process.env.STOREFRONT_URL || "http://localhost:3000")
      .split(",")[0]
      .trim()
      .replace(/\/+$/, "");

    const session = await stripe.checkout.sessions.create(
      {
        // Checkout form mode renders a full-width, single-step form that the
        // legacy embedded page could not. It requires a return_url and does
        // not accept redirect_on_completion.
        ui_mode: "form" as any,
        return_url: `${storefrontUrl}/checkout`,
        mode: "payment",
        locale: "auto",
        // No payment_method_types by default: Stripe uses the account's
        // payment method configuration (dynamic methods), which respects the
        // dashboard, currency, customer country, and device wallets.
        ...(paymentMethodOverride
          ? { payment_method_types: paymentMethodOverride as any }
          : {}),
        line_items: lineItems,
        discounts: couponId ? [{ coupon: couponId }] : undefined,
        shipping_address_collection: { allowed_countries: ["AU"] },
        shipping_options: shippingOptions,
        customer_creation: "if_required",
        billing_address_collection: "auto",
        client_reference_id: checkoutId,
        metadata: {
          checkoutId,
          cartHash: prepared.cartHash,
          promoCode: prepared.promoCode || "",
          consentMarketing: prepared.consentMarketing ? "true" : "false",
        },
        payment_intent_data: {
          metadata: {
            checkoutId,
            promoCode: prepared.promoCode || "",
          },
        },
        expires_at:
          Math.floor(Date.now() / 1000) +
          (SESSION_TTL_MINUTES + 1) * 60,
      },
      { idempotencyKey: stripeSessionKey },
    );

    if (!session.client_secret) {
      throw new Error("Stripe did not return a client secret.");
    }

    try {
      await prisma.stripeCheckout.create({
        data: {
          id: checkoutId,
          stripeSessionId: session.id,
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id || null,
          status: StripeCheckoutStatus.PENDING,
          cartHash: prepared.cartHash,
          subtotalAudCents: prepared.quote.subtotalAudCents,
          shippingAudCents: prepared.quote.shippingAudCents,
          discountAudCents: prepared.quote.discountAudCents,
          taxAudCents: prepared.quote.taxAudCents,
          amountAudCents: prepared.quote.totalAudCents,
          currency: "AUD",
          promoCode: prepared.promoCode,
          shopifyDiscountId: prepared.shopifyDiscountId,
          consentMarketing: prepared.consentMarketing,
          itemsJson: prepared.items as any,
          quoteJson: prepared.quote as any,
          attributionJson: prepared.attribution as any,
        },
      });
    } catch (err: any) {
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch {
        console.error("[checkout] failed to expire orphaned Stripe session");
      }
      if (isMissingTableError(err)) {
        warnMissingTable("session create");
        throw new CheckoutError(
          503,
          "Checkout is not ready yet. Please try again shortly.",
        );
      }
      throw err;
    }

    return respond(
      {
        ok: true,
        checkoutId,
        sessionId: session.id,
        clientSecret: session.client_secret,
        cartHash: prepared.cartHash,
        quote: prepared.quote,
        paymentMethods: (session as any).payment_method_types || paymentMethodOverride || [],
      },
      200,
    );
  } catch (err: any) {
    if (err instanceof CheckoutError) {
      return respond({ error: err.message }, err.status);
    }
    console.error("[checkout] session create failed", err);
    return respond(
      { error: "Checkout is temporarily unavailable. Please try again." },
      500,
    );
  }
}
