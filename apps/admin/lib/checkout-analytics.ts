import { createHash } from "crypto";

function hashEmail(email: string | null | undefined): string | null {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

// GA4 client_id must look like "1234567890.1234567890" (a valid `_ga` cookie
// value). Anything else (e.g. a cuid fallback) is rejected by the MP endpoint.
function isGaClientId(value: unknown): boolean {
  return typeof value === "string" && /^\d+\.\d+$/.test(value.trim());
}

// The storefront sends `event_id: checkout.id` from the success page; using the
// same id here lets Meta CAPI and GA4 deduplicate browser + server hits.
export async function sendPurchaseAnalytics(
  checkout: any,
  _session: any,
): Promise<void> {
  // NOTE: this used to bail out unless the customer ticked the (optional)
  // marketing-newsletter checkbox. That checkbox is an email opt-in, not an
  // analytics consent, so purchase tracking was silently dropped for most
  // customers. The store runs without a cookie banner and grants analytics
  // consent up front, so we always send.
  if (!checkout) return;

  const attribution = (checkout.attributionJson || {}) as Record<string, any>;
  const items = Array.isArray(checkout.itemsJson) ? checkout.itemsJson : [];
  const value = Number(checkout.amountAudCents || 0) / 100;
  const transactionId = checkout.shopifyOrderId || checkout.id;
  const eventId = checkout.id;
  const eventTime = Math.floor((checkout.updatedAt ? new Date(checkout.updatedAt).getTime() : Date.now()) / 1000);

  const ga4Id = process.env.GA4_MEASUREMENT_ID;
  const ga4Secret = process.env.GA4_API_SECRET;
  const gaCandidate = attribution.gaClientId || attribution.ga_client_id;
  const ga4ClientId = isGaClientId(gaCandidate) ? String(gaCandidate).trim() : null;

  if (ga4Id && ga4Secret && ga4ClientId) {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
      ga4Id,
    )}&api_secret=${encodeURIComponent(ga4Secret)}`;
    const body = {
      client_id: ga4ClientId,
      timestamp_micros: Date.now() * 1000,
      events: [
        {
          name: "purchase",
          params: {
            transaction_id: transactionId,
            value,
            currency: "AUD",
            tax: Number(checkout.taxAudCents || 0) / 100,
            shipping: Number(checkout.shippingAudCents || 0) / 100,
            items: items.map((item: any) => ({
              item_id: item.variantId,
              item_name: item.productTitle,
              item_variant: item.variantTitle,
              price: Number(item.priceAudCents || 0) / 100,
              quantity: Number(item.quantity || 1),
            })),
          },
        },
      ],
    };
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      console.error("[checkout] GA4 purchase failed", err);
    }
  } else if (ga4Id && ga4Secret) {
    // Missing a valid client_id would make the MP request 400; skip cleanly.
    console.warn("[checkout] GA4 purchase skipped: no valid _ga client_id", checkout.id);
  }

  const pixelId = process.env.META_PIXEL_ID;
  const capiToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (pixelId && capiToken) {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(
      pixelId,
    )}/events?access_token=${encodeURIComponent(capiToken)}`;
    const body = {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTime,
          event_id: eventId,
          action_source: "website",
          event_source_url: attribution.eventSourceUrl || undefined,
          user_data: {
            em: hashEmail(checkout.customerEmail)
              ? [hashEmail(checkout.customerEmail)]
              : undefined,
            fbp: attribution.fbp || undefined,
            fbc: attribution.fbc || undefined,
          },
          custom_data: {
            currency: "AUD",
            value,
            order_id: transactionId,
            content_ids: items.map((item: any) => item.variantId),
            content_type: "product",
            num_items: items.reduce(
              (sum: number, item: any) => sum + Number(item.quantity || 1),
              0,
            ),
          },
        },
      ],
    };
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      console.error("[checkout] Meta CAPI purchase failed", err);
    }
  }
}
