import { createHash } from "crypto";

export const CHECKOUT_CURRENCY = "AUD";
export const SHIPPING_FLAT_CENTS = 1500;
export const FREE_SHIPPING_THRESHOLD_CENTS = 9900;
export const GST_PERCENT = 10;
export const MAX_ITEM_QUANTITY = 10;
export const MAX_CART_LINES = 50;
export const SESSION_TTL_MINUTES = 30;

export interface CheckoutItemInput {
  variantId: string;
  quantity: number;
}

export interface ResolvedCheckoutItem {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  handle: string;
  imageUrl: string | null;
  priceAudCents: number;
  quantity: number;
  quantityAvailable: number | null;
}

export interface CheckoutPromo {
  code: string;
  label: string;
  discountAudCents: number;
  shopifyDiscountId: string;
}

export interface CheckoutShippingOption {
  title: string;
  amountCents: number;
}

export interface CheckoutQuote {
  currency: "AUD";
  subtotalAudCents: number;
  discountAudCents: number;
  shippingAudCents: number;
  taxAudCents: number;
  totalAudCents: number;
  freeShippingThresholdAudCents: number;
  // Shipping methods configured in Shopify. The customer picks one inside the
  // Stripe form, so these are informational before payment.
  shippingOptions?: CheckoutShippingOption[];
  promo?: {
    code: string;
    label: string;
    discountAudCents: number;
  };
}

export class CheckoutError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function parseCheckoutItems(value: unknown): CheckoutItemInput[] {
  if (!Array.isArray(value) || !value.length) {
    throw new CheckoutError(400, "Your bag is empty.");
  }
  if (value.length > MAX_CART_LINES) {
    throw new CheckoutError(400, "Too many items in one order.");
  }

  const merged = new Map<string, number>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      throw new CheckoutError(400, "Invalid cart item.");
    }
    const item = raw as Record<string, unknown>;
    const variantId = typeof item.variantId === "string" ? item.variantId.trim() : "";
    const quantity = Number(item.quantity);
    if (!variantId.startsWith("gid://shopify/ProductVariant/")) {
      throw new CheckoutError(400, "Invalid product variant.");
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new CheckoutError(400, "Quantity must be at least 1.");
    }
    merged.set(
      variantId,
      (merged.get(variantId) || 0) + Math.min(quantity, MAX_ITEM_QUANTITY),
    );
  }

  return [...merged.entries()].map(([variantId, quantity]) => ({
    variantId,
    quantity: Math.min(quantity, MAX_ITEM_QUANTITY),
  }));
}

const missingTableWarned = new Set<string>();

// Prisma reports P2021 when the table is absent from the database. Until the
// Stripe checkout migration is applied, checkout must degrade gracefully
// instead of throwing an opaque 500 on every request.
export function isMissingTableError(err: any): boolean {
  if (err?.code !== "P2021") return false;
  return /StripeCheckout|StripeWebhookEvent|PromoRedemption|Refund/.test(
    String(err?.meta?.table || err?.message || ""),
  );
}

export function warnMissingTable(scope: string): void {
  if (missingTableWarned.has(scope)) return;
  missingTableWarned.add(scope);
  console.error(
    `[checkout] Stripe checkout tables are missing for ${scope}. ` +
      "Apply packages/db/migrations/add-stripe-checkout.sql.",
  );
}

export function normalizePromoCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  if (!code) return null;
  if (!/^[A-Z0-9_-]{2,64}$/.test(code)) {
    throw new CheckoutError(400, "Invalid discount code.");
  }
  return code;
}

export function computeShippingCents(discountedSubtotalCents: number): number {
  return discountedSubtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
    ? 0
    : SHIPPING_FLAT_CENTS;
}

export function totalsWithShipping(
  subtotalAudCents: number,
  discountAudCents: number,
  shippingAudCents: number,
): Omit<CheckoutQuote, "promo" | "shippingOptions"> {
  const safeDiscount = Math.max(0, Math.min(discountAudCents, subtotalAudCents));
  const shipping = Math.max(0, Math.round(shippingAudCents));
  const totalAudCents = subtotalAudCents - safeDiscount + shipping;
  const taxAudCents = Math.round(
    (totalAudCents * GST_PERCENT) / (100 + GST_PERCENT),
  );

  return {
    currency: CHECKOUT_CURRENCY,
    subtotalAudCents,
    discountAudCents: safeDiscount,
    shippingAudCents: shipping,
    taxAudCents,
    totalAudCents,
    freeShippingThresholdAudCents: FREE_SHIPPING_THRESHOLD_CENTS,
  };
}

export function computeTotals(
  subtotalAudCents: number,
  discountAudCents: number,
): Omit<CheckoutQuote, "promo" | "shippingOptions"> {
  const safeDiscount = Math.max(0, Math.min(discountAudCents, subtotalAudCents));
  return totalsWithShipping(
    subtotalAudCents,
    discountAudCents,
    computeShippingCents(subtotalAudCents - safeDiscount),
  );
}

export function checkoutCartHash(
  items: CheckoutItemInput[],
  promoCode: string | null,
): string {
  const canonical = items
    .slice()
    .sort((a, b) => a.variantId.localeCompare(b.variantId))
    .map((item) => `${item.variantId}:${item.quantity}`)
    .join("|");
  return createHash("sha256")
    .update(`${canonical}|${promoCode || ""}`)
    .digest("hex");
}

export function corsHeaders(request?: Request): Record<string, string> {
  const configured = (process.env.STOREFRONT_URL || "http://localhost:3000")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const allowed = new Set<string>();
  for (const origin of configured) {
    allowed.add(origin);
    if (origin.includes("://www.")) {
      allowed.add(origin.replace("://www.", "://"));
    } else if (origin.includes("://")) {
      allowed.add(origin.replace("://", "://www."));
    }
  }
  const requestOrigin = request?.headers.get("origin") || "";
  const selected = allowed.has(requestOrigin)
    ? requestOrigin
    : configured[0] || "http://localhost:3000";

  return {
    "Access-Control-Allow-Origin": selected,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

const buckets = new Map<string, number[]>();

export function isRateLimited(
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((time) => now - time < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  return hits.length > max;
}

export function jsonWithCors(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
  request?: Request,
): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request), ...extraHeaders },
  });
}
