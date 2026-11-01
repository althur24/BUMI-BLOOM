# Checkout Branding — BUMI / BLOOM

Panduan menyelaraskan halaman checkout Shopify dengan tema storefront.
Checkout tetap di-host Shopify; yang bisa diubah adalah branding, bukan layout
atau field pembayaran.

## 1. Logo

Upload ke Shopify Admin → Settings → Checkout → Customize → Logo:

- File: `public/images/brand/bumi-bloom-checkout-logo.png`
- Ukuran: 1200 × 360 px, background transparan
- Lebar tampilan: ±160 px
- Alignment: kiri

Versi SVG tersedia di `public/images/brand/bumi-bloom-checkout-logo.svg`
kalau Shopify menerima format tersebut.

## 2. Warna

| Elemen | Hex |
|---|---|
| Header background | `#F2EEE9` |
| Main background | `#FFFFFF` |
| Order summary background | `#F7F3EE` |
| Teks utama | `#00408C` |
| Teks sekunder | `#1E5AA8` |
| Tombol utama | `#00408C` |
| Teks tombol | `#FFFFFF` |
| Accent / link | `#E85234` |
| Error | `#E85234` |
| Border | `#E8E8E8` |

## 3. Bentuk

- Corner radius global: `12px`
- Tombol: pill `999px` kalau tersedia; kalau tidak, `12px`
- Input field: solid, bukan transparan
- Checkout layout: one-page

## 4. Font

Shopify checkout hanya menyediakan daftar font pilihan. Tidak ada upload font
kustom di plan Basic.

- Utama: cari **Outfit** (heading) dan **Nunito** / **Nunito Sans** (body).
- Fallback heading: Jost atau Poppins.
- Fallback body: Assistant atau DM Sans.
- Ukuran heading: 20–24 px; body: 14–16 px.

Kalau font harus persis Outfit/Nunito, jalurnya adalah custom checkout atau
plan Shopify yang lebih tinggi.

## 5. Banner trust

Banner ditambahkan lewat Checkout UI Extension di `checkout-app/`:

- Baris 1: **Made in Indonesia · Non-toxic dyes**
- Baris 2: Free AU shipping over $99 · 14-day damage guarantee

Deploy mengikuti `checkout-app/README.md`.

## 6. Pengaturan lain

- Payment: Stripe third-party, capture automatic.
- Market: Australia harus aktif di Shopify Markets agar alamat Australia bisa
  dipilih di checkout. Tanpa market Australia, checkout hanya menampilkan
  Indonesia.
- Shipping: **Standard `$15.00` (5–8 business days)** — sudah aktif dan
  terverifikasi. **Free shipping over `$99`** juga sudah aktif dan terverifikasi.
  Express belum ada.
- Delivery time: website dan checkout sama-sama 5–8 business days.
- Locale/negara: checkout memakai `buyerIdentity: { countryCode: 'AU' }` di
  `createShopifyCart`, jadi format mengikuti `en-AU` (`$27.99`). Tidak perlu
  menambah locale English (Australia) di Shopify.
- Discount field mobile: always show.
- Pastikan metode pembayaran yang tampil di website sama dengan yang aktif di
  Stripe/Shopify. Jangan menampilkan Afterpay/PayPal kalau tidak aktif.

## 7. Verifikasi

- Logo tampil tajam di desktop dan mobile.
- Warna tombol dan background sesuai.
- Banner muncul di checkout dan tidak menutupi field.
- Voucher `WELCOME10` bisa dipakai.
- Checkout berhasil dengan Stripe test/live.
- Order masuk Shopify dan stok berkurang.
