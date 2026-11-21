import { prisma } from "@bumi/db";
import { getServerUser } from "./supabase-server";
import { cacheGet, cacheSet } from "./cache";

// Roles mirror the Prisma AdminRole enum (packages/db/schema.prisma).
export type AdminRole =
  | "SUPER_ADMIN"
  | "MARKETPLACE_ADMIN"
  | "CONTENT_EDITOR"
  | "SUPPORT";

export interface AdminContext {
  userId: string;
  email: string;
  role: AdminRole;
}

// Roles permitted to import + push products to Shopify.
const IMPORT_ROLES: AdminRole[] = ["SUPER_ADMIN", "MARKETPLACE_ADMIN"];

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

// Verifies the signed-in user from the cookie session (via @supabase/ssr),
// then re-checks the role against AdminUser (Prisma) by email. The client is
// never trusted to assert its own role.
const ADMIN_LOOKUP_TTL_MS = 60_000;

interface AdminLookup {
  email: string;
  role: string;
  isActive: boolean;
}

export async function requireAdmin(
  roles: AdminRole[] = IMPORT_ROLES,
): Promise<AdminContext> {
  const user = await getServerUser();
  if (!user || !user.email) throw httpError(401, "Invalid session");

  // Role checks happen on every API request; cache the DB lookup briefly so a
  // page that calls several endpoints does not query AdminUser each time.
  const cacheKey = `auth:admin:${user.email.toLowerCase()}`;
  let admin = cacheGet<AdminLookup>(cacheKey);
  if (!admin) {
    const row = await prisma.adminUser.findUnique({
      where: { email: user.email },
    });
    if (row) {
      admin = { email: row.email, role: row.role, isActive: row.isActive };
      cacheSet(cacheKey, admin, ADMIN_LOOKUP_TTL_MS);
    }
  }
  if (!admin || !admin.isActive) throw httpError(401, "Not an active admin");

  if (!roles.includes(admin.role as AdminRole)) {
    throw httpError(403, `Role ${admin.role} not permitted`);
  }

  return { userId: user.id, email: admin.email, role: admin.role as AdminRole };
}

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}
