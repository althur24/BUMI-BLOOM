// TEMP smoke test — verifies Tokopedia scraper extracts all fields.
// Run: npx tsx apps/admin/scripts/scrape-test.ts
import { closeBrowser } from "../lib/scrapers/browser";
import { scrape } from "../lib/scrapers/index";

async function main() {
  const url =
    "https://www.tokopedia.com/sabineandheem/sabine-and-heem-bim-ribbed-shirt-mahogany-atasan-lengan-panjang-anak-1737870014618502495-1737870015238341983";

  console.log("Scraping Tokopedia:", url.slice(0, 80), "...\n");
  const r = await scrape(url);
  console.log("ok:", r.ok, "| error:", r.error);
  console.log("raw:", JSON.stringify(r.raw));

  if (r.normalized) {
    const n = r.normalized;
    console.log("\n=== RESULT ===");
    console.log("title:       ", n.title);
    console.log("brand:       ", n.brand);
    console.log("price:       ", n.price, n.currency);
    console.log("description: ", (n.description || "").slice(0, 120));
    console.log("images:      ", n.images.length, "URL(s)");
    n.images.slice(0, 3).forEach((u, i) => console.log(`  [${i}]`, u.slice(0, 100)));
    console.log("variants:    ", n.variants.length);
    n.variants.forEach((v, i) =>
      console.log(`  [${i}]`, JSON.stringify(v.options), "| stock:", v.stock, "| price:", v.price),
    );
  }

  await closeBrowser();
  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
