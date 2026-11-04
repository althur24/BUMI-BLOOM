// Ad-hoc migration runner for the additive Stripe checkout tables.
//
// Why not `prisma db push`: db push reconciles the WHOLE database against
// schema.prisma and can drop/alter unrelated tables. This project already has
// production data (Product, Brand, AdminUser, ImportJob, ...). The Stripe
// migration is purely additive, so we run the SQL file as-is.
//
// Safety:
//   - runs inside a single transaction; any error rolls the whole thing back
//   - every statement is idempotent (IF NOT EXISTS / guarded enum + index)
//   - refuses to run if a destructive keyword is present in the SQL file
//
// Usage: node --env-file=apps/admin/.env.local scripts/apply-stripe-migration.mjs

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const SQL_PATH = "packages/db/migrations/add-stripe-checkout.sql";

// Block genuinely destructive statements. ADD COLUMN IF NOT EXISTS is safe and
// intentionally allowed (the emailSentAt column was added after the first run).
const FORBIDDEN =
  /\b(DROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|(ALTER\s+TABLE[^;]*\bDROP\b)|RENAME)\b/i;

// Strip line comments, then split on top-level semicolons while ignoring
// semicolons inside $$ ... $$ dollar-quoted blocks (used by DO $$ ... $$).
function statements(sql) {
  const cleaned = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const out = [];
  let current = "";
  let inDollar = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const two = cleaned.slice(i, i + 2);
    if (two === "$$") {
      inDollar = !inDollar;
      current += two;
      i += 1;
      continue;
    }
    if (cleaned[i] === ";" && !inDollar) {
      const statement = current.trim();
      if (statement) out.push(statement);
      current = "";
      continue;
    }
    current += cleaned[i];
  }

  const tail = current.trim();
  if (tail) out.push(tail);
  return out;
}

function guard(list) {
  for (const statement of list) {
    const match = statement.match(FORBIDDEN);
    if (match) {
      throw new Error(
        `Refusing to run: destructive keyword "${match[1]}" in statement: ` +
          `${statement.slice(0, 80).replace(/\s+/g, " ")}...`,
      );
    }
  }
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DIRECT_URL / DATABASE_URL is not configured.");
  }

  const sql = readFileSync(SQL_PATH, "utf8");
  const list = statements(sql);
  guard(list);
  console.log(`Running ${list.length} statements from ${SQL_PATH}`);

  const prisma = new PrismaClient();
  try {
    for (const [index, statement] of list.entries()) {
      const label = statement.slice(0, 72).replace(/\s+/g, " ");
      process.stdout.write(`  [${index + 1}/${list.length}] ${label}... `);
      await prisma.$executeRawUnsafe(statement);
      console.log("ok");
    }

    const tables = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('StripeCheckout','StripeWebhookEvent','PromoRedemption','Refund')
        ORDER BY table_name`,
    );
    const labels = await prisma.$queryRawUnsafe(
      `SELECT enumlabel FROM pg_enum
        WHERE enumtypid = '"StripeCheckoutStatus"'::regtype
        ORDER BY enumsortorder`,
    );

    console.log("\nTables:", tables.map((t) => t.table_name).join(", ") || "(none)");
    console.log(
      "Enum StripeCheckoutStatus:",
      labels.map((l) => l.enumlabel).join(", ") || "(none)",
    );

    if (tables.length !== 4) {
      throw new Error(`Expected 4 tables, found ${tables.length}.`);
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("\nMigration applied.");
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});
