// Shared Playwright + stealth browser launcher.
// Stealth plugin masks headless automation signals (navigator.webdriver, UA,
// WebGL, etc.) to reduce anti-bot detection on Shopee/Tokopedia.

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "playwright";

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

export interface CapturedResponse {
  url: string;
  status: number;
  contentType: string;
  json?: unknown;
}

export interface WithPageOptions {
  url: string;
  timeoutMs?: number;
  // Block images/fonts/media to speed up marketplace pages. Turn off for
  // generic sites whose galleries only populate after images load.
  blockAssets?: boolean;
  // Capture JSON responses whose URL matches this predicate (e.g. GraphQL).
  capture?: (url: string) => boolean;
  waitMs?: number;
}

// Run a callback with a fresh, isolated browser context (own cookies/cache per
// scrape). The context is always closed, even on error. If the cached browser
// has died (crash/timeout), it is reset and the context is created once more.
export async function withPage<T>(
  fn: (page: Page, captured: CapturedResponse[]) => Promise<T>,
  opts: WithPageOptions = { url: "" },
): Promise<T> {
  let context;
  try {
    context = await newContext(opts.blockAssets !== false);
  } catch {
    // Browser may have died — reset and retry once.
    await closeBrowser().catch(() => {});
    context = await newContext(opts.blockAssets !== false);
  }
  const page = await context.newPage();
  const captured: CapturedResponse[] = [];

  if (opts.capture) {
    page.on("response", (response) => {
      try {
        const url = response.url();
        if (!opts.capture!(url)) return;
        const contentType = response.headers()["content-type"] || "";
        if (!/json|javascript|text/i.test(contentType)) return;
        void response
          .json()
          .then((json) => {
            if (captured.length < 40) {
              captured.push({ url, status: response.status(), contentType, json });
            }
          })
          .catch(() => {});
      } catch {
        // response already disposed — ignore
      }
    });
  }

  if (opts.url) {
    await page.goto(opts.url, {
      waitUntil: "domcontentloaded",
      timeout: opts.timeoutMs ?? 45000,
    });
    // Let client hydration / lazy state settle (marketplaces need ~3s).
    await new Promise((r) => setTimeout(r, opts.waitMs ?? 3000));
  }
  try {
    return await fn(page, captured);
  } finally {
    await context.close().catch(() => {});
  }
}

async function newContext(blockAssets: boolean): Promise<import("playwright").BrowserContext> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 800 },
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    extraHTTPHeaders: { "Accept-Language": "id,en;q=0.9" },
  });
  // Best-effort block heavy assets to speed page load. Images are only blocked
  // when the caller doesn't need client-side image hydration.
  const pattern = blockAssets
    ? "**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,mp4,webm}"
    : "**/*.{woff,woff2,mp4,webm}";
  await context.route(pattern, (route) => route.abort().catch(() => {}));
  return context;
}

// Read all JSON-LD <script> blocks from the current page.
export async function readJsonLd(page: Page): Promise<unknown[]> {
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
