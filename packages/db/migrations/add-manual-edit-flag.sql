-- Marks import jobs whose Shopify product was edited manually from the admin
-- Products page. A later re-import of the same source URL must ask for
-- confirmation before overwriting those manual edits.

ALTER TABLE "ImportJob" ADD COLUMN IF NOT EXISTS "manuallyEditedAt" TIMESTAMP(3);
