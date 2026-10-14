// TEMP smoke test — verifies Tokopedia scraper + AUD conversion.
// Run: npx tsx apps/admin/scripts/scrape-test.ts
import { closeBrowser } from "../lib/scrapers/browser";
import { scrape } from "../lib/scrapers/index";
import { getAudToIdrRate } from "../lib/currency";

async function main() {
  // 1) Test live exchange rate
  console.log("=== 1) Live AUD→IDR rate ===");
  const rate = await getAudToIdrRate();
  console.log("1 AUD =", rate, "IDR");

  // 2) Scrape Tokopedia
  const url =
    "https://www.tokopedia.com/sabineandheem/sabine-and-heem-bim-ribbed-shirt-mahogany-atasan-lengan-panjang-anak-1737870014618502495-1737870015238341983";
  console.log("\n=== 2) Scrape Tokopedia ===");
  const r = await scrape(url);
  console.log("ok:", r.ok, "| error:", r.error);

  if (r.normalized) {
    const n = r.normalized;
    console.log("\n=== RESULT (before AUD conversion) ===");
    console.log("title:       ", n.title);
    console.log("brand:       ", n.brand);
    console.log("price:       ", n.price, n.currency);
    console.log("description: ", (n.description || "").slice(0, 120));
    console.log("images:      ", n.images.length);
    console.log("variants:    ", n.variants.length);
    n.variants.forEach((v, i) =>
      console.log(`  [${i}]`, JSON.stringify(v.options), "| stock:", v.stock, "| hex:", v.hex || "-"),
    );

    // 3) Simulate AUD conversion
    console.log("\n=== 3) After AUD conversion (simulated) ===");
    if (n.currency === "IDR" && n.price) {
      const audPrice = Math.round((n.price / rate) * 100) / 100;
      console.log(`Rp${n.price} IDR ÷ ${rate} = $${audPrice} AUD`);
      console.log("(was $%s AUD with fixed 10000)", (n.price / 10000).toFixed(2));
    }
  }

  await closeBrowser();
  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
