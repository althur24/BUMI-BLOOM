// Bootstrap an admin: creates a Supabase Auth user + an AdminUser row.
// Env-only — NEVER hardcodes keys. Run from repo root:
//   npx tsx --env-file=apps/admin/.env.local packages/db/scripts/create-admin.ts
// (Override email/password/role via ADMIN_BOOTSTRAP_EMAIL / _PASSWORD / _ROLE.)

import { createClient } from "@supabase/supabase-js";
import { prisma } from "../client";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL || "admin@bumibloom.example";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || "BumiBloom2026!";
const ROLE = (process.env.ADMIN_BOOTSTRAP_ROLE || "SUPER_ADMIN") as
  | "SUPER_ADMIN"
  | "MARKETPLACE_ADMIN"
  | "CONTENT_EDITOR"
  | "SUPPORT";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "✗ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Load env, e.g.:\n" +
      "  npx tsx --env-file=apps/admin/.env.local packages/db/scripts/create-admin.ts",
  );
  process.exit(1);
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  console.log(`1) Supabase Auth user: ${EMAIL}`);
  const { error } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) {
    if (/already (exists|registered)/i.test(error.message)) {
      console.log("   ✓ already exists in Auth");
    } else {
      console.error("   ✗ createUser failed:", error.message);
      process.exit(1);
    }
  } else {
    console.log("   ✓ created in Auth");
  }

  console.log("2) AdminUser row");
  const existing = await prisma.adminUser.findUnique({ where: { email: EMAIL } });
  if (!existing) {
    await prisma.adminUser.create({
      data: {
        email: EMAIL,
        passwordHash: "supauth", // unused — auth via Supabase Auth
        name: "Store Admin",
        role: ROLE,
        isActive: true,
      },
    });
    console.log("   ✓ created");
  } else {
    console.log("   ✓ already exists");
  }

  console.log(`\n✅ Done. Login at /login with ${EMAIL} / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
