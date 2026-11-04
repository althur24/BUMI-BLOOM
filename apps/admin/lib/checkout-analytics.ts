import { createHash } from "crypto";

function hashEmail(email: string | null | undefined): string | null {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

export async function sendPurchaseAnalytics(
  checkout: any,
  _session: any,
): Promise<void> {
  if (!checkout?.consentMarketing) return;

  const attribution = (checkout.attributionJson || {}) as Record<string, any>;
  const items = Array.isArray(checkout.itemsJson) ? checkout.itemsJson : [];
  const value = Number(checkout.amountAudCents || 0) / 100;
  const transactionId = checkout.shopifyOrderId || checkout.id;
  const eventId = checkout.id;

  const ga4Id = process.env.GA4_MEASUREMENT_ID;
  const ga4Secret = process.env.GA4_API_SECRET;
  const ga4ClientId =
    attribution.gaClientId || attribution.ga_client_id || checkout.id;

  if (ga4Id && ga4Secret) {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
      ga4Id,
    )}&api_secret=${encodeURIComponent(ga4Secret)}`;
    const body = {
      client_id: ga4ClientId,
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
          event_time: Math.floor(Date.now() / 1000),
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
