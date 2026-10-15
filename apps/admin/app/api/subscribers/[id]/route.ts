export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  let ctx;
  try {
    ctx = await requireAdmin(["SUPER_ADMIN", "CONTENT_EDITOR"]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body JSON tidak valid");
  }

  const newStatus = body?.status;
  if (!["ACTIVE", "UNSUBSCRIBED"].includes(newStatus)) {
    return jsonError(400, "Field `status` must be ACTIVE or UNSUBSCRIBED");
  }

  try {
    const existing = await prisma.newsletterSubscriber.findUnique({
      where: { id: params.id },
    });
    if (!existing) return jsonError(404, "Subscriber not found");

    const updated = await prisma.newsletterSubscriber.update({
      where: { id: params.id },
      data: {
        status: newStatus,
        unsubscribedAt:
          newStatus === "UNSUBSCRIBED" ? new Date() : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorEmail: ctx.email,
        action: `subscriber.${newStatus === "UNSUBSCRIBED" ? "unsubscribe" : "reactivate"}`,
        entity: "NewsletterSubscriber",
        entityId: params.id,
      },
    });

    return NextResponse.json({ subscriber: updated });
  } catch (err: any) {
    console.error("[subscribers] PATCH error:", err);
    return jsonError(500, "Failed to update subscriber");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  let ctx;
  try {
    ctx = await requireAdmin(["SUPER_ADMIN"]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  try {
    const existing = await prisma.newsletterSubscriber.findUnique({
      where: { id: params.id },
    });
    if (!existing) return jsonError(404, "Subscriber not found");

    await prisma.newsletterSubscriber.delete({ where: { id: params.id } });

    await prisma.auditLog.create({
      data: {
        actorEmail: ctx.email,
        action: "subscriber.delete",
        entity: "NewsletterSubscriber",
        entityId: params.id,
        detail: { email: existing.email },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[subscribers] DELETE error:", err);
    return jsonError(500, "Failed to delete subscriber");
  }
}
