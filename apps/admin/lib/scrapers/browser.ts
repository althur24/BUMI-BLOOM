// Shared Playwright + stealth browser launcher.
// Stealth plugin masks headless automation signals (navigator.webdriver, UA,
// WebGL, etc.) to reduce anti-bot detection on Shopee/Tokopedia.

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "playwright";

chromium.use(StealthPlugin());

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (_browser) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

// Run a callback with a fresh, isolated browser context (own cookies/cache per
// scrape). The context is always closed, even on error. If the cached browser
// has died (crash/timeout), it is reset and the context is created once more.
export async function withPage<T>(
  fn: (page: import("playwright").Page) => Promise<T>,
  opts: { url: string; timeoutMs?: number } = { url: "" },
): Promise<T> {
  let context;
  try {
    context = await newContext();
  } catch (e) {
    // Browser may have died — reset and retry once.
    await closeBrowser().catch(() => {});
    context = await newContext();
  }
  const page = await context.newPage();
  if (opts.url) {
    await page.goto(opts.url, {
      waitUntil: "domcontentloaded",
      timeout: opts.timeoutMs ?? 45000,
    });
    // Let client hydration / lazy state settle.
    await new Promise((r) => setTimeout(r, 2000));
  }
  try {
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
  }
}

async function newContext(): Promise<import("playwright").BrowserContext> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 800 },
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    extraHTTPHeaders: { "Accept-Language": "id,en;q=0.9" },
  });
  // Best-effort block heavy trackers to speed up load (does not block core data).
  await context.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2}", (route) =>
    route.abort().catch(() => {}),
  );
  return context;
}

// Read all JSON-LD <script> blocks from the current page.
export async function readJsonLd(
  page: import("playwright").Page,
): Promise<unknown[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    )
      .map((el) => {
        try {
          return JSON.parse(el.textContent || "{}");
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );
}
