// Scraper dispatcher: detect platform from URL and route to its adapter.

import { scrapeShopee } from "./shopee";
import { scrapeTokopedia } from "./tokopedia";
import { scrapeWebsite } from "./website";
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
    case "WEB":
      return scrapeWebsite(url);
    default:
      return {
        ok: false,
        error: `URL tidak didukung: ${url}`,
      };
  }
}

export type { Platform, ScrapeResult, NormalizedProduct, ScraperVariant } from "./base";
