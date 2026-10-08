# PLAN — Admin Import Produk → Shopify + Analytics

> Status: **Final, terkunci** (build mode aktif, menunggu konfirmasi sebelum eksekusi Fase 1)
> Sumber keputusan: sesi diskusi arsitektur (Plan mode)

---

## 0. Ringkasan eksekutif

Membangun **admin panel terpisah** (`admin.domain.com`) yang mampu:
1. **Import produk otomatis ke Shopify** — tempel link Shopee/Tokopedia → ekstrak detail (gambar, varian, harga, deskripsi) → push ke Shopify Admin API.
2. **Analytics ringkas** — sales/orders dari Shopify Admin API + tombol link ke dashboard analytics Shopify (visitor count tidak tersedia via API gratis).
3. **AI layer** — mulai rule-based, struktur pluggable untuk OpenAI/Gemini nanti.

**Stack inti: Next.js (self-host) + Playwright. Tanpa Express. Project terpisah dari storefront.**

---

## 1. Keputusan arsitektur (final)

| Aspek | Keputusan | Alasan |
|---|---|---|
| Framework | **Next.js** (Route Handlers server-side) | Satu bahasa, helper Shopify mudah dipindah, no Express |
| Browser automation | **Playwright** (Chromium asli) | Scraping Shopee/Tokped yang anti-bot butuh render JS |
| Host admin | **Self-host Railway/Fly.io/Render** | Vercel serverless tidak support Playwright (binary + memory + timeout) |
| Host storefront | **Vercel** (tetap) | Ringan, baca Storefront API |
| Struktur repo | **Monorepo** (`apps/storefront` + `apps/admin` + `packages/db`) | Satu source of truth untuk skema Prisma (no drift), isolasi deploy tetap utuh, dependency shared via workspaces |
| Source of truth produk | **Shopify** | Storefront baca Storefront API **live** (`js/data.js:5-23` terverifikasi); Supabase hanya staging import + audit |
| Job queue | **DB-backed** (`ImportJob` status) + in-process worker; optional BullMQ hardening | `next start` fire-and-forget fragile saat restart; wajib recoverable dari status `EXTRACTING/PENDING` |
| Shopify akses | **Admin API** via client credentials grant (sudah ada di `backend/.env`) | Token secret, server-only |
| AI | **Deferred** — rule-based dulu, interface pluggable | User "bebas/belum tentukan"; hindari biaya awal |
| Analytics | **Sales dari Admin API + link Shopify dashboard** | Visitor count tidak diekspos Shopify API gratis |

---

## 2. Yang sudah ada di repo (di-reuse, bukan dibangun ulang)

| Aset | Lokasi | Pemakaian |
|---|---|---|
| Shopify Admin API helper (token caching, REST+GraphQL, client credentials grant) | `backend/scripts/migrate-to-shopify.mjs:199-255` | Pindahkan ke `apps/admin/lib/shopify.ts` |
| Builder payload Shopify (variants, options, images, tags, metafields `bumi`) | `migrate-to-shopify.mjs:258-331` | Template mapping data→Shopify |
| Publish ke Headless channel | `migrate-to-shopify.mjs:334-362` | Agar produk langsung tampil di storefront |
| Verifikasi token | `backend/scripts/verify-shopify.mjs` | Smoke test (pindahkan ke `apps/admin/scripts/`) |
| Kredensial Admin API | `backend/.env` (`SHOPIFY_SHOP/CLIENT_ID/CLIENT_SECRET`) | Pindahkan ke `apps/admin/.env` |
| Admin SPA UI | `admin.html` + `js/admin.js` (1714 lines) + `js/supabase.js` | Pindahkan ke `apps/admin/`, tambah tab Import + widget Analytics |
| Skema Prisma + AuditLog | `backend/prisma/schema.prisma` | Pindahkan ke `packages/db/schema.prisma` (shared), + model `ImportJob` |
| AdminRole enum + create-admin script | `schema.prisma` + `backend/scripts/create-admin.mjs` | Reuse untuk auth gate + bootstrap admin |
| CSS admin | `css/admin.css` + shared CSS | Pindahkan ke `apps/admin/` |
| Storefront Shopify config (live read) | `.env.local` (`NEXT_PUBLIC_SHOPIFY_*`) + `js/data.js:5-23` | Pindahkan ke `apps/storefront/`, tidak berubah |

---

## 3. Struktur target — monorepo

```
bumi-bloom/  (monorepo, pnpm/npm workspaces)
│
├─ apps/
│   ├─ storefront/        → bumiandbloom.com   [Vercel]
│   │     (root saat ini dipindah ke sini: index.html, js/, css/, app/, .env.local)
│   │     baca Shopify Storefront API (public token)
│   │     NEXT_PUBLIC_SHOPIFY_* (public)
│   │
│   └─ admin/             → admin.domain.com   [Railway/Fly self-host]
│         Next.js project, own package.json + .env + Dockerfile
│         ├─ app/
│         │    ├─ layout.tsx, page.tsx          (dashboard + widget analytics)
│         │    ├─ import/page.tsx               (UI import produk)
│         │    ├─ products/page.tsx             (manajemen produk, opsional)
│         │    └─ api/
│         │         ├─ imports/route.ts             POST {url} → enqueue job (202 + jobId)
│         │         ├─ imports/route.ts             GET list riwayat
│         │         ├─ imports/[id]/route.ts        GET status + preview
│         │         ├─ imports/[id]/push/route.ts   POST → create Shopify + publish Headless
│         │         └─ analytics/summary/route.ts   GET ?range=7d|30d → sales/orders
│         ├─ lib/
│         │    ├─ shopify.ts                    (dari migrate-to-shopify.mjs)
│         │    ├─ supabase-server.ts            (service role, server only)
│         │    ├─ scrapers/                     (base.ts, index.ts, shopee.ts, tokopedia.ts)
│         │    ├─ ai/enrich.ts                  (rule-based, pluggable → OpenAI/Gemini)
│         │    ├─ storage.ts                    (re-host gambar → Supabase Storage "products")
│         │    └─ queue.ts                      (in-process worker, drain EXTRACTING jobs on boot)
│         ├─ components/                        (ImportForm, PreviewEditor, ImportHistory, AnalyticsWidget)
│         ├─ Dockerfile                         (Node + Playwright Chromium + deps OS)
│         └─ .env.local
│              SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET   (RAHASIA, server only)
│              SHOPIFY_API_VERSION=2026-10
│              SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY                    (server only)
│              DATABASE_URL, DIRECT_URL                                    (Prisma)
│              AUTH_COOKIE_DOMAIN=.domain.com                              (cross-subdomain session)
│              REDIS_URL?                                                  (opsional, BullMQ hardening)
│
└─ packages/
    └─ db/                 → shared Prisma (SINGLE source of truth)
          ├─ schema.prisma       (dari backend/prisma/schema.prisma + ImportJob)
          ├─ client.ts           (export prisma singleton, dipakai apps/admin)
          └─ package.json        (@bumi/db)
```

**Catatan migrasi:** root saat ini adalah Next.js app tunggal. Fase 1 memindahkannya ke `apps/storefront/` dan menjadikan root monorepo (`pnpm-workspace.yaml` / npm workspaces). Backend Express lama (`backend/`) di-arsipkan — helper Shopify-nya pindah ke `apps/admin/lib/shopify.ts`, skema Prisma-nya pindah ke `packages/db/`.

---

## 4. Data model baru — `ImportJob`

Ditambahkan ke **`packages/db/schema.prisma`** (single shared schema, dipakai `apps/admin` via `@bumi/db`). **Tidak ada duplikasi skema** — anti drift.

```prisma
enum ImportSource { SHOPEE TOKPED OTHER }
enum ImportStatus { PENDING EXTRACTING EXTRACTED PUSHING PUSHED FAILED }

model ImportJob {
  id                String        @id @default(cuid())
  sourceUrl         String
  sourceType        ImportSource  @default(OTHER)
  status            ImportStatus  @default(PENDING)
  rawJson           Json?         // hasil mentah scraper
  extractedJson     Json?         // hasil normalized (siap preview/edit)
  aiJson            Json?         // hasil AI enrichment (jika aktif)
  shopifyProductId  String?
  shopifyHandle     String?
  shopifyAdminUrl   String?
  errorMessage      String?       @db.Text
  createdBy         String?       // actorEmail
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  @@index([status])
  @@index([createdAt])
}
```

Reuse `AuditLog` (aksi: `import.create`, `import.extract`, `import.push`).

---

## 5. Strategi scraping Shopee/Tokopedia

**Realitas:** Shopee & Tokped pakai anti-bot tingkat tinggi (device fingerprint, anti-token signing, captcha, Cloudflare). Chromium asli **belum tentu cukup** — headless mudah terdeteksi. Pendekatan berlapis, realistis:

1. **URL parsing** → `itemid`+`shopid` (Shopee) / `productKey` (Tokopedia).
2. **JSON-LD** `<script type="application/ld+json">` schema.org/Product — paling andal & generic (Playwright ambil `page.content()` lalu parse).
3. **State SSR** — Tokopedia (Next.js) `__NEXT_DATA__`; Shopee endpoint `/api/v4/item/get` (butuh header device + token signing).
4. **Playwright + stealth** (`playwright-extra` + `puppeteer-extra-plugin-stealth`) — render headless dengan fingerprint masking, UA realis, viewport acak, hide `navigator.webdriver`. Wajib untuk Shopee/Tokped; Chromium polos hampir pasti diblok.
5. **Gambar wajib re-host** → download → upload Supabase Storage `products` → public URL absolut. (Shopify CDN tidak bisa fetch URL marketplace yang ber-anti-hotlink/redirect.)
6. **Fallback realistis bila scraping gagal total** → **Shopee Affiliate API** & **Tokopedia Affiliate API** (resmi, butuh pendaftaran partnership). Ini bukan "opsional terakhir" tapi sangat mungkin **menjadi jalur utama** karena scraping dua marketplace ini sering tidak stabil jangka panjang.

Output normalisasi (`scrapers/base.ts`):
```
{ platform, sourceUrl, title, description, price, currency,
  images[], variants[{options, price, sku?}], specs{}, brand? }
```

---

## 6. Endpoint API (Route Handlers, server-side)

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/imports` | body `{url}` → buat `ImportJob(PENDING)`, enqueue ke worker, return `{jobId}` (202) |
| GET | `/api/imports` | list riwayat (paginated) |
| GET | `/api/imports/[id]` | status + preview hasil ekstraksi |
| POST | `/api/imports/[id]/push` | push ke Shopify (create + metafields + publish Headless), simpan `shopifyProductId/adminUrl` |
| GET | `/api/analytics/summary` | `?range=7d|30d` → revenue + order count dari Shopify Admin API (orders query) |

**Job queue (robust):**
- Endpoint hanya **enqueue** (insert `ImportJob(PENDING)`) lalu return 202. **Tidak** fire-and-forget scrape di Route Handler.
- Worker in-process (`lib/queue.ts`) poll `ImportJob` berstatus `PENDING`/`EXTRACTING` dan jalankan scrape secara berurutan.
- **Recovery restart**: saat boot, worker reset semua `EXTRACTING` → `PENDING` lalu drain ulang (idempoten, tidak ada job menggantung selamanya).
- Frontend poll `GET /api/imports/[id]` tiap ~2s sampai `EXTRACTED`.
- **Hardening (Fase 5, optional)**: pindah ke **BullMQ + Redis** untuk retry/backoff/ concurrency control kalau volume import naik. Skema `ImportJob` sudah mendukung status transisi yang dibutuhkan.

---

## 7. Analytics

- **Sales & orders**: Shopify Admin API `orders(first:250, query:"processed_at:>...")` → total revenue, order count, breakdown harian. Render widget di Dashboard.
- **Visitor/session**: tidak tersedia via Shopify Admin API gratis → tombol "Buka Shopify Analytics" → `https://{shop}.myshopify.com/admin/reports`.
- (Opsional belakangan) visitor independen: isi placeholder GA4 di `js/analytics.js` (`G-XXXXXXXXXX`) → tarik GA4 Data API.

---

## 8. AI layer (terstruktur, mulai non-AI)

`lib/ai/enrich.ts` — rule-based dulu:
- Strip noise title (`[COD]`, `Ready Stock`, emoji berlebih).
- Konversi deskripsi HTML mentah → teks/HTML bersih.
- Auto-suggest `product_type` dari kata kunci.
- Generate `handle` (slug) dari title.

Interface pluggable `enrich(extracted): Promise<enriched>` → nanti swap ke OpenAI/Gemini tanpa ubah route. AI calon: translate ID→EN, SEO copy, alt-text gambar (vision), dedupe varian.

---

## 9. Subdomain `admin.domain.com` & Auth admin

**Subdomain:**
- **DNS**: CNAME `admin` → host Railway/Fly (atau proxy via Vercel jika perlu).
- **Vercel**: storefront project tetap; admin project = host self-host sendiri.
- **Keamanan**: `noindex,nofollow` ketat, COOP/COEP, Supabase RLS admin-only.
- **Env**: secrets (`SHOPIFY_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) hanya di `apps/admin/.env`, **tidak pernah** di storefront.

**Auth admin (detail):**
- **Mekanisme**: reuse **Supabase Auth** (email/password, sudah dipakai `js/admin.js` + `js/supabase.js`). Session = JWT + refresh token di cookie.
- **Cross-subdomain session**: set cookie domain `AUTH_COOKIE_DOMAIN=.domain.com` agar session dari login admin domain bisa dibaca (atau lebih ketat: login hanya di `admin.domain.com`, cookie scoped ke subdomain itu saja — **recommended**, tidak share cookie dengan storefront).
- **Server-side gate**: Route Handlers `/api/imports*` & `/api/analytics*` verifikasi session via Supabase `auth.getUser(jwt)` di setiap request sebelum eksekusi. Tolak 401 kalau invalid.
- **Server-side Supabase**: `lib/supabase-server.ts` pakai **service role key** untuk write `ImportJob`/`AuditLog` (bypass RLS, karena admin sudah terverifikasi via auth gate). Anon key + RLS tetap untuk read publik.
- **Roles**: reuse enum `AdminRole` (`SUPER_ADMIN`/`MARKETPLACE_ADMIN`/`CONTENT_EDITOR`/`SUPPORT`) dari schema. Import & push = `MARKETPLACE_ADMIN`+.
- **Bootstrap admin**: reuse `backend/scripts/create-admin.mjs` (pindahkan ke `packages/db/scripts/` atau `apps/admin/scripts/`).

---

## 10. Dependency & hosting

**`apps/admin/package.json`:**
- `next`, `react`, `react-dom`
- `@bumi/db` (workspace, shared Prisma) → `@prisma/client`, `prisma`
- `@supabase/supabase-js`
- `playwright` + `playwright-extra` + `puppeteer-extra-plugin-stealth` (anti-bot masking)
- `ioredis` + `bullmq` (**optional**, Fase 5 — kalau volume import naik)
- (nanti) `openai` | `@google/generative-ai` saat AI diaktifkan

**`packages/db/package.json`:** `@prisma/client`, `prisma` (single schema source).

**Dockerfile (self-host, `apps/admin/Dockerfile`):** Node + Playwright deps OS (`libnss3`, `libatk1.0`, `libgbm1`, `libasound2`, dll) + `npx playwright install --with-deps chromium`.

**Host:** Railway / Fly.io / Render (~$5/bln). Bukan Vercel (Playwright + long-running worker butuh persistent process).

**Storefront (`apps/storefront`):** tetap Vercel, tidak berubah.

---

## 11. Roadmap implementasi

| Fase | Deliverable | Status |
|---|---|---|
| **1 — Monorepo & fondasi** | Ubah root → monorepo (`apps/storefront` + `apps/admin` + `packages/db`), pindahkan storefront ke `apps/storefront/`, scaffold `apps/admin/` (Next.js), pindahkan admin assets, `lib/shopify.ts` (dari `migrate-to-shopify.mjs`), `lib/supabase-server.ts`, **auth gate** (Supabase Auth session + verifikasi server-side + roles), model `ImportJob` di shared `packages/db`, Dockerfile Playwright. | Menunggu konfirmasi |
| **2 — Scraper + queue** | Worker in-process `lib/queue.ts` (enqueue + recovery restart), adapter Tokped + Shopee (Playwright **+ stealth** + JSON-LD), re-host gambar ke Supabase Storage, Route `/api/imports`. | |
| **3 — Push to Shopify** | Route `/api/imports/[id]/push` (reuse builder + publish Headless) + UI Import (form, preview editable, riwayat). | |
| **4 — Analytics** | Route `/api/analytics/summary` + widget Dashboard + link Shopify. | |
| **5 — Hardening/opsional** | BullMQ + Redis (retry/backoff/concurrency), AI enrichment (OpenAI/Gemini), Shopee/Tokped **Affiliate API** fallback bila scrape tidak stabil, GA4 visitor independen. | |

---

## 12. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| **Anti-bot Shopee/Tokped tinggi** (fingerprint, anti-token, captcha) | Playwright + stealth plugin; bila headless tetap diblok → **Affiliate API resmi** sebagai jalur utama (bukan terakhir). Realistis: scraping dua marketplace ini sering tidak stabil jangka panjang |
| Worker in-flight hilang saat container restart | `ImportJob` DB-backed; boot recovery reset `EXTRACTING`→`PENDING` lalu drain ulang (idempoten) |
| Gambar marketplace anti-hotlink | Wajib re-host ke Supabase Storage (bukan pakai URL asli) |
| Rate limit Shopify | Helper hormati leaky bucket (`sleep` saat bucket tipis) — dipertahankan |
| Token Admin client-credentials expire | Caching + auto-refresh sudah ada di helper |
| Playwright memory di self-host | Resource limit container + `--single-process` + restart policy; concurrency worker = 1 (serial) di awal |
| Duplikasi skema Prisma | Tidak ada — single shared schema di `packages/db/`, dipakai via workspace `@bumi/db` |
| Dual katalog (Supabase lama vs Shopify) | Supabase katalog lama = arsip; source of truth = Shopify (storefront baca live). Import baru hanya tulis Shopify + staging `ImportJob` |

---

## 13. Yang TIDAK dilakukan (out of scope, untuk sekarang)

- Tidak menyentuh storefront root (kecuali pasti tidak konflik).
- Tidak sinkronisasi dua arah Supabase↔Shopify.
- Tidak migrasi data Supabase lama ke Shopify (sudah ada `migrate-to-shopify.mjs` terpisah).
- Tidak AI berbayar di Fase 1–4.
- Tidak menambah Express backend.
