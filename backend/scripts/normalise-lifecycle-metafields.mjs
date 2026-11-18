// normalise-lifecycle-metafields.mjs — make the lifecycle metafields
// (`bumi.is_new`, `bumi.is_bestseller`) consistently BOOLEAN on every product,
// so the admin editor and the import pipeline never fight over their type.
//
// Background: the storefront reads `is_new`/`is_bestseller` to build the New In
// and Bestsellers listings. The defintions and the import pipeline use
// `boolean`, but the admin editor historically wrote `single_line_text_field`.
// Because metafieldsSet rejects a batch when a key's type disagrees with its
// stored value, a mismatched product made the whole editor save fail.
//
//   node backend/scripts/normalise-lifecycle-metafields.mjs          # dry-run
//   node backend/scripts/normalise-lifecycle-metafields.mjs --apply  # write
//
// Safe to re-run: products already boolean (and already carrying both keys) are
// skipped, so a second run is a no-op.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { URLSearchParams } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const APPLY = process.argv.includes('--apply');
const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET (check backend/.env).');
  process.exit(1);
}

async function getToken() {
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function gql(token, query, variables) {
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(j.errors)}`);
  return j.data;
}

const PRODUCTS_QUERY = `query Products($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        handle
        metafields(first: 25, namespace: "bumi") {
          edges { node { id key type value } }
        }
      }
    }
  }
}`;

const SET_METAFIELDS = `mutation SetMeta($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { key }
    userErrors { field message code }
  }
}`;

const LIFECYCLE_KEYS = ['is_new', 'is_bestseller'];

function truthy(value) {
  return /^(true|1|yes)$/i.test(String(value || '').trim());
}

// What each key should be, from the product's badge when the key is missing.
function desiredFromBadge(key, badge) {
  if (key === 'is_new') return badge === 'new';
  if (key === 'is_bestseller') return badge === 'bestseller';
  return false;
}

async function main() {
  const token = await getToken();
  let cursor = null;
  let scanned = 0;
  let changed = 0;

  do {
    const data = await gql(token, PRODUCTS_QUERY, { cursor });
    const conn = data.products;
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;

    for (const edge of conn.edges) {
      const node = edge.node;
      scanned++;
      const byKey = new Map(
        (node.metafields?.edges || []).map((e) => [e.node.key, e.node]),
      );
      const badge = String(byKey.get('badge')?.value || '').toLowerCase();

      const updates = [];
      for (const key of LIFECYCLE_KEYS) {
        const current = byKey.get(key);
        const want = current
          ? current.type !== 'boolean'
            ? truthy(current.value)
            : null // already boolean → nothing to do
          : desiredFromBadge(key, badge)
            ? true
            : null;
        if (want === null) continue;
        updates.push({
          ownerId: node.id,
          namespace: 'bumi',
          key,
          value: want ? 'true' : 'false',
          type: 'boolean',
        });
      }

      if (!updates.length) continue;
      changed++;
      console.log(
        `${APPLY ? 'fix' : 'would fix'} ${node.handle}: ` +
          updates.map((u) => `${u.key}=${u.value}`).join(', '),
      );

      if (APPLY) {
        const res = await gql(token, SET_METAFIELDS, { metafields: updates });
        const errs = res.metafieldsSet?.userErrors || [];
        if (errs.length) {
          console.error(`  ! ${node.handle}: ${errs.map((e) => e.message).join('; ')}`);
        }
      }
    }
  } while (cursor);

  console.log(
    `\n${APPLY ? 'Applied' : 'Dry-run'}: ${changed} product(s) need changes out of ${scanned} scanned.`,
  );
  if (!APPLY && changed) console.log('Re-run with --apply to write the changes.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
