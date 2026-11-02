// URL helpers for the import pipeline: canonicalisation (so the same product
// pasted with different tracking params maps to one job) and safe resolution.

const TRACKING_PARAMS = new Set([
  "extparam",
  "aff_unique_id",
  "aff_unique",
  "channel",
  "chain_key",
  "fbclid",
  "gclid",
  "igshid",
  "spm",
  "scm",
  "share",
  "share_id",
  "from",
  "source",
  "ref",
  "referrer",
  "trk",
  "tracking",
  "gclsrc",
  "dclid",
  "msclkid",
  "twclid",
  "ttclid",
]);

function isTrackingKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

export function canonicalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return String(raw || "").trim();
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return u.href;

  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if (
    (u.protocol === "http:" && u.port === "80") ||
    (u.protocol === "https:" && u.port === "443")
  ) {
    u.port = "";
  }
  // Normalise a trailing slash but keep meaningful path segments.
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";

  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (!isTrackingKey(k)) kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);
  return u.href;
}

export function resolveUrl(base: string, maybeRelative: string): string | null {
  const raw = String(maybeRelative || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("javascript:")) return null;
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}
