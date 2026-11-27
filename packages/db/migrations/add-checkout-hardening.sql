-- Checkout hardening (additive only).
-- Safe to re-run: every column/index is guarded with IF NOT EXISTS.
--
-- Apply with: node scripts/apply-checkout-hardening.mjs
--   (or node --env-file=apps/admin/.env.local scripts/apply-checkout-hardening.mjs)
-- Or paste into the Supabase SQL Editor.

ALTER TABLE "StripeCheckout"
  ADD COLUMN IF NOT EXISTS "anonymousCartId" TEXT;

ALTER TABLE "StripeCheckout"
  ADD COLUMN IF NOT EXISTS "checkoutSecret" TEXT;

ALTER TABLE "StripeCheckout"
  ADD COLUMN IF NOT EXISTS "orderSyncStartedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "StripeCheckout_cartHash_anonymousCartId_status_idx"
  ON "StripeCheckout" ("cartHash", "anonymousCartId", "status");