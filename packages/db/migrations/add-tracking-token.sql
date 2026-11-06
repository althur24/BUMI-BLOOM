-- Tracking token for the customer-facing order page (additive only).
-- Safe to re-run: column and index are guarded with IF NOT EXISTS.
--
-- Apply with: node scripts/apply-tracking-migration.mjs
--   (or node --env-file=apps/admin/.env.local scripts/apply-tracking-migration.mjs)
-- Or paste into the Supabase SQL Editor.

ALTER TABLE "StripeCheckout"
  ADD COLUMN IF NOT EXISTS "trackingToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "StripeCheckout_trackingToken_key"
  ON "StripeCheckout" ("trackingToken");
