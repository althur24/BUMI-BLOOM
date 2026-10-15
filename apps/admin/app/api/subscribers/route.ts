export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireAdmin(["SUPER_ADMIN", "CONTENT_EDITOR", "SUPPORT"]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize")) || 20),
  );
  const search = url.searchParams.get("search")?.trim() || "";
  const status = url.searchParams.get("status");

  const validStatuses = ["ACTIVE", "UNSUBSCRIBED"];
  const statusFilter =
    status && validStatuses.includes(status)
      ? (status as "ACTIVE" | "UNSUBSCRIBED")
      : undefined;

  const where = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(search
      ? { email: { contains: search, mode: "insensitive" as const } }
      : {}),
  };

  try {
    const [subscribers, total] = await Promise.all([
      prisma.newsletterSubscriber.findMany({
        where,
        orderBy: { subscribedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          status: true,
          source: true,
          subscribedAt: true,
          unsubscribedAt: true,
        },
      }),
      prisma.newsletterSubscriber.count({ where }),
    ]);

    const [totalAll, totalActive, newThisWeek] = await Promise.all([
      prisma.newsletterSubscriber.count(),
      prisma.newsletterSubscriber.count({ where: { status: "ACTIVE" } }),
      prisma.newsletterSubscriber.count({
        where: {
          subscribedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return NextResponse.json({
      subscribers,
      page,
      pageSize,
      total,
      stats: { totalAll, totalActive, newThisWeek },
    });
  } catch (err: any) {
    console.error("[subscribers] GET error:", err);
    return jsonError(500, "Failed to fetch subscribers");
  }
}
