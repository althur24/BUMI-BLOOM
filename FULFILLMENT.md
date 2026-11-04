# Fulfillment & Pengiriman — Panduan Operasional

Panduan ini untuk memproses order dari checkout Stripe sampai barang diterima
customer. Semua langkah fulfillment dilakukan di **Shopify Admin**, bukan di
website. Tidak ada kode yang perlu dijalankan.

---

## Alur lengkap

```text
Customer bayar di /checkout
   ↓
Webhook membuat order di Shopify (status: PAID, unfulfilled)
   ↓
Shopify kirim EMAIL KONFIRMASI ke customer
   ↓
Anda siapkan & kirim barang lewat kurir lokal
   ↓
Anda isi nomor resi di Shopify Admin
   ↓
Shopify kirim EMAIL "SHIPPED" berisi resi + link tracking
   ↓
Customer lacak kiriman
   ↓
Barang diterima
```

---

## 1. Setelah order masuk

Setiap order dari checkout Stripe punya ciri:

- Tag `stripe-checkout`
- Note berisi `Stripe checkout <id>` dan `Promo <kode>` jika ada voucher
- Custom attributes: `stripe_checkout_id`, `stripe_session_id`,
  `stripe_payment_intent`

Cek di **Shopify Admin → Orders**.

Pastikan:

- Payment status: **Paid**
- Fulfillment status: **Unfulfilled**
- Total sama dengan yang tercatat di database kita (`shopifyTotalAudCents`)

---

## 2. Menyiapkan barang

Ini di luar sistem. Anda:

1. Ambil item sesuai order.
2. Kemas.
3. Serahkan ke kurir lokal Anda.
4. Catat **nomor resi** dan **link cek kiriman** dari kurir.

---

## 3. Mark as fulfilled di Shopify Admin

1. Buka **Shopify Admin → Orders**.
2. Pilih order.
3. Klik **Fulfill items**.
4. Isi:
   - **Tracking number**: nomor resi dari kurir lokal.
   - **Tracking URL**: link cek kiriman. Kalau kurir tidak punya URL standar,
     tempelkan link tracking mereka.
   - **Tracking company**: nama kurir. Kalau tidak ada di daftar, pilih
     **Other** dan tulis namanya.
5. **Centang** "Send shipment details to your customer now".
6. Klik **Fulfill items**.

Setelah itu:

- Status order berubah menjadi **Fulfilled**.
- Shopify mengirim email "Your order is on its way" berisi resi dan link.
- Status page customer menampilkan tracking.

---

## 4. Tracking untuk customer

Customer bisa melacak lewat dua cara:

1. **Dari email Shopify** — email "shipped" berisi nomor resi dan link.
2. **Dari halaman sukses kita** — tombol **Track your order** mengarah ke
   Shopify order status page.

Halaman status Shopify bisa dibuka tanpa login karena memakai token.

### Yang tampil di halaman status

Halaman status **otomatis ter-update** saat Anda fulfillment. Link-nya sama,
isinya yang berubah:

| Tahap | Yang tampil |
|---|---|
| Baru bayar | Order confirmed, Payment: Paid, belum ada resi |
| Setelah fulfillment | Fulfilled, resi, tombol Track shipment |

Anda **tidak perlu** mengedit halaman itu. Cukup isi resi di Shopify Admin.

### Catatan domain

Saat ini link status masih memakai domain `p9gcf7-wj.myshopify.com`.
Rencananya akan diganti ke halaman tracking sendiri (`/order/[token]`) di
`www.bumibloom.com` pada fase berikutnya.

---

## 5. Kalau ada masalah

### Barang tidak sampai
1. Cek status di Shopify Admin dan situs kurir.
2. Kalau hilang, buka klaim ke kurir.
3. Kalau refund penuh diberikan, lakukan refund dari **Stripe Dashboard**.
   Sistem akan otomatis mengembalikan stok di Shopify.

### Customer minta retur
1. Barang diterima kembali dan diperiksa.
2. Refund penuh dari **Stripe Dashboard**.
3. Webhook `charge.refunded` akan:
   - Membuat refund di Shopify
   - Mengembalikan stok (restock ke lokasi Maguwoharjo)
   - Mengirim email refund ke customer

### Customer tukar ukuran
1. Proses sebagai retur + order baru, atau
2. Kirim ulang tanpa refund (kebijakan Anda).
   Kalau tanpa refund, tidak ada aksi di sistem.

---

## 6. Refund partial

**Refund sebagian TIDAK mengembalikan stok otomatis.** Hanya refund penuh
yang memicu restock.

Kalau Anda refund sebagian **dan** barangnya kembali:

1. Buka **Shopify Admin → Products → Inventory**.
2. Tambah stok item yang kembali di lokasi Maguwoharjo secara manual.

Ini keputusan disengaja supaya stok tidak naik padahal barang tidak kembali.

---

## 6. Checklist harian

- [ ] Cek **Shopify Admin → Orders** untuk order `stripe-checkout` baru.
- [ ] Pastikan email konfirmasi terkirim (lihat kolom `emailSentAt` di database
      atau cek inbox customer untuk testing).
- [ ] Siapkan dan kirim barang.
- [ ] Isi resi di Shopify Admin + centang notifikasi.
- [ ] Pantau order yang belum di-fulfill lebih dari 2 hari.

---

## 7. Yang TIDAK perlu dilakukan

- Tidak perlu membuat order manual di Shopify. Order dibuat otomatis oleh webhook.
- Tidak perlu mengirim email manual. Shopify yang kirim.
- Tidak perlu input data trackiing di website kita. Cukup di Shopify Admin.
- Tidak perlu refund di dua tempat. Refund dari Stripe saja; Shopify ikut otomatis.

---

## 8. Kalau email konfirmasi tidak terkirim

Gejala: customer tidak menerima email setelah bayar.

Cek:

1. **Email toko di Shopify** sudah diisi alamat resmi, bukan placeholder?
   Settings → Store details.
2. **Sender email terverifikasi**? Settings → Notifications → Sender email.
   Statusnya harus "Verified".
3. **Database**: kolom `emailSentAt` di tabel `StripeCheckout`. Kalau `null`,
   email belum terkirim.
4. **Log admin**: cari `[checkout] confirmation email` di log server.
5. Kalau order ada tetapi email gagal, kirim manual:
   Shopify Admin → Orders → pilih order → **Send invoice**.

---

## 9. Catatan tentang email pengirim

Saat ini email dikirim dari alamat toko Shopify. Untuk produksi:

- Ganti dari `somework16@gmail.com` ke `orders@bumibloom.com`.
- Verifikasi domain `bumibloom.com` di Shopify (SPF + DKIM).
- Simpan `hello@bumibloom.com` khusus newsletter, jangan dipakai untuk order.

Detail setup email ada di plan terpisah (Fase 6).
