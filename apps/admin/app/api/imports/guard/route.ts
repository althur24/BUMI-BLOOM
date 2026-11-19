import { NextResponse } from "next/server";
import { requireAdmin, jsonError } from "@/lib/auth";
import { scrapeGuard } from "@/lib/scrape-guard";

export const dynamic = "force-dynamic";

// GET /api/imports/guard → current throttle/cooldown state, so the import UI can
// show a banner and disable the button instead of letting the user run into a
// 429/timeout. Returns limits (config) plus per-domain usage.
export async function GET() {
  try {
    await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }
  return NextResponse.json(scrapeGuard.snapshot());
}
