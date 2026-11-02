// Prints the exact Shopify payload + metafields that a push would send, without
// calling the Shopify API. Run:
//   npx tsx apps/admin/scripts/push-dry-run.ts [url]
import { scrape } from "../lib/scrapers";
import { buildShopifyPushInput } from "../lib/import-mapper";
import { closeBrowser } from "../lib/scrapers/browser";

const SAMPLE_URL =
  "https://sabineandheem.com/products/920684/sabine-and-heem-__-bim-ribbed-shirt-__-butter-__-kids-longsleeved-tops";

async function main() {
  const url = process.argv[2] || SAMPLE_URL;
  const result = await scrape(url);
  if (!result.ok || !result.normalized) {
    console.error("Scrape failed:", result.error);
    process.exit(1);
  }
  const input = buildShopifyPushInput(result.normalized);
  console.log(
    JSON.stringify(
      {
        handle: input.handle,
        product: input.productPayload,
        metafields: input.metafields,
      },
      null,
      2,
    ),
  );
  await closeBrowser();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
