// Ad-hoc migration runner for the additive checkout-hardening columns.
//
// Why not `prisma db push`: db push reconciles the WHOLE database against
// schema.prisma and can drop/alter unrelated tables. This project already has
// production data, so the migration is purely additive and runs the SQL file
// as-is.
//
// Safety:
//   - every statement is idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX
//     IF NOT EXISTS)
//   - refuses to run if a destructive keyword is present in the SQL file
//
// Usage: node scripts/apply-checkout-hardening.mjs
//    or: node --env-file=apps/admin/.env.local scripts/apply-checkout-hardening.mjs

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const SQL_PATH = "packages/db/migrations/add-checkout-hardening.sql";

const FORBIDDEN =
  /\b(DROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|(ALTER\s+TABLE[^;]*\bDROP\b)|RENAME)\b/i;

function statements(sql) {
  const cleaned = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return cleaned
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
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

    const columns = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'StripeCheckout'
          AND column_name IN ('anonymousCartId','checkoutSecret','orderSyncStartedAt')
        ORDER BY column_name`,
    );
    const names = columns.map((row) => row.column_name);
    console.log("\nColumns:", names.join(", ") || "(none)");
    if (names.length !== 3) {
      throw new Error("Expected 3 new StripeCheckout columns.");
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