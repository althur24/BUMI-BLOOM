export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import { requireAdmin, jsonError } from "@/lib/auth";

// The storefront homepage (different origin) fetches the current hero card
// slots client-side, so GET is public and CORS-enabled — same pattern as
// /api/subscribe. Only Shopify product handles are exposed, nothing sensitive.
const ALLOWED_ORIGIN = process.env.STOREFRONT_URL || "*";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Selectable hero slots. 2/4 are fixed character cards on the storefront.
const HERO_POSITIONS = [1, 3, 5] as const;

export async function GET() {
  try {
    const rows = await prisma.heroCard.findMany({
      select: { position: true, productHandle: true },
    });
    return NextResponse.json(
      {
        cards: HERO_POSITIONS.map((position) => ({
          position,
          productHandle: rows.find((r) => r.position === position)?.productHandle ?? null,
        })),
      },
      { headers: corsHeaders() },
    );
  } catch (err: any) {
    // Most likely the HeroCard table does not exist yet (migration not run).
    // Degrade to "all default illustrations" instead of breaking the homepage.
    console.error("[hero-cards] GET error:", err?.message || err);
    return NextResponse.json(
      { cards: HERO_POSITIONS.map((position) => ({ position, productHandle: null })) },
      { headers: corsHeaders() },
    );
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

  const input = Array.isArray(body?.cards) ? body.cards : null;
  if (!input) return jsonError(400, "cards must be an array");

  // Normalise: keep only valid positions, drop duplicates (last wins).
  const slots = new Map<number, string | null>();
  for (const card of input) {
    const position = Number(card?.position);
    if (!HERO_POSITIONS.includes(position as (typeof HERO_POSITIONS)[number])) {
      return jsonError(400, `Position ${card?.position} is not a selectable hero slot`);
    }
    const handle =
      typeof card?.productHandle === "string" ? card.productHandle.trim() : null;
    if (handle && (handle.length > 255 || /\s/.test(handle))) {
      return jsonError(400, "productHandle must be a valid Shopify handle");
    }
    slots.set(position, handle || null);
  }

  try {
    await Promise.all(
      [...slots.entries()].map(([position, productHandle]) =>
        prisma.heroCard.upsert({
          where: { position },
          create: { position, productHandle },
          update: { productHandle },
        }),
      ),
    );
    return NextResponse.json({ ok: true, cards: [...slots.entries()].map(([position, productHandle]) => ({ position, productHandle })) });
  } catch (err: any) {
    console.error("[hero-cards] PUT error:", err?.message || err);
    return jsonError(500, "Failed to save hero cards");
  }
}
