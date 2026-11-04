import Stripe from "stripe";

let stripeClient: Stripe | null = null;
let cachedTaxRateId: string | null = null;

export function getStripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(secret, {
      // Checkout form mode (ui_mode: "form") requires the dahlia API version.
      // The bundled SDK types pin an older default, so we set the version
      // explicitly and let the runtime validate it.
      apiVersion: "2026-08-26.dahlia" as never,
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }
  return stripeClient;
}

// Wallet methods (Apple Pay / Google Pay) are derived from the card rail by
// Stripe and must never be requested explicitly.
const DERIVED_METHODS = new Set(["apple_pay", "google_pay"]);

/**
 * Optional hard override for the payment methods sent to Stripe.
 *
 * By default we send NOTHING and let Stripe use the account's payment method
 * configuration (dynamic payment methods). That is the recommended setup: it
 * automatically respects the dashboard config, the checkout currency, the
 * customer's country, and the device's wallet support without code changes.
 *
 * Set STRIPE_PAYMENT_METHODS=card,link,klarna only if you need to pin the list.
 */
export function getPaymentMethodOverride(): string[] | null {
  const raw = process.env.STRIPE_PAYMENT_METHODS?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && !DERIVED_METHODS.has(value));
  return list.length ? list : null;
}

export async function getGstTaxRateId(): Promise<string> {
  if (cachedTaxRateId) return cachedTaxRateId;
  const configured = process.env.STRIPE_GST_TAX_RATE_ID;
  if (configured) {
    cachedTaxRateId = configured;
    return configured;
  }

  const stripe = getStripe();
  const existing = await stripe.taxRates.list({ active: true, limit: 100 });
  const found = existing.data.find(
    (rate) =>
      rate.metadata?.bumi_gst === "true" ||
      (rate.display_name === "GST 10%" && rate.inclusive),
  );
  if (found) {
    cachedTaxRateId = found.id;
    return found.id;
  }

  const created = await stripe.taxRates.create(
    {
      display_name: "GST 10%",
      description: "Australian GST included in displayed prices",
      inclusive: true,
      percentage: 10,
      country: "AU",
      tax_type: "gst",
      metadata: { bumi_gst: "true" },
    },
    { idempotencyKey: "bumi-gst-10-inclusive" },
  );
  cachedTaxRateId = created.id;
  return created.id;
}
