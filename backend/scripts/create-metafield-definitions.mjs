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
  { key: 'colors',           type: 'json',                  name: 'Colors' },
  { key: 'fibre',            type: 'single_line_text_field', name: 'Fibre' },
  { key: 'material',         type: 'single_line_text_field', name: 'Material' },
  { key: 'audience',         type: 'single_line_text_field', name: 'Audience' },
  { key: 'badge',            type: 'single_line_text_field', name: 'Badge' },
  { key: 'is_new',           type: 'boolean',               name: 'Is New' },
  { key: 'is_bestseller',    type: 'boolean',               name: 'Is Bestseller' },
  { key: 'rating',           type: 'number_decimal',        name: 'Rating' },
  { key: 'reviews_count',    type: 'number_integer',        name: 'Reviews Count' },
  { key: 'added_at_rank',    type: 'number_integer',        name: 'Added At Rank' },
  { key: 'size_guide',       type: 'single_line_text_field', name: 'Size Guide' },
  { key: 'size_chart_image', type: 'url',                   name: 'Size Chart Image' },
  { key: 'size_label_mode',  type: 'single_line_text_field', name: 'Size Label Mode' },
  { key: 'shipping_returns', type: 'single_line_text_field', name: 'Shipping & Returns' },
  { key: 'sold_count',       type: 'number_integer',        name: 'Sold Count' },
];

const CREATE = `mutation CreateDef($def: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $def) {
    createdDefinition { id namespace key name }
    userErrors { field message code }
  }
}`;

const LIST = `query Defs($cursor: String) {
  metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "bumi", after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node { id key type access { storefront } } }
  }
}`;

const UPDATE = `mutation UpdateDef($def: MetafieldDefinitionUpdateInput!) {
  metafieldDefinitionUpdate(definition: $def) {
    updatedDefinition { key }
    userErrors { field message code }
  }
}`;

async function listDefs(token) {
  const out = [];
  let cursor = null;
  do {
    const data = await gql(token, LIST, { cursor });
    const conn = data.metafieldDefinitions;
    for (const e of conn.edges) out.push(e.node);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

// Verify what actually exists in the shop: every definition must have the same
// type the code writes (a mismatch makes metafieldsSet reject the whole batch)
// and PUBLIC_READ storefront access (or the storefront cannot read it at all).
// Storefront access is auto-repaired; a wrong type is only reported, because
// changing a definition's type requires deleting it (which deletes its values).
async function verifyDefs(token, current) {
  const byKey = new Map(current.map((d) => [d.key, d]));
  let issues = 0;
  for (const d of DEFS) {
    const found = byKey.get(d.key);
    if (!found) {
      console.log(`  ✗ bumi.${d.key}  HILANG — jalankan ulang script ini`);
      issues++;
      continue;
    }
    if (found.type !== d.type) {
      console.log(`  ⚠ bumi.${d.key}  type=${found.type} (kode menulis ${d.type}) — perlu dibuat ulang manual`);
      issues++;
    }
    if (found.access?.storefront !== 'PUBLIC_READ') {
      const res = await gql(token, UPDATE, {
        def: { id: found.id, access: { storefront: 'PUBLIC_READ' } },
      });
      const errs = res.metafieldDefinitionUpdate?.userErrors || [];
      if (errs.length) {
        console.log(`  ✗ bumi.${d.key}  storefront access gagal diperbaiki: ${JSON.stringify(errs)}`);
        issues++;
      } else {
        console.log(`  ✓ bumi.${d.key}  storefront access diperbaiki → PUBLIC_READ`);
      }
    }
  }
  return issues;
}

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

  console.log('\nVerifikasi definisi:');
  const issues = await verifyDefs(token, await listDefs(token));

  console.log(`\nSelesai: ${ok} baru, ${skipped} sudah ada, dari ${DEFS.length} definition.`);
  if (issues) {
    console.log(`⚠ ${issues} definisi perlu perhatian (lihat di atas). Perbaiki sebelum push produk.`);
    process.exitCode = 1;
  } else {
    console.log('✓ Semua definisi sesuai (tipe + storefront access).');
  }
}

main().catch((e) => { console.error('❌', e.message); process.exitCode = 1; });
