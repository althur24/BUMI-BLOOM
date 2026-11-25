import { createHash } from "crypto";

export const CHECKOUT_CURRENCY = "AUD";
export const SHIPPING_FLAT_CENTS = 1500;
export const FREE_SHIPPING_THRESHOLD_CENTS = 9900;
// "3 for $69" bundle: the three highest-priced eligible units in the bag are
// repriced to a flat total. Quantity counts every eligible unit (sum of line
// quantities), so a single eligible product with quantity 3 qualifies.
export const BUNDLE_MIN_QUANTITY = 3;
export const BUNDLE_FLAT_CENTS = 6900;
// The bundle applies to clothing and accessories only. Busy books (toys) are
// excluded: they neither count towards the three items nor get repriced.
export const BUNDLE_INELIGIBLE_TYPES = ["busy-book"];
export const BUNDLE_INELIGIBLE_TITLE =
  /busy\s*books?|quiet\s*books?|activity\s*books?|buku\s+(mainan|maianan|edukasi|aktivitas|activity)/i;
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
  productType: string;
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
    // True when the code was validated but not applied because the automatic
    // "3 for $69" bundle is active — the two cannot be combined.
    blockedByBundle?: boolean;
  };
  // Automatic "3 for $69" bundle discount. Shown as its own line so it reads
  // separately from any code the customer typed.
  bundle?: {
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

/**
 * The "3 for $69" bundle covers clothing and accessories only. Busy books are
 * toys and are excluded, so they neither count towards the three items nor get
 * repriced. Unknown/empty types stay eligible so a mis-typed Shopify product
 * type never silently removes the offer.
 *
 * Mirrors `isBundleEligible` in apps/storefront/public/js/cart.js.
 */
export function isBundleEligibleProduct(item: {
  productType?: string | null;
  productTitle?: string | null;
}): boolean {
  const type = String(item.productType || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (BUNDLE_INELIGIBLE_TYPES.includes(type)) return false;
  if (BUNDLE_INELIGIBLE_TITLE.test(String(item.productTitle || ""))) return false;
  return true;
}

/**
 * "3 for $69" bundle discount.
 *
 * Only eligible (clothing/accessory) units are pooled. The three most expensive
 * of them are repriced to a flat $69; any additional eligible units keep their
 * normal price, and busy books are charged in full. Returns the discount in AUD
 * cents (never more than the subtotal, never negative).
 *
 * The same rule runs client-side for the cart preview, so keep both copies in
 * sync: apps/storefront/public/js/cart.js (BUNDLE / getBundleDiscount).
 */
export function computeBundleDiscountCents(
  items: Array<{
    priceAudCents: number;
    quantity: number;
    productType?: string | null;
    productTitle?: string | null;
  }>,
): number {
  const units: number[] = [];
  for (const item of items) {
    if (!isBundleEligibleProduct(item)) continue;
    const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
    const price = Math.max(0, Math.round(Number(item.priceAudCents) || 0));
    for (let i = 0; i < qty; i += 1) units.push(price);
  }
  if (units.length < BUNDLE_MIN_QUANTITY) return 0;

  units.sort((a, b) => b - a);
  const topTotal = units
    .slice(0, BUNDLE_MIN_QUANTITY)
    .reduce((sum, price) => sum + price, 0);
  const eligibleSubtotal = units.reduce((sum, price) => sum + price, 0);
  return Math.max(
    0,
    Math.min(topTotal - BUNDLE_FLAT_CENTS, eligibleSubtotal),
  );
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
