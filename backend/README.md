# Bumi & Bloom — Backend (read-only API)

Supabase (Postgres + Storage) + Prisma + Express (TypeScript).

The backend is now a **stateless read-only API** (`/api`) plus a `/health`
check. The admin UI is the storefront's `admin.html`, which talks to Supabase
directly (RLS-gated) — AdminJS has been removed from this service.

## Prerequisites

- Node 20+
- A Supabase project (https://supabase.com): grab the **pooler** + **direct**
  connection strings and the **service-role** key from *Project Settings*.

## Setup

```bash
cd backend
cp .env.example .env      # then fill in your Supabase values
npm install
npx prisma generate
npm run db:push           # or: npm run db:migrate  (creates tables in Supabase)
npm run db:seed           # seeds brands + 15 products + WELCOME10 + bootstrap admin
npm run dev               # http://localhost:4000  (API at /api, health at /health)
```

## Storage buckets

Create three **public** buckets in Supabase → Storage: `products`, `brands`,
`editorial`. The admin page's image upload writes to `products`. Uploads are
validated: JPEG/PNG/WebP/GIF only, 5 MB cap — SVG is rejected on purpose
(stored-XSS vector on a public bucket).

## Row Level Security

RLS is enabled on all tables. Policies live in `supabase/setup-rls.sql`
(idempotent — safe to re-run) and are applied with:

```bash
node scripts/apply-rls.mjs   # uses DIRECT_URL from .env
```

Public (anon key) can read published, non-deleted catalog rows and active
promotions only. Admins read their own `AdminUser` row — `passwordHash` is never
exposed via the API; use the `AdminUserSafe` view if you need a hash-free
listing. The storefront's promo codes come from the `Promotion` table
(`js/cart.js` fetches them on page load), so admin edits apply without a deploy.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Run the API with tsx (hot reload). |
| `npm run build` / `start` | Compile to `dist/` and run. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run db:push` | Push schema to DB (fast iteration; no migration history). |
| `npm run db:migrate` | Create/apply a Prisma migration. |
| `npm run db:seed` | Idempotent seed from `prisma/seed-data.ts`. |
| `npm run db:deploy` | `migrate deploy` + seed (for production releases). |
| `npm run db:studio` | Prisma Studio GUI. |

## Architecture notes

- **Two DB URLs:** runtime uses the pooler (`DATABASE_URL`), migrations use the
  direct connection (`DIRECT_URL`). See `prisma/schema.prisma`.
- **Authorization is enforced by Postgres RLS** for the admin page (Supabase
  Auth). Prisma connects as the service-role superuser and bypasses RLS, but
  this service only exposes read endpoints.
- **Admin identity:** staff are Supabase Auth users (see
  `scripts/create-auth-user.mjs`); `AdminUser` rows (bcrypt `passwordHash`,
  seeded from `ADMIN_BOOTSTRAP_EMAIL`/`ADMIN_BOOTSTRAP_PASSWORD`) remain for
  legacy tooling such as `scripts/create-admin.mjs`.
- **Stateless:** no sessions, no cookies — the API scales horizontally as-is.
