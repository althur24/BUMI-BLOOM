import { NextResponse } from "next/server";
import { requireAdmin, jsonError } from "@/lib/auth";
import { fetchWithProxy } from "@/lib/proxy";
import { scrapeGuard } from "@/lib/scrape-guard";

export const dynamic = "force-dynamic";

// GET /api/imports/diagnose
// Runs ONE fetch from the SERVER (Railway) to a fixed marketplace URL and
// reports whether egress is blocked there. Used to tell a datacenter-IP block
// apart from a temporary cooldown. The target is hardcoded (no arbitrary URL →
// no SSRF) and the request counts toward the scrape guard so it can never be
// used to hammer the marketplace.
const TARGET = "https://www.tokopedia.com/";
const TARGET_DOMAIN = "www.tokopedia.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Admin session, or a shared key (IMPORT_DIAG_KEY) so it can be called from CI
// / curl without a browser session.
async function authorized(request: Request): Promise<boolean> {
  const key = (process.env.IMPORT_DIAG_KEY || "").trim();
  if (key) {
    const provided = new URL(request.url).searchParams.get("key");
    if (provided && provided === key) return true;
  }
  try {
    await requireAdmin();
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!(await authorized(request))) return jsonError(401, "Unauthorized");

  const usingProxy = Boolean((process.env.IMPORT_PROXY_URL || "").trim());

  // Respect the guard: if the domain is paused/capped, report that instead of
  // firing another request.
  const gate = scrapeGuard.check(TARGET_DOMAIN);
  if (!gate.ok && gate.reason !== "interval") {
    return NextResponse.json({
      ok: false,
      blocked: true,
      reason: gate.reason,
      retryAfterSeconds: Math.ceil(gate.retryAfterMs / 1000),
      message: gate.message,
      usingProxy,
    });
  }

  scrapeGuard.record(TARGET_DOMAIN);
  const started = Date.now();
  try {
    const res = await fetchWithProxy(TARGET, {
      headers: { "User-Agent": UA, "Accept-Language": "id,ID;q=0.9,en;q=0.8" },
      timeoutMs: 15_000,
    });
    const html = await res.text();
    const captcha = /captcha|verify you are human|unusual traffic/i.test(html.slice(0, 4000));
    const hasCache = html.includes("window.__cache");
    const ok = res.ok && !captcha;
    if (!ok) scrapeGuard.noteFailureKind(TARGET_DOMAIN, "block");
    return NextResponse.json({
      ok,
      stage: "http",
      target: TARGET,
      status: res.status,
      ms: Date.now() - started,
      captcha,
      hasCache,
      usingProxy,
    });
  } catch (e: any) {
    const kind = scrapeGuard.noteFailure(TARGET_DOMAIN, e);
    return NextResponse.json({
      ok: false,
      stage: "http",
      target: TARGET,
      ms: Date.now() - started,
      kind, // "block" | "network" | "other"
      error: e?.message || String(e),
      cause: e?.cause?.code || e?.cause?.message || null,
      usingProxy,
    });
  }
}
