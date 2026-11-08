-- Chargeback / dispute records (additive only).
-- Safe to re-run: table and indexes are guarded with IF NOT EXISTS.
--
-- Apply with: node --env-file=apps/admin/.env.local scripts/apply-dispute-migration.mjs
-- Or paste into the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "Dispute" (
    "id" TEXT NOT NULL,
    "stripeChargeId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "checkoutId" TEXT,
    "shopifyOrderId" TEXT,
    "amountAudCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "evidenceDueBy" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Dispute_stripeChargeId_idx"
  ON "Dispute" ("stripeChargeId");

CREATE INDEX IF NOT EXISTS "Dispute_stripePaymentIntentId_idx"
  ON "Dispute" ("stripePaymentIntentId");

CREATE INDEX IF NOT EXISTS "Dispute_checkoutId_idx"
  ON "Dispute" ("checkoutId");

CREATE INDEX IF NOT EXISTS "Dispute_status_idx"
  ON "Dispute" ("status");
