import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import type { ImportSource } from "@prisma/client";
import { requireAdmin, jsonError } from "@/lib/auth";
import { enqueue } from "@/lib/queue";
import { detectPlatform } from "@/lib/platform";

export const dynamic = "force-dynamic";

// POST { url } → enqueue a scrape job. Returns 202 + jobId.
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body JSON tidak valid");
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    return jsonError(400, "Field `url` wajib dan harus berupa URL http(s).");
  }

  const platform = detectPlatform(url);
  if (platform === "OTHER") {
    return jsonError(400, "Hanya link Shopee atau Tokopedia yang didukung.");
  }

  const job = await prisma.importJob.create({
    data: {
      sourceUrl: url,
      sourceType: platform as ImportSource,
      status: "PENDING",
      createdBy: ctx.email,
    },
  });
  void enqueue(job.id);

  return NextResponse.json(
    { jobId: job.id, status: "PENDING", platform },
    { status: 202 },
  );
}

// GET → list recent import jobs (newest first), paginated.
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  const u = new URL(request.url);
  const page = Math.max(1, Number(u.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number(u.searchParams.get("pageSize")) || 20),
  );

  const [jobs, total] = await Promise.all([
    prisma.importJob.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.importJob.count(),
  ]);

  return NextResponse.json({ jobs, page, pageSize, total });
}
