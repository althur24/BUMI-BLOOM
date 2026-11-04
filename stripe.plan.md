# Stripe Full Checkout Plan — Embedded Checkout + Shopify Order Sync

**Status:** draft, belum dieksekusi
**Tanggal:** 2026-11-02
**Keputusan:** satu jalur checkout. Semua pembayaran lewat **Stripe Embedded
Checkout**. Shopify tetap dipakai untuk katalog, stok, order, customer, dan
laporan penjualan.

---

## 1. Ringkasan

- `/checkout` menjadi halaman nyata milik sendiri, bukan redirect ke Shopify.
- Customer tetap di `www.bumibloom.com/checkout`.
- Stripe Embedded Checkout ditanam di halaman itu.
- Setelah bayar, webhook membuat order di Shopify.
- Penjualan tetap terlihat di Shopify Admin, sales report, stok, dan customer.
- Payment method: kartu, Apple Pay, Google Pay, Link, Afterpay, Klarna, Zip.
- PayPal dan Shop Pay hilang karena bukan bagian dari Stripe checkout.

## 2. Yang berubah dari kondisi sekarang

| Sekarang | Setelah |
|---|---|
| Cart → Shopify checkout | Cart → `/checkout` |
| Checkout di Shopify | Stripe Embedded Checkout |
| Order dari Shopify checkout | Order via Admin API |
| Pixel Shopify untuk purchase | Server-side GA4 + Meta CAPI |
| Checkout UI Extension | Hanya untuk fallback Shopify checkout |
| PayPal/Shop Pay | Hilang |
| `/checkout` redirect ke `/cart` | Halaman checkout baru |

## 3. Flow customer

```text
Cart
  → klik Checkout
  → /checkout
     → tampilkan ringkasan cart
     → buat Stripe Checkout Session (embedded)
     → tampilkan form Stripe di halaman
  → customer isi email + alamat + pembayaran
  → bayar
  → onComplete
     → tampilkan status "memproses"
     → webhook membuat order Shopify
     → tampilkan nomor order
     → cart dikosongkan
```

Langkah detail:

1. Customer menambah produk ke cart.
2. Klik **Checkout**.
3. Masuk `/checkout`.
4. Halaman menampilkan ringkasan: item, subtotal, diskon, ongkir, total.
5. Server membuat Stripe Checkout Session dari cart yang sudah divalidasi.
6. Embedded Checkout muncul di halaman.
7. Customer mengisi email, alamat Australia, dan memilih metode.
8. Setelah bayar, halaman menampilkan "memproses order".
9. Webhook membuat order Shopify.
10. Halaman menampilkan nomor order dan email konfirmasi.
11. Cart dikosongkan hanya setelah order terkonfirmasi.

## 4. Halaman `/checkout`

Buat halaman React baru di `apps/storefront/app/checkout/page.tsx`.

Isi halaman:

- Header/logo brand.
- Ringkasan cart.
- Subtotal, diskon, shipping `$15` / free `$99`, total.
- Embedded Stripe Checkout.
- Trust banner: Made in Indonesia, non-toxic dyes, 14-day guarantee.
- State:
  - loading
  - siap bayar
  - memproses
  - sukses
  - gagal
- Mobile responsive.

Hapus redirect `/checkout` dari `next.config.mjs`.

## 5. Stripe Embedded Checkout

Session dibuat dengan:

```js
ui_mode: "embedded",
redirect_on_completion: "never",
```

Lalu di client:

```js
const stripe = await loadStripe(publishableKey);
const checkout = await stripe.initEmbeddedCheckout({
  clientSecret,
  onComplete: handleComplete,
});
checkout.mount("#stripe-checkout");
```

Catatan:

- Halaman tetap di domain sendiri.
- Form pembayaran berada di iframe Stripe; PCI ditangani Stripe.
- Styling halaman bisa brand; styling di dalam iframe terbatas.
- Verifikasi Afterpay/Klarna/Zip muncul di embedded. Kalau tidak, fallback ke
  hosted Checkout atau Payment Element.

## 6. Payment methods

Dengan Stripe US + customer Australia + AUD:

| Metode | Status |
|---|---|
| Cards | Ya |
| Apple Pay | Ya |
| Google Pay | Ya |
| Link | Ya |
| Afterpay | Ya, jika diaktifkan |
| Klarna | Ya, jika diaktifkan |
| Zip | Ya, jika diaktifkan |
| PayPal | Tidak |
| Shop Pay | Tidak |
| BECS/PayTo | Tidak, butuh akun AU |

Aktifkan Afterpay/Klarna/Zip di Stripe Dashboard sebelum implementasi.

## 7. API server

Ditempatkan di `apps/admin`:

### `POST /api/checkout/session`

Input:

```json
{
  "items": [{ "variantId": "gid://...", "quantity": 1 }],
  "promoCode": "WELCOME10",
  "attribution": {
    "utm_source": "...",
    "utm_campaign": "...",
    "gclid": "...",
    "fbclid": "...",
    "fbp": "...",
    "fbc": "...",
    "ga_client_id": "..."
  }
}
```

Proses:

1. Rate limit.
2. Validasi item ke Shopify Storefront API `@inContext(AU)`.
3. Cek stok dan harga.
4. Hitung diskon, shipping, tax.
5. Buat Stripe Checkout Session.
6. Simpan `StripeCheckout` status `PENDING`.
7. Return `{ clientSecret, quote, sessionId }`.

### `GET /api/checkout/session/:id/status`

Untuk halaman sukses:

- status Stripe
- status order Shopify
- nomor order

### `POST /api/webhooks/stripe`

Handle:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `payment_intent.payment_failed`
- `charge.refunded`

## 8. Sinkron order ke Shopify

Webhook:

1. Verifikasi signature.
2. Cek idempotency event.
3. Cek mapping session.
4. Buat draft order Shopify:
   - line items
   - shipping line
   - discount
   - email
   - alamat
   - `presentmentCurrencyCode: "AUD"`
   - `sourceName: "stripe_checkout"`
   - tag `stripe-checkout`
   - custom attributes: session id, payment intent
5. Complete / mark paid.
6. Simpan `shopifyOrderId`.
7. Kirim email konfirmasi Shopify.
8. Kirim analytics.

Perlu spike untuk memastikan:

- status pembayaran order
- inventory decrement
- tax/shipping lines
- nominal sama dengan Stripe

## 9. Voucher, shipping, tax

- Shipping: Standard `$15`, free ≥ `$99`, AU only, 5–8 hari.
- Voucher:
  - MVP: `WELCOME10` + kode fixed yang didaftarkan server-side.
  - Phase 2: semua kode Shopify.
- Tax:
  - Jika belum GST: tidak collect GST.
  - Jika sudah: Stripe Tax atau tax rate 10%, lalu samakan dengan order Shopify.

## 10. Tracking & analytics

Karena semua purchase sekarang lewat Stripe:

- Shopify tetap mencatat order di Admin dan sales report.
- Pixel Shopify **tidak** mengirim purchase untuk Stripe checkout.
- Kirim purchase dari webhook ke:
  - GA4 Measurement Protocol
  - Meta Conversions API
- Opsional: pixel di halaman sukses dengan `event_id` yang sama.

Simpan sebelum redirect:

- UTM
- `gclid`, `fbclid`
- `_fbp`, `_fbc`
- `ga_client_id`
- consent marketing

Dedup:

- `transaction_id` = Stripe session ID atau Shopify order ID
- `event_id` Meta sama untuk client/server

## 11. Refund

MVP:

- Refund manual di Stripe Dashboard.
- Refund manual di Shopify.
- Tabel mapping untuk rekonsiliasi.

Phase 2:

- `charge.refunded` webhook.
- Buat refund di Shopify otomatis.
- Update status `REFUNDED`.

## 12. Data model

```prisma
enum StripeCheckoutStatus {
  PENDING
  PAID
  EXPIRED
  FAILED
  REFUNDED
}

model StripeCheckout {
  id                    String               @id @default(cuid())
  stripeSessionId       String               @unique
  stripePaymentIntentId String?
  status                StripeCheckoutStatus @default(PENDING)
  cartHash              String
  amountAudCents        Int
  shippingAudCents      Int                  @default(0)
  discountAudCents      Int                  @default(0)
  currency              String               @default("AUD")
  customerEmail         String?
  promoCode             String?
  itemsJson             Json
  attributionJson       Json?
  shopifyOrderId        String?
  shopifyOrderName      String?
  createdAt             DateTime             @default(now())
  updatedAt             DateTime             @updatedAt

  @@index([status])
  @@index([customerEmail])
  @@index([shopifyOrderId])
}

model StripeWebhookEvent {
  id          String   @id
  type        String
  processedAt DateTime @default(now())
}
```

## 13. Environment

Di `apps/admin`:

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CHECKOUT_MODE=stripe
GA4_MEASUREMENT_ID=
GA4_API_SECRET=
META_PIXEL_ID=
META_CAPI_ACCESS_TOKEN=
```

Di storefront:

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_CHECKOUT_MODE=stripe
```

## 14. Fase implementasi

| Fase | Isi | Estimasi |
|---|---|---|
| 0 | Eligibility Stripe + spike embedded + draft order | 2–3 hari |
| 1 | Prisma + env + API skeleton | 2 hari |
| 2 | Session API + validasi cart/quote | 3–4 hari |
| 3 | Halaman `/checkout` + embedded | 2–3 hari |
| 4 | Webhook + Shopify order sync | 3–4 hari |
| 5 | Voucher/shipping/tax | 2–3 hari |
| 6 | Analytics + attribution | 2–3 hari |
| 7 | Refund + rekonsiliasi | 2 hari |
| 8 | Testing + rollout | 3–4 hari |

Total: **3–4 minggu**. MVP tanpa refund otomatis/analytics lengkap: **2–3 minggu**.

## 15. Test matrix

- Embedded Checkout mount di `/checkout`.
- Reload halaman / session reuse.
- Cards, Apple Pay, Google Pay, Link.
- Afterpay sukses.
- Klarna sukses/delayed.
- Zip sukses.
- Cancel, expired, failed.
- Voucher valid/invalid.
- Shipping `$15` / free `$99`.
- Tax/GST.
- Out-of-stock saat bayar.
- Webhook duplicate/retry.
- Order Shopify, stok, email.
- Refund penuh/partial.
- GA4/Meta purchase sekali.
- UTM/fbclid/gclid/_fbp terbawa.
- Consent false.
- Mobile.
- Feature flag off → fallback Shopify checkout.

## 16. Risiko

- Checkout di luar Shopify perlu konfirmasi kebijakan Shopify.
- PayPal dan Shop Pay hilang.
- Voucher/tax/shipping harus direplikasi.
- Oversell inventory.
- Tracking/attribution harus dibangun sendiri.
- Embedded Checkout punya keterbatasan styling.
- Refund/chargeback lebih manual.
- Settlement Stripe US dalam USD + FX.

## 17. Keputusan yang masih terbuka

1. GST Australia sudah terdaftar?
2. Voucher: hanya `WELCOME10` atau semua kode Shopify?
3. Refund manual dulu atau otomatis?
4. GA4/Meta ID dan consent banner sudah ada?
5. Afterpay/Klarna/Zip sudah aktif di Stripe Dashboard?
6. Shopify checkout tetap dipertahankan sebagai fallback selama rollout?
7. Customer checkout sebagai guest atau login?

## 18. Acceptance criteria

- `/checkout` tampil rapi di domain sendiri.
- Embedded Stripe Checkout berfungsi.
- Afterpay/Klarna/Zip muncul.
- Order masuk Shopify, stok berkurang, email terkirim.
- Total sesuai `$15` / free `$99`, voucher, tax.
- Purchase tercatat sekali di GA4/Meta.
- Refund path jelas.
- Fallback ke Shopify checkout bisa diaktifkan.
- Sales report Shopify mencakup semua order.
