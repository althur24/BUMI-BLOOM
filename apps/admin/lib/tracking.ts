import { createHmac, timingSafeEqual } from "node:crypto";

// Tracking token: HMAC-SHA256(checkout.id, TRACKING_TOKEN_SECRET), hex, first
// 32 chars (128 bits). Deterministic so it can be embedded in the Shopify draft
// order before the order exists and regenerated during backfill.
//
// Tokens are public (no login) and read-only. The secret only needs to live in
// the admin service; the storefront never sees it.
const TOKEN_LENGTH = 32;

function secret(): string {
  const value = process.env.TRACKING_TOKEN_SECRET;
  if (!value) {
    throw new Error("TRACKING_TOKEN_SECRET is not configured.");
  }
  return value;
}

export function createTrackingToken(checkoutId: string): string {
  if (!checkoutId) throw new Error("checkoutId is required for a tracking token.");
  return createHmac("sha256", secret())
    .update(checkoutId)
    .digest("hex")
    .slice(0, TOKEN_LENGTH);
}

// Constant-time comparison against the expected token for a checkout id.
export function verifyTrackingToken(
  checkoutId: string,
  candidate: string,
): boolean {
  if (!checkoutId || !candidate) return false;
  const expected = createTrackingToken(checkoutId);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function trackingUrl(token: string): string {
  const base = (process.env.STOREFRONT_URL || "https://www.bumibloom.com")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
  return `${base}/order/${token}`;
}
