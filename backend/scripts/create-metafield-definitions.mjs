// create-metafield-definitions.mjs — bikin metafield definitions namespace "bumi"
// dengan akses Storefront PUBLIC, agar metafield terbaca via Storefront API.
// Aman di-rerun (definition yang sudah ada akan di-skip / error "already exists" diabaikan).
//
// Jalankan: node backend/scripts/create-metafield-definitions.mjs

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { URLSearchParams } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';

async function getToken() {
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  const j = await res.json();
  return j.access_token;
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

const DEFS = [
  { key: 'colors',         type: 'json',                  name: 'Colors' },
  { key: 'fibre',          type: 'single_line_text_field', name: 'Fibre' },
  { key: 'material',       type: 'single_line_text_field', name: 'Material' },
  { key: 'audience',       type: 'single_line_text_field', name: 'Audience' },
  { key: 'badge',          type: 'single_line_text_field', name: 'Badge' },
  { key: 'is_new',         type: 'boolean',               name: 'Is New' },
  { key: 'is_bestseller',  type: 'boolean',               name: 'Is Bestseller' },
  { key: 'rating',         type: 'number_decimal',        name: 'Rating' },
  { key: 'reviews_count',  type: 'number_integer',        name: 'Reviews Count' },
  { key: 'added_at_rank',  type: 'number_integer',        name: 'Added At Rank' },
];

const CREATE = `mutation CreateDef($def: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $def) {
    createdDefinition { id namespace key name }
    userErrors { field message code }
  }
}`;

async function main() {
  const token = await getToken();
  let ok = 0, skipped = 0;
  for (const d of DEFS) {
    const data = await gql(token, CREATE, {
      def: { name: d.name, namespace: 'bumi', key: d.key, type: d.type, ownerType: 'PRODUCT', access: { storefront: 'PUBLIC_READ' } },
    });
    const errs = data.metafieldDefinitionCreate.userErrors;
    if (errs.length && errs.some((e) => /already exists|already been created/i.test(e.message))) {
      console.log(`  · bumi.${d.key}  (sudah ada, skip)`);
      skipped++;
    } else if (errs.length) {
      console.log(`  ✗ bumi.${d.key}  ERROR: ${JSON.stringify(errs)}`);
    } else {
      console.log(`  ✓ bumi.${d.key}  [${d.type}]  storefront=PUBLIC`);
      ok++;
    }
  }
  console.log(`\nSelesai: ${ok} baru, ${skipped} sudah ada, dari ${DEFS.length} definition.`);
}

main().catch((e) => { console.error('❌', e.message); process.exitCode = 1; });
