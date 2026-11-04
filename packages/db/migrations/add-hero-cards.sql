-- Hero homepage arch cards (slots 1, 3, 5 — slots 2/4 are fixed character cards)
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/xugmxibdqiffhklhsawu/sql/new

-- 1. Create table
CREATE TABLE IF NOT EXISTS "HeroCard" (
    "position" INTEGER NOT NULL,
    "productHandle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HeroCard_pkey" PRIMARY KEY ("position")
);

-- 2. Seed the three selectable slots (no product = default illustration)
INSERT INTO "HeroCard" ("position", "updatedAt")
VALUES (1, now()), (3, now()), (5, now())
ON CONFLICT ("position") DO NOTHING;
