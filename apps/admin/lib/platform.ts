// Pure URL→platform detection, isolated from the Playwright imports so route
// handlers can call it without pulling the (heavy) browser module into their
// graph. The scraper dispatcher re-uses this.

import type { Platform } from "./scrapers/base";

export type { Platform };

export function detectPlatform(url: string): Platform {
  const u = url.toLowerCase();
  if (/shopee\.(co\.id|com|sg|my|th|ph|vn|br)/.test(u)) return "SHOPEE";
  if (/tokopedia\.(com|care)/.test(u)) return "TOKPED";
  return "OTHER";
}
