import bcrypt from "bcryptjs";
import { prisma } from "./db.js";

export interface AdminSessionUser {
  id: string;
  email: string;
  role: string;
  name: string | null;
}

/** AdminJS authenticate handler. Returns the user (truthy) on success, null otherwise. */
export async function authenticateAdmin(email: string, password: string): Promise<AdminSessionUser | null> {
  const user = await prisma.adminUser.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user || !user.isActive) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  // Best-effort: stamp last login without failing the login on a transient error.
  prisma.adminUser
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => undefined);

  return { id: user.id, email: user.email, role: user.role, name: user.name };
}

/** True if the current admin holds one of the allowed roles (or any role when none given). */
export function hasRole(user: AdminSessionUser | null | undefined, ...roles: string[]): boolean {
  if (!user) return false;
  return roles.length === 0 || roles.includes(user.role);
}
