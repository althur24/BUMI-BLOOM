# Tutorial Checkout — BUMI / BLOOM

Panduan langkah demi langkah untuk mengaktifkan checkout Shopify + Stripe,
menyelaraskan tema, memasang banner, dan menguji pembayaran.

Status kode di repo: **selesai**. Checkout palsu sudah dihapus, promo diteruskan
ke Shopify, dan banner checkout sudah disiapkan.

Untuk sementara checkout memakai domain Shopify yang sekarang
(`p9gcf7-wj.myshopify.com`). Domain `checkout.bumibloom.com` dikerjakan nanti.

---

## Status verifikasi terakhir

| Item | Status |
|---|---|
| Password protection | Sudah mati |
| Checkout terbuka | Ya |
| Gateway | **Stripe Card Payments** aktif |
| Currency | AUD |
| Metode terdeteksi | Credit card, Apple Pay, PayPal |
| Australia market | **Aktif** — semua produk tersedia di `@inContext(AU)` |
| Shipping Australia | **$15.00 terverifikasi** — Standard 5–8 hari, hanya satu metode |
| Free shipping over `$99` | **Aktif** — subtotal `$111.96` gratis |
| Format harga | **Sudah benar** — `en-AU`, `$27.99` |
| Tampilan sold-out | **Sudah jalan** — muncul untuk produk yang benar-benar habis |

## Status produk AU

`@inContext(country: AU)` sekarang mengembalikan `availableForSale: true` dan
stok tersedia. Website menampilkan in-stock, tombol **Add to Bag** aktif, dan
status Sold Out hanya muncul untuk varian yang memang habis.

### Penyebab out of stock sebelumnya

Stok total tidak habis. Masalahnya: **produk belum “tersedia” untuk market
Australia**. Shopify Markets menentukan availability per market, bukan dari stok
global saja.

Empat syarat agar produk bisa dibeli di AU:

1. Produk terbit ke sales channel yang dipakai (Headless).
2. Produk masuk ke **catalog market Australia**.
3. Produk tercakup **shipping profile** yang punya zona Australia.
4. Inventory tersedia di lokasi yang memenuhi market.

Gejala nomor 2 dan nomor 3 sama-sama bisa membuat
`@inContext(AU)` mengembalikan `quantityAvailable: 0` meskipun stok di market
utama ada.

Pada kasus ini, shipping belum di-set ke **all products**. Artinya produk tidak
tercakup profil shipping yang punya rate Australia, sehingga Shopify
menganggapnya tidak bisa dikirim ke AU dan menghitungnya sebagai tidak tersedia
/ out of stock.

Setelah katalog market Australia dibuat dan shipping profile mencakup produk,
stok langsung muncul dan checkout berjalan.

Karena itu, setiap produk baru harus:

- masuk ke **catalog market Australia**, dan
- masuk ke **shipping profile** yang punya zona Australia.

Kalau suatu saat semua produk kembali Sold Out, cek:

- **Channel Headless.** Produk terbit ke publication **My Store Headless**, dan
  ada publication lain **My Store Headless 02**. Pastikan token Storefront di
  `data.js` milik channel yang masuk ke market Australia.
- **Shipping profile produk.** Buka Settings → Shipping and delivery → profil
  yang dipakai produk → pastikan produk termasuk di dalamnya, zona Australia
  ada, dan lokasi inventory **Maguwoharjo** tercakup.

## Yang sudah diperbaiki di kode: locale & negara checkout

Sebelumnya checkout memakai `en-ID` dan `$27,99` karena cart tidak mengirim
negara buyer, sehingga Shopify memakai lokasi IP (Indonesia). Sekarang
`BumiCart.createShopifyCart()` mengirim:

```js
buyerIdentity: { countryCode: 'AU' }
```

Hasil verifikasi:

- URL checkout: `/en-au`
- `<html lang="en-AU">`
- Country/Region default: **Australia**
- Harga: **`$27.99`**

Tidak perlu menambah locale English (Australia) di Shopify. Satu locale
“English” sudah cukup karena format mengikuti negara buyer.

Catatan: semua checkout sekarang dipaksa ke Australia. Kalau nanti ingin
melayani Indonesia juga, `buyerIdentity` harus dibuat dinamis (pilih negara
atau deteksi lokasi).

## Tampilan sold-out di website

Website sekarang mengambil stok dari market Australia:

```js
// data.js
const PRODUCTS_QUERY = `query @inContext(country: AU) { ... }`;
```

Lalu menampilkan status stok di UI:

- PLP/homepage: badge **Sold Out** dan tombol **Add to Bag** disabled.
- PDP: tulisan **Sold Out**, ukuran yang habis dicoret dan disabled, tombol
  **Add to Bag** disabled.
- Add to cart juga diblokir kalau varian tidak tersedia.

Karena katalog Australia saat ini kosong, semua produk tampil Sold Out.
Setelah produk tersedia di market Australia, status akan berubah otomatis.

## Shipping `$15` sudah terverifikasi

Hasil checkout Australia:

| Subtotal | Shipping | Total |
|---|---|---|
| `$27.99` | `$15.00` | `$42.99` |
| `$83.97` | `$15.00` | `$98.97` |
| `$111.96` | **FREE** | `$111.96` |

Metode: **Standard 5–8 business days**, hanya satu metode.

### Free shipping over `$99`

Sudah aktif dan terverifikasi. Threshold di website juga sudah diubah ke `$99`
(cart drawer, announcement bar, trust bar, hero, PDP, metadata).

### Delivery time

Website dan checkout sama-sama memakai **5–8 business days**.

> Catatan: kalau checkout kembali ke `/password`, matikan password protection di
> **Online Store → Preferences**.

---

## 1. Verifikasi Stripe

Berdasarkan pengecekan checkout:

- Gateway yang muncul: **Stripe Card Payments**.
- Presentment currency: **AUD**.
- Metode: Credit card, Apple Pay, PayPal.
- Afterpay belum terdeteksi.

Yang tetap perlu dicek di admin:

1. Shopify Admin → **Settings** → **Payments**.
2. Pastikan **Stripe** berstatus aktif.
3. Pastikan publishable key dan secret key sudah terisi.
4. Payment capture: **Automatic**.
5. Sesuaikan copy website dengan metode yang aktif.

### Catatan AUD

Stripe sudah melaporkan AUD sebagai presentment currency. Kalau payout ke
rekening Indonesia dikonversi ke IDR, cek fee konversinya di dashboard Stripe.

---

## 2. Shipping Australia

Status saat ini:

- **Standard `$15.00`**, 5–8 business days — sudah aktif dan terverifikasi.
- **Free shipping over `$99`** — sudah aktif dan terverifikasi.
- Hanya ada satu metode.
- Express belum ada di checkout.

Kalau mau menambah Express:

1. Shopify Admin → **Settings → Shipping and delivery**.
2. Buka zona Australia → **Add rate**.
3. Tambahkan Express dengan harga di atas `$15.00` (mis. `$20.00`).
4. Save.

Cart di website sudah memakai threshold `$99` (subtotal setelah diskon).

---

## 3. Pajak / GST

1. Shopify Admin → **Settings** → **Taxes and duties**.
2. Kalau Anda terdaftar GST Australia:
   - Aktifkan GST 10%.
   - Tentukan apakah harga sudah termasuk GST.
3. Kalau belum terdaftar:
   - Jangan collect GST.
   - Copy website sudah netral: “Taxes calculated at checkout.”

Konsultasikan status GST dengan akuntan sebelum mengaktifkan pajak.

---

## 4. Branding checkout

1. Shopify Admin → **Settings** → **Checkout**.
2. Klik **Customize** pada konfigurasi checkout.
3. Terapkan nilai berikut.

| Elemen | Nilai |
|---|---|
| Header background | `#F2EEE9` |
| Main background | `#FFFFFF` |
| Order summary | `#F7F3EE` |
| Teks utama | `#00408C` |
| Teks sekunder | `#1E5AA8` |
| Tombol utama | `#00408C` |
| Teks tombol | `#FFFFFF` |
| Accent / link | `#E85234` |
| Error | `#E85234` |
| Border | `#E8E8E8` |
| Radius kartu/input | `12px` |
| Radius tombol | `999px` jika tersedia |
| Layout | One-page checkout |
| Discount field mobile | Always show |

Panduan lengkap ada di `apps/storefront/checkout-branding.md`.

---

## 5. Logo checkout

File logo:

```
apps/storefront/public/images/brand/bumi-bloom-checkout-logo.png
apps/storefront/public/images/brand/bumi-bloom-checkout-logo.svg
```

Langkah:

1. Di checkout editor, buka **Settings** → **Logo**.
2. Upload `bumi-bloom-checkout-logo.png`.
3. Atur lebar sekitar `160px`.
4. Alignment: kiri.
5. Save.

Logo memakai teks `BUMI / BLOOM` warna dark blue dengan titik peach.

---

## 6. Font checkout

1. Di checkout editor, buka **Settings** → **Typography**.
2. Cek apakah **Outfit** dan **Nunito** tersedia.
3. Kalau tersedia:
   - Headings: Outfit.
   - Body: Nunito.
4. Kalau tidak tersedia, gunakan fallback:
   - Headings: Jost atau Poppins.
   - Body: Nunito Sans atau Assistant.
5. Ukuran yang disarankan:
   - Heading: 20–24px.
   - Body: 14–16px.

Shopify checkout di plan Basic tidak menerima upload font kustom.

---

## 7. Deploy banner checkout

Banner ada di folder `checkout-app/`.

```bash
cd checkout-app
npm install
npx shopify app config link
npm run deploy
```

Saat `config link`:

1. Pilih app yang sudah ada, **Bumi Bloom Admin**.
2. Pastikan `client_id` di `shopify.app.toml` terisi.
3. Kalau diminta URL auth, gunakan URL app yang ada di Dev Dashboard.

Setelah deploy:

1. Install app ke toko kalau belum.
2. Shopify Admin → **Settings** → **Checkout** → **Customize**.
3. Cari blok **Bumi Bloom Trust Banner**.
4. Drag ke posisi yang diinginkan, misalnya di atas form checkout.
5. Save.

Banner menampilkan:

> Made in Indonesia · Non-toxic dyes
> Free AU shipping over $99 · 14-day damage guarantee

---

## 8. Testing sebelum live

Lakukan di desktop dan mobile.

### Checkout dasar

- [ ] Password protection Shopify sudah mati.
- [ ] Buka `www.bumibloom.com`.
- [ ] Tambah produk ke cart.
- [ ] Klik checkout.
- [ ] Halaman checkout terbuka, bukan halaman password.
- [ ] URL checkout saat ini `p9gcf7-wj.myshopify.com` (domain baru nanti).
- [ ] Metode pembayaran muncul.

### Pembayaran

- [ ] Pembayaran kartu berhasil.
- [ ] Pembayaran ditolak/decline menampilkan error yang jelas.
- [ ] Refund dari Shopify Admin berhasil.
- [ ] Order muncul di Shopify.
- [ ] Stok berkurang.
- [ ] Email konfirmasi terkirim.

### Voucher

- [ ] `WELCOME10` berhasil.
- [ ] Kode lain yang valid berhasil.
- [ ] Kode invalid ditolak Shopify.
- [ ] Diskon terlihat di checkout.

### Shipping

- [ ] Subtotal di bawah $99 kena `15.00`.
- [ ] Subtotal $99+ gratis.
- [ ] Diskon yang menurunkan subtotal di bawah $99 mengembalikan ongkir.
- [ ] Express `14.95` muncul kalau diaktifkan (sebaiknya lebih mahal dari Standard).

### Banner & tema

- [ ] Banner trust muncul.
- [ ] Banner tidak menutupi field.
- [ ] Warna tombol dan background sesuai.
- [ ] Logo tajam.
- [ ] Font konsisten di desktop/mobile.

### Analytics

- [ ] GA4 menerima `begin_checkout`.
- [ ] GA4/Meta menerima `purchase` dari Shopify.
- [ ] Tidak ada double-count.

---

## 9. Domain nanti

Saat siap memakai `checkout.bumibloom.com`:

1. Shopify Admin → **Settings** → **Domains**.
2. Tambah `checkout.bumibloom.com`.
3. DNS: `CNAME checkout → shops.myshopify.com`.
4. Jadikan **primary domain**.
5. Hapus A record apex `bumibloom.com` yang sekarang error SSL.
6. Di Vercel, redirect `bumibloom.com` → `https://www.bumibloom.com`.
7. Tunggu SSL Shopify aktif.
8. Verifikasi checkout URL berubah ke `checkout.bumibloom.com`.

Tidak ada perubahan kode yang diperlukan untuk langkah ini.

---

## 10. Troubleshooting

**Checkout redirect ke `/password`**
- Password protection Shopify masih aktif. Matikan di Online Store → Preferences.

**Country/Region default Indonesia atau harga `$27,99`**
- Ini sudah diperbaiki lewat `buyerIdentity: { countryCode: 'AU' }` di
  `apps/storefront/public/js/cart.js`.
- Kalau muncul lagi, pastikan kode itu masih ada dan mirror `js/cart.js` sama.
- Pastikan market Australia masih aktif.

**Checkout menampilkan “Out of stock” atau “Your order is free”**
- Produk tidak tersedia di market Australia.
- Buka Settings → Markets → Australia → Products/Catalog.
- Pilih **Include all products** atau tambahkan produk.
- Pastikan inventory location memenuhi pesanan Australia.
- Pastikan market Australia aktif dan punya shipping rate.

**Website menampilkan semua produk Sold Out**
- Query produk memakai `@inContext(country: AU)`.
- Kalau semua sold out, cek dua hal utama:
  1. Produk belum masuk **catalog market Australia**.
  2. Produk belum tercakup **shipping profile** yang punya zona Australia
     (mis. rate `$15` belum di-set ke all products).
- Publish produk ke market Australia dan pastikan shipping profile mencakup
  produk tersebut.
- Kalau sudah, tapi tetap sold out, cek:
  - Publication **My Store Headless** vs **My Store Headless 02**.
  - Token Storefront di `data.js` harus milik channel yang masuk market Australia.
  - Lokasi inventory **Maguwoharjo** harus masuk ke zona Australia.

**Free over `$99` tidak muncul di checkout**
- Cek rate **Free shipping** di zona Australia.
- Condition harus order price ≥ `$99`.
- Pastikan subtotal setelah diskon memang ≥ `$99`.
- Untuk subtotal di bawah `$99`, Standard `$15.00` tetap muncul.

**Stripe tidak muncul di checkout**
- Cek Settings → Payments → Stripe.
- Pastikan akun Stripe aktif dan mendukung AUD.
- Cek metode pembayaran di konfigurasi Stripe.

**Voucher valid tapi tidak muncul**
- Pastikan kode dibuat di Shopify Discounts.
- Pastikan kode aktif dan memenuhi syarat.
- Cart hanya mengestimasi kode yang dikenal; kode lain divalidasi Shopify.

**Banner tidak muncul**
- Pastikan `npm run deploy` berhasil.
- Pastikan app sudah di-install.
- Pastikan blok sudah ditempatkan di checkout editor dan disimpan.

**Font tidak sama**
- Shopify hanya menyediakan daftar font. Gunakan fallback yang disarankan.

**Checkout URL masih myshopify**
- Domain belum diatur. Ini normal untuk sementara.

---

## 11. Perintah berguna

Dari root repo:

```bash
npm run typecheck:storefront
npm run build:storefront
```

Dari `checkout-app/`:

```bash
npm install
npm run dev
npm run deploy
```

Preview extension:

```bash
npm run dev
```

---

## 12. Checklist go-live

- [ ] Password protection mati.
- [ ] Stripe aktif dan metode benar.
- [ ] Market Australia aktif dan muncul di country selector.
- [ ] Produk tersedia di market Australia (tidak semua Sold Out).
- [ ] Standard `$15.00` muncul di checkout — sudah terverifikasi.
- [ ] Free over `$99` muncul di checkout — sudah terverifikasi.
- [ ] Delivery time website dan checkout sama (5–8 hari) — sudah terverifikasi.
- [ ] Format harga `$27.99` (en-AU) — sudah terverifikasi.
- [ ] Tampilan Sold Out muncul untuk produk yang benar-benar habis.
- [ ] Semua checkout diarahkan ke Australia (buyerIdentity AU).
- [ ] Tax Australia benar.
- [ ] Branding & logo terpasang.
- [ ] Banner terpasang.
- [ ] Test payment, voucher, refund, email.
- [ ] Domain checkout diarahkan (opsional, nanti).
- [ ] Monitor 3–5 order pertama.
