export const dynamic = "force-dynamic";

import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";

function csvEscape(value: string | null | undefined): string {
  if (value == null) return "";
  const needsQuoting = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireAdmin(["SUPER_ADMIN", "CONTENT_EDITOR"]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const validStatuses = ["ACTIVE", "UNSUBSCRIBED"];
  const statusFilter =
    status && validStatuses.includes(status)
      ? (status as "ACTIVE" | "UNSUBSCRIBED")
      : undefined;

  try {
    const subscribers = await prisma.newsletterSubscriber.findMany({
      where: statusFilter ? { status: statusFilter } : {},
      orderBy: { subscribedAt: "desc" },
      select: {
        email: true,
        status: true,
        source: true,
        subscribedAt: true,
        unsubscribedAt: true,
      },
    });

    const header = ["email", "status", "source", "subscribed_at", "unsubscribed_at"];
    const rows = subscribers.map((s) =>
      [
        csvEscape(s.email),
        csvEscape(s.status),
        csvEscape(s.source),
        csvEscape(s.subscribedAt.toISOString()),
        csvEscape(s.unsubscribedAt?.toISOString() || ""),
      ].join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");
    const dateStr = new Date().toISOString().slice(0, 10);

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="subscribers-${dateStr}.csv"`,
      },
    });
  } catch (err: any) {
    console.error("[subscribers] export error:", err);
    return jsonError(500, "Failed to export subscribers");
  }
}
