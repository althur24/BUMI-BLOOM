import { prisma } from "@bumi/db";
import { getUserFromJwt } from "./supabase-server";

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

// Verifies the Bearer JWT, then re-checks the role against AdminUser (Prisma)
// by email. The client is never trusted to assert its own role.
export async function requireAdmin(
  request: Request,
  roles: AdminRole[] = IMPORT_ROLES,
): Promise<AdminContext> {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw httpError(401, "Missing bearer token");

  const user = await getUserFromJwt(match[1]);
  if (!user || !user.email) throw httpError(401, "Invalid session");

  const admin = await prisma.adminUser.findUnique({
    where: { email: user.email },
  });
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
