// Backfill tracking tokens for StripeCheckout rows that already have a Shopify
// order but no token yet.
//
// Tokens are deterministic: HMAC_SHA256(checkout.id, TRACKING_TOKEN_SECRET),
// hex, 32 chars. Running this twice produces the same values, so it is safe to
// re-run. Rows without a shopifyOrderId are skipped (nothing to track yet).
//
// Usage:
//   node --env-file=apps/admin/.env.local scripts/backfill-tracking-tokens.mjs
//   node --env-file=apps/admin/.env.local scripts/backfill-tracking-tokens.mjs --dry-run

import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const TOKEN_LENGTH = 32;
const DRY_RUN = process.argv.includes("--dry-run");

function secret() {
  const value = process.env.TRACKING_TOKEN_SECRET;
  if (!value) {
    throw new Error("TRACKING_TOKEN_SECRET is not configured.");
  }
  return value;
}

function createTrackingToken(checkoutId, key) {
  return createHmac("sha256", key).update(checkoutId).digest("hex").slice(0, TOKEN_LENGTH);
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DIRECT_URL / DATABASE_URL is not configured.");
  }

  const key = secret();
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.stripeCheckout.findMany({
      where: { shopifyOrderId: { not: null }, trackingToken: null },
      select: { id: true, shopifyOrderId: true, shopifyOrderName: true },
    });

    console.log(
      `${DRY_RUN ? "[dry-run] " : ""}Found ${rows.length} checkout(s) to backfill.`,
    );

    let updated = 0;
    for (const row of rows) {
      const token = createTrackingToken(row.id, key);
      console.log(
        `  ${row.shopifyOrderName || row.id} → ${token.slice(0, 8)}…`,
      );
      if (DRY_RUN) continue;
      await prisma.stripeCheckout.update({
        where: { id: row.id },
        data: { trackingToken: token },
      });
      updated += 1;
    }

    console.log(
      DRY_RUN
        ? "\nDry run complete. No rows were written."
        : `\nBackfill complete. ${updated} row(s) updated.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\nBackfill failed:", err.message);
  process.exit(1);
});
