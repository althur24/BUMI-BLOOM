// migrate-brands-to-shopify.mjs — Fase 3: pindahkan Brand dari Supabase ke Shopify Metaobject.
// Bikin definition "brand" (storefront PUBLIC_READ) + entries (idempotent: update kalau handle sudah ada).
//
// Jalankan: node backend/scripts/migrate-brands-to-shopify.mjs

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

const SUPABASE_URL = 'https://xugmxibdqiffhklhsawu.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z214aWJkcWlmZmhrbGhzYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzU2NTMsImV4cCI6MjA5OTc1MTY1M30.SRPEk3OlShyuldb7ZcEC5z6StS4yleJ3fQ3yQubdqUg';

const BRAND_TYPE = 'brand';

const FIELD_DEFS = [
  { name: 'Name',     key: 'name',     type: 'single_line_text_field' },
  { name: 'Slug',     key: 'slug',     type: 'single_line_text_field' },
  { name: 'City',     key: 'city',     type: 'single_line_text_field' },
  { name: 'Audience', key: 'audience', type: 'single_line_text_field' },
  { name: 'Website',  key: 'website',  type: 'single_line_text_field' },
  { name: 'Description', key: 'desc',  type: 'single_line_text_field' },
];

async function getToken() {
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
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

async function fetchBrandsFromSupabase() {
  const url = `${SUPABASE_URL}/rest/v1/Brand?select=slug,name,city,audience,website,shortDesc&status=eq.PUBLISHED&order=name`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } });
  if (!res.ok) throw new Error(`Supabase Brand HTTP ${res.status}`);
  return res.json();
}

const CREATE_DEF = `mutation CreateDef($d: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $d) {
    metaobjectDefinition { name type access { admin storefront } }
    userErrors { field message code }
  }
}`;

const LIST_META = `{ metaobjects(type: "${BRAND_TYPE}", first: 50) { edges { node { id handle } } } }`;

const CREATE_OBJ = `mutation CreateObj($m: MetaobjectCreateInput!) {
  metaobjectCreate(metaobject: $m) { metaobject { id handle } userErrors { field message code } }
}`;

const UPDATE_OBJ = `mutation UpdateObj($id: ID!, $m: MetaobjectUpdateInput!) {
  metaobjectUpdate(id: $id, metaobject: $m) { metaobject { id handle } userErrors { field message code } }
}`;

function brandValues(b) {
  return {
    name: b.name || '',
    slug: b.slug || '',
    city: b.city || 'Indonesia',
    audience: (b.audience || '').toLowerCase(),
    website: b.website || '',
    desc: b.shortDesc || '',
  };
}

async function main() {
  const token = await getToken();

  // 1) Definition (idempotent)
  console.log('1) Bikin definition "brand" (storefront PUBLIC_READ)...');
  const defData = await gql(token, CREATE_DEF, {
    d: {
      name: 'Brand',
      type: BRAND_TYPE,
      access: { storefront: 'PUBLIC_READ' }, // access.admin hanya utk type $app-reserved; standard type cukup storefront
      fieldDefinitions: FIELD_DEFS,
    },
  });
  const defErrs = defData.metaobjectDefinitionCreate.userErrors;
  if (defErrs.length && defErrs.some((e) => /already exists|already been created/i.test(e.message))) {
    console.log('   · definition sudah ada, skip.');
  } else if (defErrs.length) {
    console.log('   ✗ error definition:', JSON.stringify(defErrs));
  } else {
    console.log(`   ✓ definition dibuat: type=${defData.metaobjectDefinitionCreate.metaobjectDefinition.type}`);
  }

  // 2) Fetch brands dari Supabase
  console.log('\n2) Ambil brand dari Supabase...');
  const brands = await fetchBrandsFromSupabase();
  console.log(`   ${brands.length} brand: ${brands.map((b) => b.slug).join(', ')}`);

  // 3) List existing metaobjects (handle → id) buat idempotensi
  const existing = await gql(token, LIST_META, {});
  const existingMap = {};
  for (const e of existing.metaobjects.edges) existingMap[e.node.handle] = e.node.id;

  // 4) Create / update tiap brand
  console.log('\n3) Migrasi brand entries...');
  for (const b of brands) {
    const values = brandValues(b);
    const handle = b.slug;
    if (existingMap[handle]) {
      const r = await gql(token, UPDATE_OBJ, { id: existingMap[handle], m: { type: BRAND_TYPE, handle, values } });
      const errs = r.metaobjectUpdate.userErrors;
      if (errs.length) console.log(`   ✗ ${handle} update: ${JSON.stringify(errs)}`);
      else console.log(`   ↻ ${handle}  updated (id ${r.metaobjectUpdate.metaobject.id})`);
    } else {
      const r = await gql(token, CREATE_OBJ, { m: { type: BRAND_TYPE, handle, values } });
      const errs = r.metaobjectCreate.userErrors;
      if (errs.length) console.log(`   ✗ ${handle} create: ${JSON.stringify(errs)}`);
      else console.log(`   ✓ ${handle}  created (id ${r.metaobjectCreate.metaobject.id})`);
    }
  }
  console.log('\nSelesai.');
}

main().catch((e) => { console.error('❌', e.message); process.exitCode = 1; });
