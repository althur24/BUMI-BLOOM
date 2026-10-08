// Affiliate API fallback — the stable long-term path when headless scraping is
// blocked by Shopee/Tokopedia anti-bot. These OFFICIAL APIs require partnership
// approval + credentials, so this is a structured stub: implement the fetches
// once you have app_id/secret (Shopee) or an affiliate token (Tokopedia).
//
// Until then, the Playwright + stealth adapters (shopee.ts / tokopedia.ts) are
// the primary path. The dispatcher can fall back to affiliateLookup() here when
// scraping repeatedly fails.

import type { ScrapeResult } from "./base";

export interface AffiliateConfig {
  shopeeAppId?: string; // SHOPEE_AFFILIATE_APP_ID
  shopeeSecret?: string; // SHOPEE_AFFILIATE_SECRET
  tokpedToken?: string; // TOKPED_AFFILIATE_TOKEN
}

export function loadAffiliateConfig(): AffiliateConfig {
  return {
    shopeeAppId: process.env.SHOPEE_AFFILIATE_APP_ID,
    shopeeSecret: process.env.SHOPEE_AFFILIATE_SECRET,
    tokpedToken: process.env.TOKPED_AFFILIATE_TOKEN,
  };
}

export function affiliateConfigured(c: AffiliateConfig): boolean {
  return Boolean(
    (c.shopeeAppId && c.shopeeSecret) || c.tokpedToken,
  );
}

// TODO: implement once credentials are obtained.
//   Shopee Affiliate: https://open-api.affiliate.shopee.co.id/graphql (signed w/ app_id+secret)
//   Tokopedia Affiliate: Official Affiliate API (Authorization: Bearer <token>)
// Both return product JSON that maps to NormalizedProduct.
export async function affiliateLookup(_url: string): Promise<ScrapeResult> {
  return {
    ok: false,
    error:
      "Affiliate API belum dikonfigurasi — butuh kredensial partnership Shopee/Tokped. Headless scraping adalah jalur aktif saat ini.",
  };
}
