export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";

// Product priority per brand for the Shop All ordering (see the storefront's
// brandRank / 'brand-priority' sort). GET is public (storefront cross-origin
// read, same pattern as /api/hero-cards) — it only exposes brand keys.

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  const headers = corsHeaders(request);
  try {
    const rows = await prisma.brandOrder.findMany({
      select: { brandKey: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(
      { order: rows.map((r) => ({ brandKey: r.brandKey, sortOrder: r.sortOrder })) },
      { headers },
    );
  } catch (err: any) {
    // Most likely the BrandOrder table does not exist yet (migration not run).
    // Degrade to the storefront's default fallback order instead of breaking.
    console.error("[brand-order] GET error:", err?.message || err);
    return NextResponse.json({ order: [] }, { headers });
  }
}

export async function PUT(request: Request) {
  let ctx;
  try {
    ctx = await requireAdmin(["SUPER_ADMIN", "CONTENT_EDITOR", "SUPPORT"]);
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const input = Array.isArray(body?.order) ? body.order : null;
  if (!input) return jsonError(400, "order must be an array");

  // Normalise: trim keys, drop empties, keep the first occurrence of a key.
  const seen = new Set<string>();
  const order: { brandKey: string; sortOrder: number }[] = [];
  for (const item of input) {
    const key = typeof item?.brandKey === "string" ? item.brandKey.trim() : "";
    if (!key || key.length > 255 || /\s/.test(key)) {
      return jsonError(400, "brandKey must be a non-empty, whitespace-free string");
    }
    if (seen.has(key)) continue;
    seen.add(key);
    order.push({ brandKey: key, sortOrder: order.length });
  }

  // An empty order would delete every row. That only happens on an empty brand
  // list (UI disables the button), so reject it rather than silently wiping
  // the saved order — the client should never send this.
  if (order.length === 0) {
    return jsonError(400, "order must contain at least one brand");
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Replace the whole ordering: drop rows no longer present, upsert the rest.
      const keep = order.map((o) => o.brandKey);
      await tx.brandOrder.deleteMany({ where: { brandKey: { notIn: keep } } });
      await Promise.all(
        order.map((o) =>
          tx.brandOrder.upsert({
            where: { brandKey: o.brandKey },
            create: { brandKey: o.brandKey, sortOrder: o.sortOrder },
            update: { sortOrder: o.sortOrder },
          }),
        ),
      );
    });
    return NextResponse.json({ ok: true, order });
  } catch (err: any) {
    console.error("[brand-order] PUT error:", err?.message || err);
    return jsonError(500, "Failed to save brand order");
  }
}
