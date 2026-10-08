// TEMP smoke test — verifies Playwright launches + scraper runs end-to-end.
// Run: npx tsx apps/admin/scripts/scrape-test.ts
import { getBrowser, closeBrowser } from "../lib/scrapers/browser";
import { scrape } from "../lib/scrapers/index";
import { enrichProduct } from "../lib/ai/enrich";

async function main() {
  console.log("1) Browser launch sanity (example.com)...");
  const browser = await getBrowser();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("https://example.com", { timeout: 30000 });
  console.log("   title:", await page.title());
  await ctx.close();

  console.log("\n2) Scrape Tokopedia (homepage — thin, proves adapter runs)...");
  const r = await scrape("https://www.tokopedia.com/");
  console.log("   ok:", r.ok, "| error:", r.error);
  if (r.normalized) {
    console.log("   title:", r.normalized.title);
    console.log(
      "   images:",
      r.normalized.images.length,
      "| price:",
      r.normalized.price,
      r.normalized.currency,
    );
  }

  console.log("\n3) Enrich rule-based (no OPENAI_API_KEY → aiUsed=false)...");
  const e = await enrichProduct({
    platform: "SHOPEE",
    sourceUrl: "https://shopee.co.id/x",
    title: "[COD] Ready Stock Kemeja Anak Laki (Promo!!!) 🚀",
    description: "<p>Bagus &amp; murah</p>",
    images: [],
    variants: [],
  });
  console.log("   aiUsed:", e.aiUsed);
  console.log("   cleaned title:", JSON.stringify(e.enriched.title));
  console.log("   cleaned desc:", JSON.stringify(e.enriched.description));

  await closeBrowser();
  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
