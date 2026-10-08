import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET → single import job status + extracted preview (for polling).
export async function GET(
  request: Request,
  context: { params: { id: string } },
) {
  try {
    await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  const job = await prisma.importJob.findUnique({
    where: { id: context.params.id },
  });
  if (!job) return jsonError(404, "Import job tidak ditemukan");

  return NextResponse.json({ job });
}
