// Scraper dispatcher: detect marketplace from URL and route to its adapter.

import { scrapeShopee } from "./shopee";
import { scrapeTokopedia } from "./tokopedia";
import { detectPlatform } from "../platform";
import type { ScrapeResult } from "./base";

export { detectPlatform };

export async function scrape(url: string): Promise<ScrapeResult> {
  const platform = detectPlatform(url);
  switch (platform) {
    case "SHOPEE":
      return scrapeShopee(url);
    case "TOKPED":
      return scrapeTokopedia(url);
    default:
      return {
        ok: false,
        error: `Platform tidak didukung. Hanya Shopee & Tokopedia. URL: ${url}`,
      };
  }
}

export type { Platform, ScrapeResult, NormalizedProduct, ScraperVariant } from "./base";
