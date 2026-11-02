// Smoke test: verifies the scraper pipeline for marketplace + generic websites.
// Run: npx tsx apps/admin/scripts/scrape-test.ts [url ...]
import { closeBrowser } from "../lib/scrapers/browser";
import { scrape } from "../lib/scrapers/index";

const DEFAULT_URLS = [
  "https://sabineandheem.com/products/920684/sabine-and-heem-__-bim-ribbed-shirt-__-butter-__-kids-longsleeved-tops",
  "https://www.tokopedia.com/anakmuofficial/anakmu-piccolo-jacket-anak-1-5-tahun-premium-polyester-windbreaker-new-color-1731067019955046293",
];

async function main() {
  const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;

  for (const url of urls) {
    console.log(`\n=== ${url} ===`);
    const r = await scrape(url);
    console.log("ok:", r.ok, "| error:", r.error);
    if (!r.ok || !r.normalized) {
      console.log("raw:", JSON.stringify(r.raw).slice(0, 500));
      continue;
    }
    const n = r.normalized;
    console.log("path:        ", n.extractionPath);
    console.log("title:       ", n.title);
    console.log("brand:       ", n.brand);
    console.log("price:       ", n.price, n.currency, "| compareAt:", n.compareAtPrice);
    console.log("description: ", (n.description || "").slice(0, 140).replace(/\n/g, " "));
    console.log("images:      ", n.images.length, "| size chart:", n.sizeChartImage || "-");
    n.images.slice(0, 6).forEach((img, i) => console.log(`  img[${i}]`, img));
    console.log("colors:      ", JSON.stringify(n.colors || []));
    console.log("fibre:       ", n.fibre);
    console.log("material:    ", (n.materialCare || "").replace(/\n/g, " ").slice(0, 120));
    console.log("size guide:  ", (n.sizeGuide || "").replace(/\n/g, " | ").slice(0, 200));
    console.log("rating/sold: ", n.rating, "/", n.soldCount, "| location:", n.location);
    console.log("variants:    ", n.variants.length);
    n.variants.forEach((v, i) =>
      console.log(
        `  [${i}]`,
        JSON.stringify(v.options),
        "| price:",
        v.price,
        "| stock:",
        v.stock,
        "| sku:",
        v.sku || "-",
        "| hex:",
        v.hex || "-",
      ),
    );
  }

  await closeBrowser();
  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
