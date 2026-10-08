// BUMI / BLOOM — Shopify Admin API transport.
// Ported from backend/scripts/migrate-to-shopify.mjs (client credentials grant,
// token caching, leaky-bucket rate-limit respect). Server-only — secrets in env.

const SHOP = () => process.env.SHOPIFY_SHOP!;
const CLIENT_ID = () => process.env.SHOPIFY_CLIENT_ID!;
const CLIENT_SECRET = () => process.env.SHOPIFY_CLIENT_SECRET!;
const API_VERSION = () => process.env.SHOPIFY_API_VERSION || "2026-10";

function requireEnv(): void {
  if (!SHOP() || !CLIENT_ID() || !CLIENT_SECRET()) {
    throw new Error(
      "Shopify Admin env missing: SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET",
    );
  }
}

// ── Admin token (client credentials grant, cached + auto-refresh) ───────────
let _adminToken: string | null = null;
let _adminTokenExp = 0;

export async function getAdminToken(): Promise<string> {
  requireEnv();
  if (_adminToken && Date.now() < _adminTokenExp - 60_000) return _adminToken;
  const res = await fetch(`https://${SHOP()}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
    }),
  });
  if (!res.ok) throw new Error(`Admin token gagal: HTTP ${res.status} ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  _adminToken = access_token;
  _adminTokenExp = Date.now() + expires_in * 1000;
  return _adminToken;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── REST (used for product create/delete — JSON bodies are simpler) ─────────
export async function adminRest<T = any>(
  method: string,
  path: string,
  body?: any,
): Promise<T> {
  const token = await getAdminToken();
  const res = await fetch(
    `https://${SHOP()}.myshopify.com/admin/api/${API_VERSION()}${path}`,
    {
      method,
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const callLimit = res.headers.get("x-shopify-shop-api-call-limit");
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const msg = json?.errors ? JSON.stringify(json.errors) : text.slice(0, 300);
    throw new Error(`REST ${method} ${path} → HTTP ${res.status}: ${msg}`);
  }
  // Respect Shopify leaky-bucket rate limit.
  if (callLimit) {
    const [used, bucket] = callLimit.split("/").map(Number);
    if (bucket - used < 5) await sleep(500);
  }
  return json as T;
}

// ── GraphQL (used for metafields + publications) ────────────────────────────
export async function adminGraphQL<T = any>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await getAdminToken();
  const res = await fetch(
    `https://${SHOP()}.myshopify.com/admin/api/${API_VERSION()}/graphql.json`,
    {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length)
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

// ── Headless publication (so products appear on the storefront channel) ─────
export async function findHeadlessPublicationId(): Promise<string> {
  const data = await adminGraphQL<{ publications: { edges: { node: { id: string; name: string; app?: { title?: string } } }[] } }>(
    `{ publications(first: 30) { edges { node { id name app { title } } } } }`,
  );
  const pubs = data.publications.edges.map((e) => e.node);
  const headless = pubs.find(
    (n) => /headless/i.test(n.name) || /headless/i.test(n.app?.title || ""),
  );
  if (!headless) {
    throw new Error(
      'Channel "Headless" tidak ditemukan. Pastikan channel Headless ter-install.',
    );
  }
  return headless.id;
}

export async function publishToHeadless(
  productId: number | string,
  publicationId: string,
): Promise<void> {
  const gid = `gid://shopify/Product/${productId}`;
  await adminGraphQL(
    `mutation Publish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable { resourcePublicationsCount { count } }
        userErrors { field message }
      }
    }`,
    { id: gid, input: [{ publicationId }] },
  );
}

// ── Product CRUD helpers ────────────────────────────────────────────────────
// `payload` = Shopify REST product object ({ title, handle, body_html, variants, images, ... }).

export async function findProductByHandle(handle: string): Promise<{ id: number } | null> {
  const res = await adminRest<any>(
    "GET",
    `/products.json?handle=${encodeURIComponent(handle)}&limit=1`,
  );
  const list = res?.products;
  return list && list.length ? { id: list[0].id } : null;
}

export async function createProduct(payload: Record<string, unknown>): Promise<{
  id: number;
  variants: any[];
  images: any[];
}> {
  const res = await adminRest<any>("POST", "/products.json", { product: payload });
  if (!res?.product) throw new Error("Shopify product create tidak mengembalikan objek produk");
  return {
    id: res.product.id,
    variants: res.product.variants || [],
    images: res.product.images || [],
  };
}

export async function deleteProduct(id: number | string): Promise<void> {
  await adminRest("DELETE", `/products/${id}.json`);
}

export async function setMetafields(
  ownerId: string,
  metafields: { namespace: string; key: string; value: string; type: string }[],
): Promise<void> {
  await adminGraphQL(
    `mutation SetMeta($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { namespace key }
        userErrors { field message }
      }
    }`,
    { metafields: metafields.map((m) => ({ ownerId, ...m })) },
  );
}

// Full import push: create (+ idempotent replace by handle) → metafields → publish.
export async function pushProductToShopify(input: {
  handle: string;
  productPayload: Record<string, unknown>;
  metafields?: { namespace: string; key: string; value: string; type: string }[];
  publicationId?: string;
}): Promise<{ productId: number; shopifyAdminUrl: string }> {
  const publicationId = input.publicationId ?? (await findHeadlessPublicationId());

  // Idempotency: replace existing product with same handle.
  const existing = await findProductByHandle(input.handle);
  if (existing) {
    await deleteProduct(existing.id);
  }

  const created = await createProduct(input.productPayload);
  const ownerId = `gid://shopify/Product/${created.id}`;

  if (input.metafields?.length) {
    await setMetafields(ownerId, input.metafields);
  }

  await publishToHeadless(created.id, publicationId);

  return {
    productId: created.id,
    shopifyAdminUrl: `https://${SHOP()}.myshopify.com/admin/products/${created.id}`,
  };
}
