// migrate-promos-to-shopify.mjs — Fase 6: promo Supabase → Shopify discount codes.
// Bikin PriceRule + DiscountCode (REST Admin API) untuk tiap promo aktif.
// Idempotent: kalau discount code sudah ada (lookup), skip.
//
// Jalankan: node backend/scripts/migrate-promos-to-shopify.mjs

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

let _token = null, _exp = 0;
async function getToken() {
  if (_token && Date.now() < _exp - 60000) return _token;
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  const j = await res.json();
  _token = j.access_token; _exp = Date.now() + j.expires_in * 1000;
  return _token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adminRest(method, p, body) {
  const token = await getToken();
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}${p}`, {
    method,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  const limit = res.headers.get('x-shopify-shop-api-call-limit');
  if (limit) { const [u, b] = limit.split('/').map(Number); if (b - u < 5) await sleep(500); }
  return { ok: res.ok, status: res.status, json };
}

async function fetchPromos() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/Promotion?select=code,label,type,value,startsAt,endsAt,isActive&isActive=eq.true&order=code`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (!res.ok) throw new Error(`Supabase Promotion HTTP ${res.status}`);
  return res.json();
}

// Cek apakah discount code sudah ada (lookup by code).
async function findDiscountCode(code) {
  const r = await adminRest('GET', `/discount_codes/lookup.json?code=${encodeURIComponent(code)}`);
  if (r.ok && r.json && r.json.discount_code) return r.json.discount_code;
  return null; // 404 / not found
}

function priceRuleInput(p) {
  if (p.type === 'FIXED_AMOUNT') {
    // value di Supabase = AUD cents → Shopify fixed_amount value = -(dollars)
    return {
      title: p.code,
      target_type: 'line_item', target_selection: 'all', allocation_method: 'across',
      value_type: 'fixed_amount', value: '-' + ((p.value || 0) / 100).toFixed(2),
      customer_selection: 'all', starts_at: p.startsAt || new Date().toISOString(),
      ends_at: p.endsAt || null,
    };
  }
  // PERCENTAGE: value di Supabase = rate (0.10) → Shopify percentage value = -(rate*100)
  return {
    title: p.code,
    target_type: 'line_item', target_selection: 'all', allocation_method: 'across',
    value_type: 'percentage', value: '-' + Math.round((p.value || 0) * 100),
    customer_selection: 'all', starts_at: p.startsAt || new Date().toISOString(),
    ends_at: p.endsAt || null,
  };
}

async function main() {
  const promos = await fetchPromos();
  console.log(`Promo aktif di Supabase: ${promos.length}\n`);
  for (const p of promos) {
    const code = String(p.code || '').toUpperCase();
    console.log(`• ${code}  [${p.type}=${p.value}]  "${p.label}"`);
    const existing = await findDiscountCode(code);
    if (existing) { console.log(`   · sudah ada di Shopify (id ${existing.id}), skip.\n`); continue; }
    // 1) Price rule
    const pr = await adminRest('POST', '/price_rules.json', { price_rule: priceRuleInput(p) });
    if (!pr.ok || !pr.json || !pr.json.price_rule) {
      console.log(`   ✗ gagal bikin price_rule: HTTP ${pr.status} ${JSON.stringify(pr.json)}\n`); continue;
    }
    const ruleId = pr.json.price_rule.id;
    console.log(`   ✓ price_rule ${ruleId} (${priceRuleInput(p).value_type} ${priceRuleInput(p).value})`);
    // 2) Discount code
    const dc = await adminRest('POST', `/price_rules/${ruleId}/discount_codes.json`, { discount_code: { code } });
    if (!dc.ok || !dc.json || !dc.json.discount_code) {
      console.log(`   ✗ gagal bikin discount_code: HTTP ${dc.status} ${JSON.stringify(dc.json)}\n`); continue;
    }
    console.log(`   ✓ discount_code "${code}" (id ${dc.json.discount_code.id})\n`);
    await sleep(300);
  }
  console.log('Selesai.');
}

main().catch((e) => { console.error('❌', e.message); process.exitCode = 1; });
