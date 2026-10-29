// One-off backfill for products pushed before the metafield fixes:
// re-applies the `bumi` metafields (colors, material, audience, badge, …) to
// existing Shopify products without deleting/recreating them.
//
// Run from the repo root:
//   npx tsx apps/admin/scripts/backfill-metafields.ts
//
// Idempotent: metafieldsSet upserts by namespace+key.

import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@bumi/db";
import { buildShopifyPushInput } from "../lib/import-mapper";
import { adminRest, setMetafields } from "../lib/shopify";
import { colorOptionOf, dedupeColors } from "../lib/colors";
import type { NormalizedProduct } from "../lib/scrapers/base";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "../.env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

async function main() {
  const jobs = await prisma.importJob.findMany({
    where: { status: "PUSHED", shopifyProductId: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  if (!jobs.length) {
    console.log("Tidak ada produk PUSHED untuk di-backfill.");
    return;
  }

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    const np = { ...(job.extractedJson as unknown as NormalizedProduct) };
    if (!np.title || !job.shopifyProductId) continue;

    // Rebuild the palette for jobs extracted before colors were captured.
    const fromVariants = np.variants
      .map((v) => {
        const color = colorOptionOf(v.options);
        return color ? { name: color.value, hex: v.hex || "" } : null;
      })
      .filter((c): c is { name: string; hex: string } => Boolean(c));
    np.colors = dedupeColors([...(np.colors || []), ...fromVariants]);

    const input = buildShopifyPushInput(np);
    // Don't overwrite lifecycle fields on existing products: a backfill must
    // not re-rank the homepage or mark old products as new again.
    const skipKeys = new Set(["is_new", "badge", "added_at_rank"]);
    const metafields = input.metafields.filter(
      (m) =>
        !skipKeys.has(m.key) &&
        !(m.type === "single_line_text_field" && !String(m.value || "").trim()),
    );
    const ownerId = `gid://shopify/Product/${job.shopifyProductId}`;

    // Jobs from re-imports/deletions can point at products that no longer
    // exist. Skip them instead of reporting a scary metafieldsSet failure.
    try {
      await adminRest("GET", `/products/${job.shopifyProductId}.json?fields=id`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("HTTP 404")) {
        console.log(
          `· skip ${job.shopifyHandle || job.shopifyProductId}: produk sudah tidak ada di Shopify`,
        );
        skipped++;
      } else {
        console.error(
          `✗ ${job.shopifyHandle || job.shopifyProductId}: ${msg}`,
        );
        failed++;
      }
      continue;
    }

    try {
      await setMetafields(ownerId, metafields);
      const colors = np.colors.length
        ? np.colors.map((c) => `${c.name} ${c.hex}`).join(", ")
        : "(none)";
      console.log(`✓ ${job.shopifyHandle || job.shopifyProductId} → ${metafields.length} metafield | colors: ${colors}`);
      ok++;
    } catch (e) {
      console.error(
        `✗ ${job.shopifyHandle || job.shopifyProductId}:`,
        e instanceof Error ? e.message : e,
      );
      failed++;
    }
  }

  console.log(
    `\nSelesai: ${ok} ok, ${failed} gagal, ${skipped} dilewati dari ${jobs.length} produk.`,
  );
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
