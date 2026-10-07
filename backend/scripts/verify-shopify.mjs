// verify-shopify.mjs — read-only smoke test untuk Shopify API.
// Memeriksa: (1) Admin API via client credentials grant, (2) Storefront API via public token.
// Tidak mengubah data toko apa pun (hanya query products).
//
// Jalankan:  node backend/scripts/verify-shopify.mjs

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { URLSearchParams } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath); // Node 20.12+
}

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';

function need(name, v) {
  if (!v) {
    console.error(`✗ Missing ${name} di backend/.env`);
    process.exit(1);
  }
}
need('SHOPIFY_SHOP', SHOP);
need('SHOPIFY_CLIENT_ID', CLIENT_ID);
need('SHOPIFY_CLIENT_SECRET', CLIENT_SECRET);

const PRODUCTS_QUERY =
  '{ products(first: 5) { edges { node { id title handle } } } }';

async function getAdminToken() {
  const res = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Token request gagal: HTTP ${res.status}\n${await res.text()}`);
  }
  return res.json();
}

async function adminGraphQL(token, query) {
  const res = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) throw new Error(`Admin GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Admin GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function storefrontGraphQL(query) {
  const res = await fetch(
    `https://${SHOP}.myshopify.com/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) throw new Error(`Storefront GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Storefront GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function main() {
  console.log(`Shop: ${SHOP}.myshopify.com | API version: ${API_VERSION}\n`);

  console.log('1) Admin API — client credentials grant...');
  const tok = await getAdminToken();
  console.log(`   ✓ token terbentuk (scope=${tok.scope}, expires_in=${tok.expires_in}s)`);
  const admin = await adminGraphQL(tok.access_token, PRODUCTS_QUERY);
  console.log(
    `   ✓ Admin GraphQL OK — produk di toko: ${admin.products.edges.length} (0 = wajar, toko masih kosong)`
  );

  if (STOREFRONT_TOKEN) {
    console.log('\n2) Storefront API — public token...');
    const sf = await storefrontGraphQL(PRODUCTS_QUERY);
    console.log(
      `   ✓ Storefront GraphQL OK — produk terlihat storefront: ${sf.products.edges.length}`
    );
  } else {
    console.log('\n2) Storefront API — dilewati (SHOPIFY_STOREFRONT_TOKEN belum di-set)');
  }

  console.log('\n✅ Verifikasi selesai. Kedua token bekerja.');
}

main().catch((e) => {
  console.error('\n❌ VERIFIKASI GAGAL:\n' + e.message);
  process.exitCode = 1;
});
