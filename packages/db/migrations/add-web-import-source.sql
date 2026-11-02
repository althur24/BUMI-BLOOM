-- Import pipeline: generic website support + canonical source key.
--
-- Run this on the deployment database before releasing the new admin build
-- (or run `npm run db:push -w packages/db` with DATABASE_URL/DIRECT_URL set).
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- PostgreSQL < 12. On Supabase (PG 15+) run it as a standalone statement.

ALTER TYPE "ImportSource" ADD VALUE IF NOT EXISTS 'WEB';

ALTER TABLE "ImportJob" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT;

CREATE INDEX IF NOT EXISTS "ImportJob_sourceKey_idx" ON "ImportJob" ("sourceKey");
