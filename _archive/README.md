# Archived: hand-built admin panel

**Status:** retired. The supported admin is the in-site **`admin.html`** page,
which talks to Supabase directly (RLS-gated). The backend's former AdminJS
dashboard (`http://localhost:4000/admin`) has also been removed — the backend
is now only a stateless read-only API + health check (see `backend/README.md`).

## Why it was retired

- It used a second, disconnected identity system (Supabase Auth) that nothing in
  the repo provisioned — admin users only exist in the `AdminUser` table for
  AdminJS (bcrypt).
- Its RLS path granted every admin full write access to all tables regardless of
  role, bypassed the `AuditLog`, and read `AdminUser` rows including
  `passwordHash` (since fixed at the policy level: admins can now only read
  their own row, and the `AdminUserSafe` view omits the hash).

## Contents

- `pages/` — the old static admin HTML (was `admin/`), including the original
  `setup-rls.sql` (superseded by `backend/supabase/setup-rls.sql`).
- `js/` — the panel's scripts (was `js/admin-*.js`).
- `css/` — the panel's stylesheet (was `css/admin.css`).

Nothing here is referenced by the storefront or the backend. Restore only if you
intend to rebuild it on top of the current RLS policies.
