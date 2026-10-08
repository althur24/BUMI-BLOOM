import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Temporary diagnostic: isolates whether Prisma connects + which table errors.
// Auth-gated. Remove after debugging.
export async function GET() {
  try {
    await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, `auth: ${e?.message || e}`);
  }

  const out: Record<string, unknown> = {
    dbUrlSet: Boolean(process.env.DATABASE_URL),
    directUrlSet: Boolean(process.env.DIRECT_URL),
    supabaseUrlSet: Boolean(process.env.SUPABASE_URL),
  };

  try {
    out.rawSelect = await prisma.$queryRaw`SELECT 1 AS ok`;
  } catch (e: any) {
    out.rawSelectError = `${e?.name}: ${e?.message || e}`;
  }

  try {
    out.importJobCount = await prisma.importJob.count();
  } catch (e: any) {
    out.importJobError = `${e?.name}: ${e?.message || e}`;
  }

  try {
    out.adminUserCount = await prisma.adminUser.count();
  } catch (e: any) {
    out.adminUserError = `${e?.name}: ${e?.message || e}`;
  }

  return NextResponse.json(out);
}
