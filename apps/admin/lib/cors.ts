// Shared CORS for the endpoints the storefront calls cross-origin
// (/api/hero-cards, /api/subscribe).
//
// STOREFRONT_URL may hold several comma-separated origins (e.g. the canonical
// domain plus a Vercel preview). Access-Control-Allow-Origin only accepts ONE
// value — echoing the raw env string makes browsers reject the response — so
// the request's Origin is matched against the allow-list and a single origin is
// echoed back. Always set Vary: Origin so caches don't serve the wrong value.

function allowedOrigins(): string[] {
  return (process.env.STOREFRONT_URL || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origins = allowedOrigins();
  const requestOrigin = (request.headers.get("origin") || "").replace(/\/+$/, "");

  let origin: string;
  if (origins.length === 0) {
    // Not configured (local dev): mirror the caller so checks keep working.
    origin = requestOrigin || "*";
  } else if (requestOrigin && origins.includes(requestOrigin)) {
    origin = requestOrigin;
  } else {
    // Unknown/absent Origin (curl, server-to-server). Return the canonical
    // origin so state-changing requests still pass the same-origin check for
    // a listed domain while never echoing an arbitrary caller.
    origin = origins[0];
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}
