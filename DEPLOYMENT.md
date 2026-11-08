# Deployment Guide — Admin (Railway) + Storefront (Vercel)

Panduan ini untuk deploy production:

- **Storefront**: Vercel → `www.bumibloom.com`
- **Admin**: Railway → `admin.bumibloom.com`

---

## 1. Deploy Admin ke Railway

### 1.1 Buat project baru di Railway

1. Buka [railway.app](https://railway.app)
2. New Project → **Deploy from GitHub repo**
3. Pilih repo Bumi Bloom
4. Root Directory: `/` (repo root, bukan `apps/admin`)
5. Railway akan deteksi `railway.json` + `Dockerfile`

### 1.2 Set Environment Variables

Di Railway → project → Variables, set:

```env
# Shopify Admin API
SHOPIFY_SHOP=p9gcf7-wj
SHOPIFY_CLIENT_ID=<isi dari .env.local>
SHOPIFY_CLIENT_SECRET=<isi dari .env.local>
SHOPIFY_API_VERSION=2026-10
SHOPIFY_STOREFRONT_TOKEN=<isi dari .env.local>

# Supabase
SUPABASE_URL=<isi dari .env.local>
SUPABASE_SERVICE_ROLE_KEY=<isi dari .env.local>
SUPABASE_ANON_KEY=<isi dari .env.local>
NEXT_PUBLIC_SUPABASE_URL=<isi dari .env.local>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<isi dari .env.local>

# Prisma
DATABASE_URL=<isi dari .env.local>
DIRECT_URL=<isi dari .env.local>

# CORS: origin yang diizinkan call admin API
# Production: www.bumibloom.com + Vercel staging
STOREFRONT_URL=https://www.bumibloom.com,https://bumi-bloom.vercel.app

# Stripe — mode sesuai environment
#   staging  : sk_test_...
#   produksi : sk_live_...
# NODE_ENV=production + sk_test_ akan DITOLAK saat checkout dipanggil,
# kecuali ALLOW_TEST_KEYS=true (khusus staging yang berjalan sbg production).
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=<dari webhook, lihat 1.4>
STRIPE_GST_TAX_RATE_ID=txr_...
STRIPE_CHECKOUT_MODE=stripe
# Kosongkan untuk memakai default Stripe. Isi hanya bila perlu override.
STRIPE_PAYMENT_METHODS=
# Isi "true" hanya di staging yang memakai NODE_ENV=production + key test.
ALLOW_TEST_KEYS=

# Order tracking (/order/<token>) — WAJIB. Tanpa ini pembuatan order gagal
# SETELAH Stripe menagih customer.
# Generate: openssl rand -hex 32
TRACKING_TOKEN_SECRET=<64 hex chars>

# Inventory location untuk restock refund
SHOPIFY_INVENTORY_LOCATION_ID=gid://shopify/Location/95822119154

# Runtime
NODE_ENV=production

# Opsional (import pipeline)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
IDR_TO_AUD_RATE=10000
REDIS_URL=
```

**Penting:** `NEXT_PUBLIC_*` di admin hanya untuk halaman login Supabase. Jangan masukkan `pk_test` atau `sk_test` di sini — itu untuk storefront dan server.

### 1.2b Migrasi database (WAJIB, manual)

Migrasi SQL **tidak** dijalankan otomatis oleh build. Jalankan berurutan
terhadap database tujuan sebelum deploy pertama:

```bash
node --env-file=apps/admin/.env.local scripts/apply-stripe-migration.mjs
node --env-file=apps/admin/.env.local scripts/apply-tracking-migration.mjs
node --env-file=apps/admin/.env.local scripts/apply-dispute-migration.mjs
```

Semua skrip idempoten (aman dijalankan berulang) dan menolak statement
destruktif.

Backfill token tracking untuk order lama (opsional, idempoten):

```bash
node --env-file=apps/admin/.env.local scripts/backfill-tracking-tokens.mjs --dry-run
node --env-file=apps/admin/.env.local scripts/backfill-tracking-tokens.mjs
```


### 1.3 Set Custom Domain

1. Railway → project → Settings → Networking
2. Generate Domain (atau Custom Domain)
3. Tambahkan `admin.bumibloom.com`
4. Railway akan beri instruksi DNS. Biasanya:
   ```text
   CNAME admin → <railway-generated>.up.railway.app
   ```
5. Tambahkan record itu di Hostinger DNS.

### 1.4 Buat Webhook Stripe Production

**Jangan pakai `whsec_` dari Stripe CLI.** CLI secret hanya untuk lokal.

1. Stripe Dashboard → Developers → Webhooks
2. Klik **Add endpoint**
3. URL:
   ```text
   https://admin.bumibloom.com/api/webhooks/stripe
   ```
4. Pilih event (8):
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `charge.refund.updated`
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.dispute.closed`
5. Klik **Add endpoint**

> Webhook di mode TEST dan LIVE terpisah. Saat pindah ke live, buat endpoint
> baru di mode LIVE dan ganti `STRIPE_WEBHOOK_SECRET` — endpoint test tidak
> menerima event live.
6. Buka endpoint → **Signing secret** → Reveal → copy `whsec_...`
7. Set ke Railway: `STRIPE_WEBHOOK_SECRET=whsec_...`

### 1.5 Verifikasi

```bash
curl https://admin.bumibloom.com/api/health
# harus: {"status":"ok","checks":{"stripe":true,...}}

curl -X OPTIONS https://admin.bumibloom.com/api/checkout/session \
  -H "Origin: https://www.bumibloom.com"
# harus: Access-Control-Allow-Origin: https://www.bumibloom.com
```

---

## 2. Deploy Storefront ke Vercel

### 2.1 Environment Variables

Di Vercel → Project → Settings → Environment Variables:

```env
# Shopify (public token, aman di browser)
NEXT_PUBLIC_SHOPIFY_SHOP=p9gcf7-wj
NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN=<isi dari .env.local>
NEXT_PUBLIC_SHOPIFY_API_VERSION=2026-10

# Stripe checkout
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_CHECKOUT_MODE=stripe
NEXT_PUBLIC_CHECKOUT_API_URL=https://admin.bumibloom.com
```

**Penting:** `NEXT_PUBLIC_*` dibaca saat **build**. Setelah mengisi env,
**wajib Redeploy**.

### 2.2 Set Root Directory

Di Vercel → Project → Settings → General:

```text
Root Directory: apps/storefront
```

Kalau sudah deploy sebelumnya dan hanya perlu update:
```bash
vercel --prod
```

### 2.3 Domain `www.bumibloom.com`

DNS sudah benar (CNAME ke Vercel). Di Vercel:

1. Project → Settings → Domains
2. Add `www.bumibloom.com`
3. Verifikasi (biasanya otomatis karena CNAME sudah ada)

### 2.4 Verifikasi

```bash
# Halaman utama
curl -s -o /dev/null -w "%{http_code}\n" https://www.bumibloom.com/
# harus: 200

# Checkout page
curl -s -o /dev/null -w "%{http_code}\n" https://www.bumibloom.com/checkout
# harus: 200 (bukan 307 redirect ke /cart)

# Checkout JS terbaru
curl -s -o /dev/null -w "%{http_code}\n" https://www.bumibloom.com/js/page-checkout.js
# harus: 200 (bukan 404)
```

---

## 3. Stripe Dashboard — Konfigurasi Production

### 3.1 Apple Pay Domain

Stripe → Settings → Payments → Apple Pay:

| Domain | Status |
|---|---|
| `www.bumibloom.com` | ✅ sudah active |
| `admin.bumibloom.com` | tambahkan kalau perlu (biasanya tidak) |
| `bumi-bloom.vercel.app` | tambahkan kalau masih staging di sini |

### 3.2 Test Mode vs Live Mode

**Sekarang (staging):** gunakan test mode.
```text
pk_test_...  → NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (Vercel)
sk_test_...  → STRIPE_SECRET_KEY (Railway)
whsec_...    → STRIPE_WEBHOOK_SECRET (Railway, dari endpoint dashboard)
txr_...      → STRIPE_GST_TAX_RATE_ID (Railway)
```

**Saat jualan nyata:** ganti semua ke live mode.
```text
pk_live_...  → NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (Vercel)
sk_live_...  → STRIPE_SECRET_KEY (Railway)
whsec_...    → STRIPE_WEBHOOK_SECRET (Railway, dari endpoint live dashboard)
txr_...      → STRIPE_GST_TAX_RATE_ID (Railway, buat baru di live mode)
```

**Langkah ganti ke live mode:**
1. Stripe Dashboard → toggle ke **Live mode**
2. Buat webhook endpoint baru (di live mode) → copy `whsec_`
3. Buat GST tax rate baru (di live mode) → copy `txr_`
4. Ganti semua env di Vercel dan Railway
5. Redeploy Vercel (wajib untuk `NEXT_PUBLIC_*`)
6. Restart Railway service

---

## 4. Checklist Sebelum Live

| Item | Cara cek |
|---|---|
| Admin health | `curl https://admin.bumibloom.com/api/health` |
| CORS | `curl -X OPTIONS https://admin.bumibloom.com/api/checkout/session -H "Origin: https://www.bumibloom.com"` |
| Storefront | Buka `https://www.bumibloom.com` |
| Checkout mode | `curl https://www.bumibloom.com/checkout` harus 200 |
| Checkout JS | `curl -s https://www.bumibloom.com/js/page-checkout.js` harus ada `initCheckoutFormSdk` |
| Webhook | Stripe Dashboard → Webhooks → pastikan endpoint production punya delivery sukses |
| Database | Migration sudah dijalankan |
| Scope Shopify | `read_discounts`, `read_draft_orders`, `write_draft_orders`, `write_orders` aktif |

---

## 5. Troubleshooting

### Checkout masih redirect ke /cart

**Penyebab:** `NEXT_PUBLIC_CHECKOUT_MODE` belum diset atau belum redeploy.

**Solusi:**
1. Cek Vercel → Settings → Environment Variables → `NEXT_PUBLIC_CHECKOUT_MODE=stripe`
2. Redeploy: `vercel --prod`

### CORS error di browser console

**Penyebab:** `STOREFRONT_URL` di Railway tidak sesuai.

**Solusi:** set ke `https://www.bumibloom.com,https://bumi-bloom.vercel.app`

### Webhook tidak masuk

**Penyebab:** endpoint Stripe belum dibuat atau `STRIPE_WEBHOOK_SECRET` masih pakai CLI.

**Solusi:**
1. Stripe Dashboard → Webhooks → cek endpoint production
2. Pastikan URL: `https://admin.bumibloom.com/api/webhooks/stripe`
3. Copy signing secret dari dashboard (bukan CLI)
4. Set ke Railway env

### Apple Pay tidak muncul

**Penyebab:** domain belum terdaftar di Stripe.

**Solusi:** Stripe → Settings → Apple Pay → tambah domain `www.bumibloom.com`

### 422 / "Discount code not found"

**Penyebab:** scope `read_discounts` belum aktif di app Shopify.

**Solusi:** lihat panduan scope di `stripe.plan.md` atau jalankan:
```bash
node --env-file=apps/admin/.env.local scripts/_verify-scopes.mjs
```
