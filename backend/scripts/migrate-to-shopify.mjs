// migrate-to-shopify.mjs — Migrasi katalog Supabase → Shopify.
//
// MODE:
//   node migrate-to-shopify.mjs            → DRY-RUN (baca Supabase + analisis, TIDAK tulis Shopify)
//   node migrate-to-shopify.mjs --live     → LIVE (create/update produk di Shopify + publish)
//
// Sumber data: Supabase (anon key, sama dengan js/supabase.js — publik, read-only via RLS).
// Tujuan: Shopify Admin API via client credentials grant.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

// ── Env: Shopify ────────────────────────────────────────────────────────────
const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';

// ── Env: Supabase (anon, publik — identik dengan js/supabase.js) ────────────
const SUPABASE_URL = 'https://xugmxibdqiffhklhsawu.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z214aWJkcWlmZmhrbGhzYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzU2NTMsImV4cCI6MjA5OTc1MTY1M30.SRPEk3OlShyuldb7ZcEC5z6StS4yleJ3fQ3yQubdqUg';

const DRY_RUN = !process.argv.includes('--live');

// ── Supabase / PostgREST reader ─────────────────────────────────────────────
const PRODUCT_SELECT = [
  'id,slug,name,fibre,material,description,priceAudCents,compareAtAudCents,',
  'badge,isNew,isBestseller,rating,reviewsCount,addedAtRank,audience,category,createdAt,',
  'Brand(id,slug,name)',
].join('');

const BRAND_SELECT = 'id,slug,name,city,audience,website,shortDesc,status';
const COLLECTION_SELECT = 'id,slug,name,kind,description,status,sortOrder'; // tanpa relasi M:N (PostgREST tidak auto-detect join table)

// Relasi child di-fetch top-level lalu dirakit by productId (PostgREST tidak mendeteksi FK child-side
// Product→ProductColor/Variant/Image, walau data ada — terbukti dari query top-level).
const COLOR_SELECT = 'id,productId,name,hex,sortOrder';
const VARIANT_SELECT = 'id,productId,colorId,size,sku,barcode,stock,lowStockThreshold,priceOverrideAudCents,weightGrams';
const IMAGE_SELECT = 'id,productId,sortOrder,isPrimary,altText,MediaAsset(id,publicUrl,bucket)';

async function supabaseGet(table, select, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase GET ${table} failed: HTTP ${res.status}\n${body}`);
  }
  return res.json();
}

async function fetchSource() {
  const [products, brands, colors, variants, images] = await Promise.all([
    supabaseGet('Product', PRODUCT_SELECT, '&status=eq.PUBLISHED'),
    supabaseGet('Brand', BRAND_SELECT, '&status=eq.PUBLISHED&order=name'),
    supabaseGet('ProductColor', COLOR_SELECT, '&limit=1000'),
    supabaseGet('ProductVariant', VARIANT_SELECT, '&limit=1000'),
    supabaseGet('ProductImage', IMAGE_SELECT, '&limit=1000'),
  ]);

  // Rakit relasi ke produk by productId.
  const colorsByProduct = groupBy(colors, 'productId');
  const variantsByProduct = groupBy(variants, 'productId');
  const imagesByProduct = groupBy(images, 'productId');
  for (const p of products) {
    p.ProductColor = (colorsByProduct[p.id] || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    p.ProductVariant = (variantsByProduct[p.id] || []);
    p.ProductImage = (imagesByProduct[p.id] || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  // Collections: non-fatal (M:N relation tidak ter-detect PostgREST; koleksi Shopify akan jadi smart collection dari field produk).
  let collections = [];
  try {
    collections = await supabaseGet('Collection', COLLECTION_SELECT, '&status=eq.PUBLISHED&order=sortOrder');
  } catch (e) {
    console.warn(`⚠ Collection fetch dilewati: ${e.message.split('\n')[0]}`);
  }
  return { products, brands, collections };
}

function groupBy(arr, key) {
  const m = {};
  for (const r of arr) { (m[r[key]] ||= []).push(r); }
  return m;
}

// ── Dry-run analysis ────────────────────────────────────────────────────────
function isAbsoluteUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function dryRun({ products, brands, collections }) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' DRY-RUN — analisis sumber Supabase (tidak ada tulisan ke Shopify)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Brands      : ${brands.length}`);
  brands.forEach((b) => console.log(`   - ${b.slug}  →  ${b.name}  [${b.audience}]`));

  console.log(`\nProducts    : ${products.length}`);
  console.log(`Collections : ${collections.length}\n`);

  // ── Image URL analysis ──
  const imageUrls = new Set();
  let primaryCount = 0;
  let totalImages = 0;
  for (const p of products) {
    for (const img of p.ProductImage || []) {
      const url = img.MediaAsset && img.MediaAsset.publicUrl;
      if (url) { imageUrls.add(url); totalImages++; }
      if (img.isPrimary) primaryCount++;
    }
  }
  const absolute = [...imageUrls].filter(isAbsoluteUrl);
  const relative = [...imageUrls].filter((u) => !isAbsoluteUrl(u));
  console.log('── Gambar ──');
  console.log(`Total ProductImage rows : ${totalImages}`);
  console.log(`Gambar bertanda primary : ${primaryCount}`);
  console.log(`URL unik               : ${imageUrls.size}`);
  console.log(`  ✓ URL absolut (siap dipakai Shopify) : ${absolute.length}`);
  console.log(`  ✗ URL relatif/pecah                   : ${relative.length}`);
  if (relative.length) {
    console.log('  Contoh URL relatif:');
    relative.slice(0, 8).forEach((u) => console.log(`     ${u}`));
  }
  if (absolute.length) {
    console.log('  Contoh URL absolut:');
    absolute.slice(0, 4).forEach((u) => console.log(`     ${u}`));
  }

  // ── Variant analysis ──
  let totalVariants = 0;
  let variantsWithColorId = 0;
  let variantsWithSku = 0;
  let stockValues = [];
  for (const p of products) {
    for (const v of p.ProductVariant || []) {
      totalVariants++;
      if (v.colorId != null) variantsWithColorId++;
      if (v.sku) variantsWithSku++;
      if (typeof v.stock === 'number') stockValues.push(v.stock);
    }
  }
  console.log('\n── Varian ──');
  console.log(`Total ProductVariant rows : ${totalVariants}`);
  console.log(`Varian dengan colorId     : ${variantsWithColorId}  (jika 0 → varian size-only, perlu cartesian)`);
  console.log(`Varian dengan sku         : ${variantsWithSku}`);
  if (stockValues.length) {
    const uniq = [...new Set(stockValues)];
    console.log(`Nilai stock unik          : ${uniq.join(', ')}`);
  }

  // ── Per-product summary ──
  console.log('\n── Ringkasan per produk ──');
  for (const p of products) {
    const colors = (p.ProductColor || []).map((c) => c.name).join('|') || '(none)';
    const sizes = [...new Set((p.ProductVariant || []).map((v) => v.size).filter(Boolean))].join(',');
    const imgs = (p.ProductImage || []).length;
    const price = (p.priceAudCents / 100).toFixed(2);
    const compareAt = p.compareAtAudCents ? ` (was ${(p.compareAtAudCents / 100).toFixed(2)})` : '';
    console.log(
      `  ${p.slug.padEnd(34)} ${String(p.name).padEnd(38)} $${price}${compareAt}  `
      + `[${p.audience}/${p.category}] colors=${colors} sizes=${sizes || '-'} imgs=${imgs} variants=${(p.ProductVariant || []).length}`
    );
  }

  // ── Collections ──
  console.log('\n── Koleksi ──');
  for (const c of collections) {
    const n = (c.products || []).length;
    console.log(`  ${c.slug.padEnd(20)} ${c.name}  (${n} produk)`);
  }

  // ── Sample product (full) ──
  if (products[0]) {
    console.log('\n── Sample produk (struktur lengkap, produk pertama) ──');
    console.log(JSON.stringify(products[0], null, 2));
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Dry-run selesai. Tinjau di atas sebelum --live.');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// ── Shopify Admin helpers ───────────────────────────────────────────────────
let _adminToken = null;
let _adminTokenExp = 0;

async function getAdminToken() {
  if (_adminToken && Date.now() < _adminTokenExp - 60_000) return _adminToken;
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Admin token gagal: HTTP ${res.status} ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  _adminToken = access_token;
  _adminTokenExp = Date.now() + expires_in * 1000;
  return _adminToken;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adminRest(method, path, body) {
  const token = await getAdminToken();
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const callLimit = res.headers.get('x-shopify-shop-api-call-limit');
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.errors ? JSON.stringify(json.errors) : text.slice(0, 300);
    throw new Error(`REST ${method} ${path} → HTTP ${res.status}: ${msg}`);
  }
  if (callLimit) {
    const [used, bucket] = callLimit.split('/').map(Number);
    if (bucket - used < 5) await sleep(500); // hormati rate limit (leaky bucket)
  }
  return json;
}

async function adminGraphQL(query, variables) {
  const token = await getAdminToken();
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// ── Build Shopify product payload dari Supabase product ────────────────────
function buildShopifyProduct(p) {
  const colorById = {};
  for (const c of p.ProductColor || []) colorById[c.id] = c.name;
  const colorNames = (p.ProductColor || []).map((c) => c.name);
  const sizeNames = [...new Set((p.ProductVariant || []).map((v) => v.size).filter(Boolean))];

  const variants = (p.ProductVariant || []).map((v) => {
    const priceCents = v.priceOverrideAudCents != null ? v.priceOverrideAudCents : p.priceAudCents;
    const variant = {
      option1: colorById[v.colorId] || 'Default',
      option2: v.size,
      price: (priceCents / 100).toFixed(2),
      inventory_management: 'shopify',
      inventory_quantity: typeof v.stock === 'number' ? v.stock : 0,
    };
    if (v.sku) variant.sku = v.sku;
    if (p.compareAtAudCents) variant.compare_at_price = (p.compareAtAudCents / 100).toFixed(2);
    if (v.barcode) variant.barcode = v.barcode;
    if (v.weightGrams) { variant.weight = v.weightGrams; variant.weight_unit = 'g'; }
    return variant;
  });

  // Gambar: isPrimary duluan, lalu sisanya by sortOrder.
  const images = (p.ProductImage || [])
    .slice()
    .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((img) => ({ src: img.MediaAsset && img.MediaAsset.publicUrl }))
    .filter((i) => i.src);

  const tags = [
    (p.audience || '').toLowerCase(),
    p.badge ? String(p.badge).toLowerCase() : null,
    p.isNew ? 'new' : null,
    p.isBestseller ? 'bestseller' : null,
  ].filter(Boolean).join(', ');

  const desc = (p.description || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  return {
    title: p.name,
    handle: p.slug,
    body_html: `<p>${desc}</p>`,
    vendor: (p.Brand && p.Brand.name) || '',
    product_type: (p.category || '').toLowerCase(),
    tags,
    status: 'active',
    options: [
      { name: 'Color', values: colorNames.length ? colorNames : ['Default'] },
      { name: 'Size', values: sizeNames.length ? sizeNames : ['Default'] },
    ],
    variants,
    images,
  };
}

// ── Metafields (preserve bentuk BumiData untuk Fase 2) ─────────────────────
function buildMetafields(p, ownerId) {
  const colors = (p.ProductColor || []).map((c) => ({ name: c.name, hex: c.hex || '#cccccc' }));
  const base = [
    { key: 'colors', value: JSON.stringify(colors), type: 'json' },
    { key: 'fibre', value: p.fibre || '', type: 'single_line_text_field' },
    { key: 'material', value: p.material || '', type: 'single_line_text_field' },
    { key: 'audience', value: (p.audience || '').toLowerCase(), type: 'single_line_text_field' },
    { key: 'badge', value: p.badge ? String(p.badge).toLowerCase() : '', type: 'single_line_text_field' },
    { key: 'is_new', value: p.isNew ? 'true' : 'false', type: 'boolean' },
    { key: 'is_bestseller', value: p.isBestseller ? 'true' : 'false', type: 'boolean' },
    { key: 'rating', value: String(p.rating || 0), type: 'number_decimal' },
    { key: 'reviews_count', value: String(p.reviewsCount || 0), type: 'number_integer' },
    { key: 'added_at_rank', value: String(p.addedAtRank ?? 0), type: 'number_integer' },
  ];
  return base
    .map((m) => ({ ownerId, namespace: 'bumi', ...m }))
    .filter((m) => !(m.type === 'single_line_text_field' && m.value === '')); // skip text kosong (mis. badge null) — definition menolak blank
}

// ── Headless publication ────────────────────────────────────────────────────
async function findHeadlessPublicationId() {
  const data = await adminGraphQL(
    `{ publications(first: 30) { edges { node { id name app { title } } } } }`
  );
  const pubs = data.publications.edges.map((e) => e.node);
  const headless = pubs.find((n) =>
    /headless/i.test(n.name) || /headless/i.test(n.app?.title || '')
  );
  if (!headless) {
    console.error('✗ Channel "Headless" tidak ditemukan. Daftar publication:');
    pubs.forEach((n) => console.error(`   - ${n.id}  name="${n.name}"  app="${n.app?.title}"`));
    throw new Error('Headless publication tidak ditemukan — pastikan channel Headless ter-install & storefront dibuat.');
  }
  console.log(`Headless publication: ${headless.id} (${headless.name})\n`);
  return headless.id;
}

async function publishToHeadless(productId, publicationId) {
  const gid = `gid://shopify/Product/${productId}`;
  await adminGraphQL(
    `mutation Publish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable { resourcePublicationsCount { count } }
        userErrors { field message }
      }
    }`,
    { id: gid, input: { publicationId } }
  );
}

// ── Migrate one product ─────────────────────────────────────────────────────
async function migrateProduct(p, publicationId) {
  const handle = p.slug;

  // Idempotensi: cek by handle. Kalau sudah ada → delete lalu recreate (bersih, store masih kosong).
  const existing = await adminRest('GET', `/products.json?handle=${encodeURIComponent(handle)}&limit=1`);
  if (existing.products && existing.products.length) {
    const oldId = existing.products[0].id;
    await adminRest('DELETE', `/products/${oldId}.json`);
    console.log(`   ↻ produk lama (id ${oldId}) dihapus, recreate.`);
  }

  // Create
  const created = await adminRest('POST', '/products.json', { product: buildShopifyProduct(p) });
  if (!created.product) throw new Error('product create tidak mengembalikan objek produk');
  const productId = created.product.id;
  const variantCount = (created.product.variants || []).length;
  const imageCount = (created.product.images || []).length;
  console.log(`   ✓ created id=${productId}  variants=${variantCount}  images=${imageCount}`);

  // Metafields (1 call via GraphQL metafieldsSet — ownerId per item)
  const ownerId = `gid://shopify/Product/${productId}`;
  await adminGraphQL(
    `mutation SetMeta($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { namespace key }
        userErrors { field message }
      }
    }`,
    { metafields: buildMetafields(p, ownerId) }
  );

  // Publish ke Headless
  await publishToHeadless(productId, publicationId);
  console.log(`   ✓ published to Headless`);

  return { productId, variantCount, imageCount };
}

// ── Re-set metafields only (tanpa recreate produk) ─────────────────────────
// Dipakai setelah create-metafield-definitions.mjs, agar metafield terstruktur
// & terbaca Storefront API. Cek userErrors per metafield.
async function remetafield(source) {
  const products = source.products;
  console.log(`\nRE-METAFIELDS — ${products.length} produk\n`);
  let okCount = 0, errCount = 0;
  for (const p of products) {
    const ex = await adminRest('GET', `/products.json?handle=${encodeURIComponent(p.slug)}&limit=1`);
    if (!ex.products || !ex.products.length) {
      console.log(`✗ ${p.slug}: tidak ditemukan di Shopify, skip`);
      continue;
    }
    const productId = ex.products[0].id;
    const ownerId = `gid://shopify/Product/${productId}`;
    const data = await adminGraphQL(
      `mutation SetMeta($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { namespace key }
          userErrors { field message code }
        }
      }`,
      { metafields: buildMetafields(p, ownerId) }
    );
    const errs = data.metafieldsSet.userErrors;
    if (errs.length) {
      errCount++;
      console.log(`✗ ${p.slug}: ${errs.length} error`);
      errs.forEach((e) => console.log(`     ${e.field.join('.')}: ${e.message}`));
    } else {
      okCount++;
      console.log(`✓ ${p.slug}: metafields OK`);
    }
    await sleep(250);
  }
  console.log(`\nSelesai: ${okCount} OK, ${errCount} dengan error.\n`);
}

// ── Live migration ──────────────────────────────────────────────────────────
async function live(source) {
  let products = source.products;
  if (process.env.MIGRATE_ONLY) {
    products = products.filter((p) => p.slug === process.env.MIGRATE_ONLY);
  }
  const limitIdx = process.argv.indexOf('--limit');
  if (limitIdx >= 0) {
    const n = parseInt(process.argv[limitIdx + 1], 10);
    if (n > 0) products = products.slice(0, n);
  }
  const onlyIdx = process.argv.indexOf('--only');
  if (onlyIdx >= 0) {
    const slug = process.argv[onlyIdx + 1];
    products = products.filter((p) => p.slug === slug);
  }

  console.log(`\nLIVE migration — ${products.length} produk\n`);
  const publicationId = await findHeadlessPublicationId();

  const ok = [];
  const failed = [];
  for (const p of products) {
    console.log(`• ${p.slug}  (${p.name})`);
    try {
      const r = await migrateProduct(p, publicationId);
      ok.push({ slug: p.slug, ...r });
    } catch (e) {
      console.error(`   ✗ GAGAL: ${e.message}`);
      failed.push({ slug: p.slug, error: e.message });
    }
    await sleep(300);
  }

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(` Selesai: ${ok.length} sukses, ${failed.length} gagal dari ${products.length} produk.`);
  if (failed.length) {
    console.log(' Gagal:');
    failed.forEach((f) => console.log(`   - ${f.slug}: ${f.error}`));
  }
  console.log(`═══════════════════════════════════════════════════════════════\n`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
    console.error('Missing SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET di backend/.env');
    process.exit(1);
  }

  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Shop: ${SHOP}.myshopify.com | API: ${API_VERSION}`);
  console.log('Mengambil data dari Supabase...\n');
  const source = await fetchSource();

  if (DRY_RUN) {
    dryRun(source);
    return;
  }

  if (process.argv.includes('--metafields-only')) {
    await remetafield(source);
    return;
  }

  await live(source);
}

main().catch((e) => {
  console.error('\n❌ GAGAL:\n' + (e.stack || e.message));
  process.exitCode = 1;
});
