import { adminGraphQL } from "./shopify";
import {
  CheckoutError,
  type ResolvedCheckoutItem,
} from "./checkout";

const STOREFRONT_API_VERSION = () =>
  process.env.SHOPIFY_API_VERSION || "2026-10";

function storefrontEndpoint(): string {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) throw new Error("SHOPIFY_SHOP is not configured.");
  return `https://${shop}.myshopify.com/api/${STOREFRONT_API_VERSION()}/graphql.json`;
}

async function storefrontGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
  if (!token) throw new Error("SHOPIFY_STOREFRONT_TOKEN is not configured.");

  const res = await fetch(storefrontEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Storefront API returned invalid JSON (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(`Storefront API HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (json?.errors?.length) {
    throw new Error(`Storefront GraphQL: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

const VARIANTS_QUERY = `query CheckoutVariants($ids: [ID!]!) @inContext(country: AU) {
  nodes(ids: $ids) {
    __typename
    ... on ProductVariant {
      id
      title
      availableForSale
      quantityAvailable
      price { amount currencyCode }
      image { url }
      selectedOptions { name value }
      product {
        title
        handle
        featuredImage { url }
      }
    }
  }
}`;

interface StorefrontVariantNode {
  __typename: string;
  id: string;
  title: string;
  availableForSale: boolean;
  quantityAvailable: number | null;
  price: { amount: string; currencyCode: string };
  image: { url: string } | null;
  selectedOptions: { name: string; value: string }[];
  product: {
    title: string;
    handle: string;
    featuredImage: { url: string } | null;
  };
}

export async function fetchCheckoutVariants(
  ids: string[],
): Promise<Map<string, ResolvedCheckoutItem>> {
  if (!ids.length) throw new CheckoutError(400, "Your bag is empty.");

  const data = await storefrontGraphQL<{ nodes: (StorefrontVariantNode | null)[] }>(
    VARIANTS_QUERY,
    { ids },
  );

  const out = new Map<string, ResolvedCheckoutItem>();
  for (const node of data.nodes || []) {
    if (!node || node.__typename !== "ProductVariant") continue;
    if (!node.availableForSale) {
      throw new CheckoutError(
        409,
        `${node.product?.title || "An item"} is no longer available.`,
      );
    }
    if (
      typeof node.quantityAvailable === "number" &&
      node.quantityAvailable < 1
    ) {
      throw new CheckoutError(
        409,
        `${node.product?.title || "An item"} is out of stock.`,
      );
    }
    if (node.price.currencyCode !== "AUD") {
      throw new CheckoutError(409, "This item is not available in AUD.");
    }

    const variantTitle =
      node.selectedOptions
        ?.map((option) => option.value)
        .filter(Boolean)
        .join(" / ") || node.title;

    out.set(node.id, {
      variantId: node.id,
      productTitle: node.product?.title || "Product",
      variantTitle,
      handle: node.product?.handle || "",
      imageUrl:
        node.image?.url || node.product?.featuredImage?.url || null,
      priceAudCents: Math.round(Number(node.price.amount) * 100),
      quantity: 0,
      quantityAvailable:
        typeof node.quantityAvailable === "number"
          ? node.quantityAvailable
          : null,
    });
  }

  for (const id of ids) {
    if (!out.has(id)) {
      throw new CheckoutError(409, "An item in your bag is no longer available.");
    }
  }
  return out;
}

const DISCOUNT_QUERY = `query CheckoutDiscount($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      __typename
      ... on DiscountCodeBasic {
        title
        status
        startsAt
        endsAt
        usageLimit
        asyncUsageCount
        appliesOncePerCustomer
        minimumRequirement {
          __typename
          ... on DiscountMinimumSubtotal {
            greaterThanOrEqualToSubtotal { amount currencyCode }
          }
          ... on DiscountMinimumQuantity {
            greaterThanOrEqualToQuantity
          }
        }
        customerGets {
          appliesOnOneTimePurchase
          value {
            __typename
            ... on DiscountPercentage {
              percentage
            }
            ... on DiscountAmount {
              amount { amount currencyCode }
              appliesOnEachItem
            }
          }
          items { __typename }
        }
      }
    }
  }
}`;

export interface ShopifyDiscount {
  id: string;
  code: string;
  title: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  asyncUsageCount: number;
  appliesOncePerCustomer: boolean;
  appliesOnOneTimePurchase: boolean;
  itemsType: string;
  valueType: string;
  percentage: number | null;
  amountAudCents: number | null;
  appliesOnEachItem: boolean;
  minimumSubtotalAudCents: number | null;
  minimumQuantity: number | null;
}

export async function fetchShopifyDiscount(
  code: string,
): Promise<ShopifyDiscount | null> {
  const data = await adminGraphQL<any>(DISCOUNT_QUERY, { code });
  const node = data?.codeDiscountNodeByCode;
  const discount = node?.codeDiscount;
  if (!node || !discount) return null;
  if (discount.__typename !== "DiscountCodeBasic") {
    throw new CheckoutError(
      400,
      "This discount code isn't supported at checkout yet.",
    );
  }

  const minimum = discount.minimumRequirement;
  const minimumSubtotal =
    minimum?.__typename === "DiscountMinimumSubtotal"
      ? Math.round(
          Number(minimum.greaterThanOrEqualToSubtotal?.amount || 0) * 100,
        )
      : null;
  const minimumQuantity =
    minimum?.__typename === "DiscountMinimumQuantity"
      ? Number(minimum.greaterThanOrEqualToQuantity || 0)
      : null;

  const value = discount.customerGets?.value;
  const percentage =
    value?.__typename === "DiscountPercentage"
      ? Number(value.percentage || 0)
      : null;
  const amountAudCents =
    value?.__typename === "DiscountAmount"
      ? Math.round(Number(value.amount?.amount || 0) * 100)
      : null;

  return {
    id: node.id,
    code,
    title: discount.title || code,
    status: discount.status || "UNKNOWN",
    startsAt: discount.startsAt || null,
    endsAt: discount.endsAt || null,
    usageLimit:
      typeof discount.usageLimit === "number" ? discount.usageLimit : null,
    asyncUsageCount: Number(discount.asyncUsageCount || 0),
    appliesOncePerCustomer: Boolean(discount.appliesOncePerCustomer),
    appliesOnOneTimePurchase: Boolean(
      discount.customerGets?.appliesOnOneTimePurchase,
    ),
    itemsType: discount.customerGets?.items?.__typename || "",
    valueType: value?.__typename || "",
    percentage,
    amountAudCents,
    appliesOnEachItem: Boolean(value?.appliesOnEachItem),
    minimumSubtotalAudCents: minimumSubtotal,
    minimumQuantity,
  };
}

export function assertDiscountUsable(
  discount: ShopifyDiscount,
  subtotalAudCents: number,
  quantity: number,
  webRedemptions: number,
): void {
  if (discount.status !== "ACTIVE") {
    throw new CheckoutError(400, "This discount code is not active.");
  }

  const now = Date.now();
  if (discount.startsAt && new Date(discount.startsAt).getTime() > now) {
    throw new CheckoutError(400, "This discount code isn't available yet.");
  }
  if (discount.endsAt && new Date(discount.endsAt).getTime() < now) {
    throw new CheckoutError(400, "This discount code has expired.");
  }
  if (discount.appliesOncePerCustomer) {
    throw new CheckoutError(
      400,
      "This discount code requires a customer account and isn't available at guest checkout.",
    );
  }
  if (!discount.appliesOnOneTimePurchase) {
    throw new CheckoutError(
      400,
      "This discount code isn't available for one-time purchases.",
    );
  }
  if (discount.itemsType !== "AllDiscountItems") {
    throw new CheckoutError(
      400,
      "This discount code only applies to specific products and isn't supported yet.",
    );
  }
  if (discount.usageLimit != null) {
    const used = discount.asyncUsageCount + webRedemptions;
    if (used >= discount.usageLimit) {
      throw new CheckoutError(400, "This discount code has reached its limit.");
    }
  }
  if (
    discount.minimumSubtotalAudCents != null &&
    subtotalAudCents < discount.minimumSubtotalAudCents
  ) {
    throw new CheckoutError(
      400,
      "Your bag doesn't meet the minimum spend for this code.",
    );
  }
  if (
    discount.minimumQuantity != null &&
    quantity < discount.minimumQuantity
  ) {
    throw new CheckoutError(
      400,
      "Your bag doesn't meet the minimum quantity for this code.",
    );
  }
}

// Shopify's Admin API returns DiscountPercentage.percentage as a rate (0.1
// for 10%), not as a whole number. Older docs/examples often show 10, so we
// accept both shapes and normalise to a 0–100 percentage.
export function normalizePercentage(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw <= 1) return raw * 100;
  return raw;
}

export function computeDiscountCents(
  discount: ShopifyDiscount,
  subtotalAudCents: number,
  quantity: number,
): number {
  let amount = 0;
  if (discount.valueType === "DiscountPercentage") {
    const percent = normalizePercentage(discount.percentage);
    amount = Math.round((subtotalAudCents * percent) / 100);
  } else if (discount.valueType === "DiscountAmount") {
    const base = Number(discount.amountAudCents || 0);
    amount = discount.appliesOnEachItem ? base * quantity : base;
  } else {
    throw new CheckoutError(
      400,
      "This discount code type isn't supported yet.",
    );
  }
  return Math.max(0, Math.min(amount, subtotalAudCents));
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

function draftOrderInput(
  checkout: any,
  session: any,
): Record<string, unknown> {
  const collected = session?.collected_information?.shipping_details;
  const legacy = session?.shipping_details;
  const shipping = collected || legacy || null;
  const address = shipping?.address || session?.customer_details?.address || null;
  const name = splitName(shipping?.name || session?.customer_details?.name);
  const email = session?.customer_details?.email || null;
  const items = Array.isArray(checkout.itemsJson) ? checkout.itemsJson : [];
  const discountCents = Number(checkout.discountAudCents || 0);
  const promoCode = checkout.promoCode || null;
  const paymentIntent =
    typeof session?.payment_intent === "string"
      ? session.payment_intent
      : session?.payment_intent?.id || null;

  const country =
    address?.country === "AU" || !address?.country
      ? "Australia"
      : address.country;

  const shippingAddress = address
    ? {
        ...name,
        address1: address.line1 || "",
        address2: address.line2 || "",
        city: address.city || "",
        province: address.state || "",
        zip: address.postal_code || "",
        country,
        phone: shipping?.phone || session?.customer_details?.phone || undefined,
      }
    : undefined;

  const shippingAmount = (Number(checkout.shippingAudCents || 0) / 100).toFixed(2);
  const discountAmount = (discountCents / 100).toFixed(2);

  return {
    email: email || undefined,
    presentmentCurrencyCode: "AUD",
    sourceName: "stripe_checkout",
    taxExempt: false,
    shippingAddress,
    billingAddress: shippingAddress,
    shippingLine: {
      title:
        Number(checkout.shippingAudCents || 0) === 0
          ? "Free standard shipping"
          : "Standard shipping (5-8 business days)",
      priceWithCurrency: {
        amount: shippingAmount,
        currencyCode: "AUD",
      },
    },
    appliedDiscount:
      discountCents > 0
        ? {
            title: promoCode || "Discount",
            description: promoCode || "Discount",
            valueType: "FIXED_AMOUNT",
            value: discountCents / 100,
            amountWithCurrency: {
              amount: discountAmount,
              currencyCode: "AUD",
            },
          }
        : undefined,
    lineItems: items.map((item: any) => ({
      variantId: item.variantId,
      quantity: Number(item.quantity || 1),
      originalUnitPriceWithCurrency: {
        amount: (Number(item.priceAudCents || 0) / 100).toFixed(2),
        currencyCode: "AUD",
      },
    })),
    tags: ["stripe-checkout"],
    note: [
      `Stripe checkout ${checkout.id}`,
      promoCode ? `Promo ${promoCode}` : null,
      paymentIntent ? `Payment ${paymentIntent}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
    customAttributes: [
      { key: "stripe_checkout_id", value: checkout.id },
      { key: "stripe_session_id", value: checkout.stripeSessionId },
      ...(paymentIntent
        ? [{ key: "stripe_payment_intent", value: paymentIntent }]
        : []),
      ...(promoCode ? [{ key: "promo_code", value: promoCode }] : []),
    ],
  };
}

export async function createShopifyOrderFromCheckout(
  checkout: any,
  session: any,
): Promise<{
  orderId: string;
  orderName: string | null;
  financialStatus: string | null;
  totalAudCents: number | null;
}> {
  const input = draftOrderInput(checkout, session);
  const created = await adminGraphQL<any>(
    `mutation CheckoutDraftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          name
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
        }
        userErrors { field message }
      }
    }`,
    { input },
  );

  const draft = created?.draftOrderCreate?.draftOrder;
  const createErrors = created?.draftOrderCreate?.userErrors || [];
  if (createErrors.length) {
    throw new Error(
      `Shopify draftOrderCreate: ${createErrors
        .map((e: any) => `${(e.field || []).join(".")} ${e.message}`.trim())
        .join("; ")}`,
    );
  }
  if (!draft?.id) throw new Error("Shopify did not return a draft order.");

  const completed = await adminGraphQL<any>(
    `mutation CheckoutDraftOrderComplete($id: ID!, $paymentPending: Boolean) {
      draftOrderComplete(id: $id, paymentPending: $paymentPending) {
        draftOrder {
          order {
            id
            name
            displayFinancialStatus
            totalPriceSet {
              shopMoney { amount currencyCode }
            }
          }
        }
        userErrors { field message }
      }
    }`,
    { id: draft.id, paymentPending: false },
  );

  const completeErrors = completed?.draftOrderComplete?.userErrors || [];
  if (completeErrors.length) {
    throw new Error(
      `Shopify draftOrderComplete: ${completeErrors
        .map((e: any) => `${(e.field || []).join(".")} ${e.message}`.trim())
        .join("; ")}`,
    );
  }

  const order = completed?.draftOrderComplete?.draftOrder?.order;
  if (!order?.id) {
    throw new Error("Shopify did not return an order after draft completion.");
  }

  return {
    orderId: order.id,
    orderName: order.name || draft.name || null,
    financialStatus: order.displayFinancialStatus || null,
    totalAudCents: order.totalPriceSet?.shopMoney?.amount
      ? Math.round(Number(order.totalPriceSet.shopMoney.amount) * 100)
      : null,
  };
}

async function findOrderPaymentTransaction(
  shopifyOrderId: string,
): Promise<{ id: string; gateway: string } | null> {
  const data = await adminGraphQL<any>(
    `query CheckoutOrderTransactions($id: ID!) {
      order(id: $id) {
        transactions(first: 20) {
          edges {
            node { id kind gateway }
          }
        }
      }
    }`,
    { id: shopifyOrderId },
  );
  const nodes =
    data?.order?.transactions?.edges?.map((edge: any) => edge.node) || [];
  const parent =
    nodes.find((node: any) => node.kind === "SALE") ||
    nodes.find((node: any) => node.kind === "CAPTURE") ||
    null;
  if (!parent) return null;
  return {
    id: parent.id,
    gateway: parent.gateway || "stripe",
  };
}

// Order line items with their fulfilable quantity, used to restock on refund.
// refundableQuantity is null-safe: when Shopify omits it, fall back to
// quantity; when it is present but zero, respect zero (already refunded).
function refundableOf(node: any): number {
  if (typeof node?.refundableQuantity === "number") {
    return Math.max(0, node.refundableQuantity);
  }
  return Math.max(0, Number(node?.quantity) || 0);
}

async function findOrderLineItems(
  shopifyOrderId: string,
): Promise<{ id: string; quantity: number }[]> {
  try {
    const data = await adminGraphQL<any>(
      `query CheckoutOrderLineItems($id: ID!) {
        order(id: $id) {
          lineItems(first: 100) {
            edges {
              node {
                id
                quantity
                refundableQuantity
              }
            }
          }
        }
      }`,
      { id: shopifyOrderId },
    );
    return (data?.order?.lineItems?.edges || [])
      .map((edge: any) => edge.node)
      .filter((node: any) => refundableOf(node) > 0)
      .map((node: any) => ({
        id: node.id,
        quantity: refundableOf(node),
      }));
  } catch (err: any) {
    console.error("[checkout] failed to read order line items:", err?.message);
    return [];
  }
}

export async function createShopifyRefund(
  shopifyOrderId: string,
  amountAudCents: number,
  note: string,
  options: { restock?: boolean; locationId?: string | null } = {},
): Promise<string | null> {
  const parent = await findOrderPaymentTransaction(shopifyOrderId);
  const transaction: Record<string, unknown> = {
    orderId: shopifyOrderId,
    kind: "REFUND",
    amount: (amountAudCents / 100).toFixed(2),
    gateway: parent?.gateway || "stripe",
  };
  if (parent?.id) transaction.parentId = parent.id;

  // Returning stock keeps Shopify inventory aligned with real-world stock.
  // Without this, a refunded order leaves phantom committed inventory.
  let refundLineItems: Record<string, unknown>[] | undefined;
  if (options.restock) {
    const lineItems = await findOrderLineItems(shopifyOrderId);
    if (lineItems.length) {
      refundLineItems = lineItems.map((item) => ({
        lineItemId: item.id,
        quantity: item.quantity,
        restockType: "RETURN",
        ...(options.locationId ? { locationId: options.locationId } : {}),
      }));
    }
  }

  const data = await adminGraphQL<any>(
    `mutation CheckoutRefundCreate($input: RefundInput!) {
      refundCreate(input: $input) {
        refund { id }
        userErrors { field message }
      }
    }`,
    {
      input: {
        orderId: shopifyOrderId,
        currency: "AUD",
        note,
        notify: true,
        ...(refundLineItems ? { refundLineItems } : {}),
        transactions: [transaction],
      },
    },
  );

  const errors = data?.refundCreate?.userErrors || [];
  if (errors.length) {
    throw new Error(
      `Shopify refundCreate: ${errors
        .map((e: any) => `${(e.field || []).join(".")} ${e.message}`.trim())
        .join("; ")}`,
    );
  }
  return data?.refundCreate?.refund?.id || null;
}

// ── Order confirmation email ────────────────────────────────────────────────
// draftOrderComplete has no notify argument, so orders created via the Admin
// API never email the customer on their own. orderInvoiceSend sends the order
// confirmation using the store's verified sender email.

export async function sendOrderInvoice(
  shopifyOrderId: string,
  email?: string | null,
): Promise<boolean> {
  const data = await adminGraphQL<any>(
    `mutation CheckoutOrderInvoiceSend($id: ID!, $email: EmailInput) {
      orderInvoiceSend(id: $id, email: $email) {
        order { id }
        userErrors { field message }
      }
    }`,
    {
      id: shopifyOrderId,
      email: email ? { to: email } : undefined,
    },
  );

  const errors = data?.orderInvoiceSend?.userErrors || [];
  if (errors.length) {
    console.error(
      "[checkout] orderInvoiceSend failed:",
      errors
        .map((e: any) => `${(e.field || []).join(".")} ${e.message}`.trim())
        .join("; "),
    );
    return false;
  }
  return true;
}

// ── Customer-facing order status ────────────────────────────────────────────
// Shopify exposes a tokenised status page the customer can open without
// logging in. We surface it as the "Track order" link.

export async function getOrderStatusUrl(
  shopifyOrderId: string,
): Promise<string | null> {
  try {
    const data = await adminGraphQL<any>(
      `query CheckoutOrderStatus($id: ID!) {
        order(id: $id) {
          statusPageUrl
        }
      }`,
      { id: shopifyOrderId },
    );
    return data?.order?.statusPageUrl || null;
  } catch (err: any) {
    console.error("[checkout] failed to read statusPageUrl:", err?.message);
    return null;
  }
}
