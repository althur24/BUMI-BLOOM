// fix-size-labels.mjs — rewrite size option values to canonical English labels
// (Indonesian tokens, "1 Years", bare height codes → "S (1–2 yrs)" / "100 cm
// (3–4 yrs)") on existing Shopify products, and set bumi.size_label_mode.
//
//   node backend/scripts/fix-size-labels.mjs            # dry-run (default)
//   node backend/scripts/fix-size-labels.mjs --apply    # write changes
//
// Safe to re-run: labels whose English form equals the source (e.g. "S", "XL")
// are skipped, and a second run is a no-op. Size chart images / metafields are
// never touched.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { URLSearchParams } from 'node:url';
import { translateSizeLabel } from './lib/size-labels.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const APPLY = process.argv.includes('--apply');
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
        options { name optionValues { name } }
        variants(first: 100) {
          edges { node { id selectedOptions { name value } } }
        }
      }
    }
  }
}`;

const UPDATE_VARIANTS = `mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id }
    userErrors { field message }
  }
}`;

const SET_METAFIELD = `mutation SetMode($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { metafields { key } userErrors { field message } }
}`;

function sizeOptionName(options) {
  for (const o of options || []) if (/^(size|ukuran)$/i.test(o.name)) return o.name;
  return null;
}

async function main() {
  if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('SHOPIFY_SHOP / CLIENT_ID / CLIENT_SECRET belum di-set (cek backend/.env)');
  }
  const token = await getToken();
  console.log(`Mode: ${APPLY ? 'APPLY (menulis)' : 'DRY-RUN (tidak menulis)'}\n`);

  let cursor = null;
  let scanned = 0, changed = 0, skipped = 0, failed = 0;

  do {
    const data = await gql(token, PRODUCTS_QUERY, { cursor });
    const conn = data.products;
    for (const { node } of conn.edges) {
      scanned++;
      const optName = sizeOptionName(node.options);
      if (!optName) { skipped++; continue; }

      // Collect raw size values whose English form differs (Indonesian tokens,
      // "1 Years", bare height codes like "100", …). Letter sizes ("S", "XL")
      // translate to themselves and are skipped naturally.
      const rawValues = new Set();
      for (const ve of node.variants.edges) {
        const so = ve.node.selectedOptions.find((o) => o.name === optName);
        if (!so || !so.value) continue;
        if (translateSizeLabel(so.value) === so.value) continue;
        rawValues.add(so.value);
      }
      if (!rawValues.size) { skipped++; continue; }

      // Build raw→English map and detect collisions.
      const map = new Map();
      const used = new Set();
      let collision = false;
      for (const raw of rawValues) {
        let label = translateSizeLabel(raw);
        if (!label) continue;
        if (used.has(label)) { collision = true; break; }
        used.add(label);
        map.set(raw, label);
      }
      if (collision) {
        console.error(`!! ${node.handle}: bentrok label, dilewati demi keamanan (${[...rawValues].join(' | ')})`);
        failed++;
        continue;
      }

      const variantUpdates = [];
      for (const ve of node.variants.edges) {
        const so = ve.node.selectedOptions.find((o) => o.name === optName);
        if (!so) continue;
        const next = map.get(so.value);
        if (!next || next === so.value) continue;
        variantUpdates.push({
          id: ve.node.id,
          optionValues: [{ optionName: optName, name: next }],
        });
      }

      console.log(`• ${node.handle} [${optName}]`);
      for (const [raw, next] of map) console.log(`    ${JSON.stringify(raw)} → ${JSON.stringify(next)}`);

      if (APPLY && variantUpdates.length) {
        try {
          const res = await gql(token, UPDATE_VARIANTS, { productId: node.id, variants: variantUpdates });
          const errs = res.productVariantsBulkUpdate.userErrors || [];
          if (errs.length) throw new Error(JSON.stringify(errs));
          // Ensure the display mode is explicit (age by default).
          const modeRes = await gql(token, SET_METAFIELD, {
            metafields: [{ ownerId: node.id, namespace: 'bumi', key: 'size_label_mode', value: 'age', type: 'single_line_text_field' }],
          });
          const merr = modeRes.metafieldsSet.userErrors || [];
          if (merr.length) console.error(`    ! set mode: ${JSON.stringify(merr)}`);
          changed++;
        } catch (e) {
          console.error(`    ✗ gagal: ${e.message}`);
          failed++;
        }
      } else {
        changed++;
      }
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);

  console.log(`\nSelesai. Dipindai: ${scanned} · ${APPLY ? 'diubah' : 'akan diubah'}: ${changed} · dilewati: ${skipped} · gagal: ${failed}`);
  if (!APPLY && changed) console.log('Jalankan ulang dengan --apply untuk menulis.');
}

main().catch((e) => { console.error(e); process.exit(1); });
