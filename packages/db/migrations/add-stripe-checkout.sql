-- Stripe checkout tables (additive only — no DROP / ALTER of existing tables).
-- Safe to re-run: enum and indexes are guarded with IF NOT EXISTS.
--
-- Apply with: node --env-file=apps/admin/.env.local scripts/apply-stripe-migration.mjs
-- Or paste into the Supabase SQL Editor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'StripeCheckoutStatus'
  ) THEN
    CREATE TYPE "StripeCheckoutStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'REFUNDED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "StripeCheckout" (
    "id" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "status" "StripeCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "cartHash" TEXT NOT NULL,
    "subtotalAudCents" INTEGER NOT NULL DEFAULT 0,
    "shippingAudCents" INTEGER NOT NULL DEFAULT 0,
    "discountAudCents" INTEGER NOT NULL DEFAULT 0,
    "taxAudCents" INTEGER NOT NULL DEFAULT 0,
    "amountAudCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "customerEmail" TEXT,
    "promoCode" TEXT,
    "shopifyDiscountId" TEXT,
    "consentMarketing" BOOLEAN NOT NULL DEFAULT false,
    "itemsJson" JSONB NOT NULL,
    "quoteJson" JSONB,
    "attributionJson" JSONB,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "shopifyTotalAudCents" INTEGER,
    "shopifyFinancialStatus" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StripeCheckout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StripeCheckout_stripeSessionId_key" ON "StripeCheckout"("stripeSessionId");
CREATE INDEX IF NOT EXISTS "StripeCheckout_status_idx" ON "StripeCheckout"("status");
CREATE INDEX IF NOT EXISTS "StripeCheckout_customerEmail_idx" ON "StripeCheckout"("customerEmail");
CREATE INDEX IF NOT EXISTS "StripeCheckout_shopifyOrderId_idx" ON "StripeCheckout"("shopifyOrderId");
CREATE INDEX IF NOT EXISTS "StripeCheckout_stripePaymentIntentId_idx" ON "StripeCheckout"("stripePaymentIntentId");
CREATE INDEX IF NOT EXISTS "StripeCheckout_cartHash_status_idx" ON "StripeCheckout"("cartHash", "status");

-- Added later: order confirmation email tracking (idempotency guard).
ALTER TABLE "StripeCheckout" ADD COLUMN IF NOT EXISTS "emailSentAt" TIMESTAMP(3);

-- Added later: cached customer status page link (avoids per-poll Shopify API calls).
ALTER TABLE "StripeCheckout" ADD COLUMN IF NOT EXISTS "statusPageUrl" TEXT;

-- Added later: two-phase email delivery. emailSendingAt is claimed before
-- sending (prevents concurrent duplicates); emailSentAt marks success.
ALTER TABLE "StripeCheckout" ADD COLUMN IF NOT EXISTS "emailSendingAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PromoRedemption" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "checkoutId" TEXT,
    "shopifyOrderId" TEXT,
    "customerEmail" TEXT,
    "amountAudCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PromoRedemption_checkoutId_key" ON "PromoRedemption"("checkoutId");
CREATE INDEX IF NOT EXISTS "PromoRedemption_code_idx" ON "PromoRedemption"("code");
CREATE INDEX IF NOT EXISTS "PromoRedemption_customerEmail_idx" ON "PromoRedemption"("customerEmail");
CREATE INDEX IF NOT EXISTS "PromoRedemption_shopifyOrderId_idx" ON "PromoRedemption"("shopifyOrderId");

CREATE TABLE IF NOT EXISTS "Refund" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT,
    "stripeRefundId" TEXT,
    "stripePaymentIntentId" TEXT,
    "shopifyOrderId" TEXT,
    "shopifyRefundId" TEXT,
    "amountAudCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Refund_stripeRefundId_key" ON "Refund"("stripeRefundId");
CREATE INDEX IF NOT EXISTS "Refund_checkoutId_idx" ON "Refund"("checkoutId");
CREATE INDEX IF NOT EXISTS "Refund_stripePaymentIntentId_idx" ON "Refund"("stripePaymentIntentId");
CREATE INDEX IF NOT EXISTS "Refund_shopifyOrderId_idx" ON "Refund"("shopifyOrderId");
