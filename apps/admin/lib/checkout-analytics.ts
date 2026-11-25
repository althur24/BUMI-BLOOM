import { createHash } from "crypto";

function sha256(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed).digest("hex");
}

// Meta requires user identifiers to be normalized THEN hashed: lowercase,
// whitespace-stripped for most fields, digits-only for phone/zip.
function hashEmail(email: string | null | undefined): string | null {
  return sha256(String(email || "").trim().toLowerCase());
}

function hashName(name: string | null | undefined): string | null {
  const value = String(name || "").trim().toLowerCase();
  if (!value) return null;
  return sha256(value.replace(/\s+/g, ""));
}

function hashPhone(phone: string | null | undefined): string | null {
  // CAPI expects E.164-ish digits (no +, spaces, dashes) before hashing.
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  return sha256(digits);
}

function hashText(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  return sha256(normalized.replace(/\s+/g, ""));
}

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined && value !== "") {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

// GA4 client_id must look like "1234567890.1234567890" (a valid `_ga` cookie
// value). Anything else (e.g. a cuid fallback) is rejected by the MP endpoint.
function isGaClientId(value: unknown): boolean {
  return typeof value === "string" && /^\d+\.\d+$/.test(value.trim());
}

// Stripe returns the collected shipping address in slightly different shapes
// depending on API version; mirror shopify-checkout.ts so CAPI sees the same
// data the order uses.
function shippingDetails(session: any): any | null {
  return (
    session?.collected_information?.shipping_details ||
    session?.shipping_details ||
    null
  );
}

function splitName(name: string | null | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const value = String(name || "").trim();
  if (!value) return {};
  const parts = value.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

// Meta deduplicates browser + server events on event_id (the checkout id).
// GA4 deduplicates on transaction_id, so both sides must use the SAME value or
// a purchase is counted twice once server-side MP is enabled.
//
// The value must be available at the very first success-page poll, which can
// happen before the Shopify order (and its name) exists. `shopifyOrderName` is
// therefore unsafe: the browser could fire with a null orderName and send the
// checkout id while the server later sends the order name. `checkout.id` is
// always present on both sides, so it is the only stable dedup key.
export function ga4TransactionId(checkout: any): string {
  return checkout?.id;
}

// Meta's `order_id` is display-only (it plays no part in dedup), so keep the
// friendlier Shopify order name when it is known.
export function metaOrderId(checkout: any): string {
  return checkout?.shopifyOrderName || checkout?.id;
}

// The storefront sends `event_id: checkout.id` from the success page; using the
// same id here lets Meta CAPI deduplicate browser + server hits.
export async function sendPurchaseAnalytics(
  checkout: any,
  session: any,
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
  // GA4 dedup key (stable, present on both sides) vs Meta display label.
  const ga4TxId = ga4TransactionId(checkout);
  const metaOrder = metaOrderId(checkout);
  const eventId = checkout.id;
  const eventTime = Math.floor(
    (checkout.updatedAt ? new Date(checkout.updatedAt).getTime() : Date.now()) /
      1000,
  );

  sendGa4Purchase({
    attribution,
    items,
    value,
    transactionId: ga4TxId,
    checkout,
  }).catch(() => {});

  await sendMetaPurchase({
    attribution,
    items,
    value,
    orderId: metaOrder,
    eventId,
    eventTime,
    checkout,
    session,
  });
}

function sendMetaPurchase(args: {
  attribution: Record<string, any>;
  items: any[];
  value: number;
  orderId: string;
  eventId: string;
  eventTime: number;
  checkout: any;
  session: any;
}): Promise<void> | void {
  const {
    attribution,
    items,
    value,
    orderId,
    eventId,
    eventTime,
    checkout,
    session,
  } = args;

  const pixelId = process.env.META_PIXEL_ID;
  const capiToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !capiToken) return;

  const apiVersion = process.env.META_CAPI_API_VERSION || "v19.0";

  const shipping = shippingDetails(session);
  const address =
    shipping?.address || session?.customer_details?.address || null;
  const name = splitName(
    shipping?.name || session?.customer_details?.name || null,
  );
  const phone = shipping?.phone || session?.customer_details?.phone || null;
  const email = checkout.customerEmail || session?.customer_details?.email;

  // fbc: prefer the cookie Meta already set; otherwise synthesize it from the
  // stored fbclid (Meta's documented format: fb.1.<ts>.<fbclid>).
  let fbc = String(attribution.fbc || "").trim();
  if (!fbc && attribution.fbclid) {
    const ts = Number(attribution.ts || Date.now());
    fbc = `fb.1.${ts}.${attribution.fbclid}`;
  }

  const userData = compact({
    em: hashEmail(email) ? [hashEmail(email)] : undefined,
    fn: hashName(name.firstName) ? [hashName(name.firstName)] : undefined,
    ln: hashName(name.lastName) ? [hashName(name.lastName)] : undefined,
    ph: hashPhone(phone) ? [hashPhone(phone)] : undefined,
    ct: hashText(address?.city) ? [hashText(address?.city)] : undefined,
    st: hashText(address?.state) ? [hashText(address?.state)] : undefined,
    zp: hashText(address?.postal_code) ? [hashText(address?.postal_code)] : undefined,
    country: hashText(address?.country) ? [hashText(address?.country)] : undefined,
    fbp: String(attribution.fbp || "").trim() || undefined,
    fbc: fbc || undefined,
    client_ip_address: String(attribution.clientIp || "").trim() || undefined,
    client_user_agent:
      String(attribution.clientUserAgent || "").trim() || undefined,
  });

  const body: Record<string, any> = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: eventId,
        event_source_url: attribution.eventSourceUrl || undefined,
        action_source: "website",
        user_data: userData,
        custom_data: {
          currency: checkout.currency || "AUD",
          value,
          order_id: orderId,
          content_ids: items.map((item: any) => item.variantId),
          content_type: "product",
          content_name: items.map((item: any) => item.productTitle).filter(Boolean).join(", ") || undefined,
          num_items: items.reduce(
            (sum: number, item: any) => sum + Number(item.quantity || 1),
            0,
          ),
        },
      },
    ],
  };

  // Events Manager "Test Events" code — when set, CAPI events show up in the
  // live test feed so a test purchase can be verified end-to-end.
  const testEventCode = String(process.env.META_TEST_EVENT_CODE || "").trim();
  if (testEventCode) body.test_event_code = testEventCode;

  const url = `https://graph.facebook.com/${encodeURIComponent(
    apiVersion,
  )}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(
    capiToken,
  )}`;

  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  })
    .then(async (res) => {
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(
          "[checkout] Meta CAPI purchase failed",
          checkout.id,
          res.status,
          detail.slice(0, 500),
        );
      }
    })
    .catch((err) => {
      console.error("[checkout] Meta CAPI purchase failed", checkout.id, err);
    });
}

async function sendGa4Purchase(args: {
  attribution: Record<string, any>;
  items: any[];
  value: number;
  transactionId: string;
  checkout: any;
}): Promise<void> {
  const { attribution, items, value, transactionId, checkout } = args;

  const ga4Id = process.env.GA4_MEASUREMENT_ID;
  const ga4Secret = process.env.GA4_API_SECRET;
  const gaCandidate = attribution.gaClientId || attribution.ga_client_id;
  const ga4ClientId = isGaClientId(gaCandidate)
    ? String(gaCandidate).trim()
    : null;

  if (!ga4Id || !ga4Secret) return;
  if (!ga4ClientId) {
    // Missing a valid client_id would make the MP request 400; skip cleanly.
    console.warn(
      "[checkout] GA4 purchase skipped: no valid _ga client_id",
      checkout.id,
    );
    return;
  }

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
          currency: checkout.currency || "AUD",
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
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(
        "[checkout] GA4 purchase failed",
        checkout.id,
        res.status,
      );
    }
  } catch (err) {
    console.error("[checkout] GA4 purchase failed", err);
  }
}
