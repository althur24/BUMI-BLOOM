# Bumi & Bloom — Backend (Admin/CMS)

Supabase (Postgres + Storage) + Prisma + Express (TypeScript) + AdminJS.

Phase 1 delivers an **AdminJS dashboard** (`/admin`) for staff to manage brands,
products, variants, images, categories, collections and promotions. The catalog
data model moves out of the frontend's hardcoded `js/data.js` into Postgres.
Payment gateway, customer auth and the public storefront API are **later phases**.

> Note: AdminJS v7+ is **ESM-only**, so this package is `"type": "module"`.

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
npm run dev               # http://localhost:4000  (admin at /admin)
```

Sign in to `/admin` with `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`.

## Storage buckets

Create three **public** buckets in Supabase → Storage: `products`, `brands`,
`editorial`. The admin's image upload writes to `products`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Run the API + admin with tsx (hot reload). |
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
- **Authorization is in the app layer, not Postgres RLS.** Prisma connects as
  the service-role superuser and bypasses RLS, so role checks live in
  AdminJS + query filters.
- **Auth:** staff log in via AdminJS session auth (bcrypt, `AdminUser` table).
  Customer auth via Supabase Auth is a separate, later identity store.

See `../<plan>` for the full phase-1 plan and the deferred-features roadmap.
