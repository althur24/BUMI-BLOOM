-- Brand display order (storefront "Shop by Brand" / PLP brand filter / /brands).
-- Brands not listed here keep the default fallback order (has products first,
-- then alphabetical). Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/xugmxibdqiffhklhsawu/sql/new

CREATE TABLE IF NOT EXISTS "BrandOrder" (
    "brandKey"  TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandOrder_pkey" PRIMARY KEY ("brandKey")
);

CREATE INDEX IF NOT EXISTS "BrandOrder_sortOrder_idx" ON "BrandOrder" ("sortOrder");
