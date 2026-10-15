export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";

const ALLOWED_ORIGIN = process.env.STOREFRONT_URL || "*";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ── Rate limiting (in-memory, per-IP) ───────────────────────────────────────
// Max 5 subscribe attempts per IP per 60s window. Prevents spam.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const ipHits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length > RATE_MAX;
}

function getClientIP(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  const headers = corsHeaders();

  // Rate limit
  const ip = getClientIP(request);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers },
    );
  }

  // Parse body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers },
    );
  }

  // Validate email
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400, headers },
    );
  }

  // Validate source (optional)
  const validSources = ["HOMEPAGE", "BRANDS", "JOURNAL"];
  const source =
    typeof body?.source === "string" && validSources.includes(body.source)
      ? body.source
      : null;

  try {
    // Upsert: if already unsubscribed → reactivate; if already active → no-op
    await prisma.newsletterSubscriber.upsert({
      where: { email },
      create: { email, source, status: "ACTIVE" },
      update: {
        status: "ACTIVE",
        unsubscribedAt: null,
        ...(source ? { source } : {}),
      },
    });

    return NextResponse.json(
      { ok: true, code: "WELCOME10" },
      { status: 200, headers },
    );
  } catch (err: any) {
    console.error("[subscribe] DB error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500, headers },
    );
  }
}
