# BUMI / BLOOM — Checkout UI Extension

Extension ini menambahkan banner trust di halaman checkout Shopify:

> Made in Indonesia · Non-toxic dyes
> Free AU shipping over $99 · 14-day damage guarantee

## Batasan

- Checkout tetap di-host Shopify; extension hanya menambah blok.
- Layout, field, dan metode pembayaran tetap milik Shopify.
- Banner mengikuti warna/font dari checkout branding, bukan CSS website.
- Plan Basic tidak mendukung upload font kustom di checkout.

## Setup

```bash
cd checkout-app
npm install
npx shopify app config link
```

Pilih app **Bumi Bloom Admin** saat linking. Ini akan mengisi `client_id` di `shopify.app.toml`.

## Preview

```bash
npm run dev
```

Buka URL preview yang muncul, lalu cek banner di checkout.

## Deploy

```bash
npm run deploy
```

Setelah deploy:

1. Shopify Admin → Settings → Checkout → Customize.
2. Cari blok **Bumi Bloom Trust Banner**.
3. Drag ke posisi yang diinginkan (mis. atas form checkout).
4. Save.

## Catatan

- Jangan memakai app Checkout Blocks untuk banner ini di plan Basic; sebagian besar fiturnya Plus-only.
- Kalau banner tidak muncul, pastikan app sudah di-install ke toko dan extension sudah di-deploy.
