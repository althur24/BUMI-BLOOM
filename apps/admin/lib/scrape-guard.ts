// Scrape guard — throttle + hourly cap + circuit breaker for marketplace fetches.
//
// Tokopedia/Shopee rate-limit abusive clients and temporarily block an IP
// (observed: a burst of requests makes the host reset/time-out the connection
// for a cooldown period). This guard spaces requests, caps hourly volume and,
// once a block is detected, pauses the domain instead of hammering it.
//
// State is in-memory: the import worker runs single-instance with concurrency 1
// (see queue.ts). If the service is ever scaled horizontally, move this state to
// Redis (or Postgres) so replicas share the same view.

export type GuardReason = "cooldown" | "interval" | "hourly";

export interface GuardConfig {
  // Minimum gap between two requests to the same domain.
  minIntervalMs: number;
  // Hard cap of requests per rolling hour.
  maxPerHour: number;
  // Pause after a detected block.
  cooldownMs: number;
}

export interface GuardDecision {
  ok: boolean;
  reason?: GuardReason;
  retryAfterMs: number;
  message?: string;
}

export interface GuardDomainStatus {
  domain: string;
  lastRequestAt: number | null;
  requestsLastHour: number;
  inCooldown: boolean;
  cooldownUntil: number | null;
  cooldownReason: string | null;
  retryAfterMs: number;
}

export interface GuardSnapshot {
  config: GuardConfig;
  domains: GuardDomainStatus[];
}

export type ScrapeFailureKind = "block" | "network" | "other";

const HOUR_MS = 3_600_000;

interface Entry {
  lastAt: number;
  stamps: number[];
  blockedUntil: number;
  blockReason: string | null;
}

// Fold known short/alternate hosts onto one canonical host so a cooldown or the
// hourly cap cannot be sidestepped by importing through a short link.
const HOST_ALIASES: Record<string, string> = {
  "tokopedia.com": "www.tokopedia.com",
  "m.tokopedia.com": "www.tokopedia.com",
  "tk.tokopedia.com": "www.tokopedia.com",
};

// Normalise a product URL to the domain the guard keys on.
export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return HOST_ALIASES[host] || host;
  } catch {
    return "unknown";
  }
}

function intEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.round(n);
}

// Conservative defaults. Tokopedia does not publish its limits, so these err on
// the safe side: a request every 30s and at most 30 imports per rolling hour.
export function guardConfigFromEnv(): GuardConfig {
  return {
    minIntervalMs: intEnv("IMPORT_MIN_INTERVAL_MS", 30_000, 0),
    maxPerHour: intEnv("IMPORT_MAX_PER_HOUR", 30, 1),
    cooldownMs: intEnv("IMPORT_COOLDOWN_MS", 30 * 60_000, 5_000),
  };
}

const BLOCK_RE =
  /ECONNRESET|ECONNREFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|socket hang up|HTTP 403|HTTP 429|captcha|anti-bot|verify you are human|unusual traffic|memblokir permintaan/i;
const NETWORK_RE =
  /ETIMEDOUT|EAI_AGAIN|EPIPE|fetch failed|aborted due to timeout|TimeoutError|timed? ?out|net::ERR_|membatasi koneksi|rate-limit jaringan/i;

// Classify a scrape failure so the guard can react appropriately:
//   "block"   → the marketplace explicitly refused us (reset / 403 / 429 / captcha)
//   "network" → the connection failed or timed out (often a datacenter-IP block)
//   "other"   → e.g. the page structure changed — not a network problem
export function classifyScrapeFailure(err: unknown): ScrapeFailureKind {
  const anyErr = err as { message?: string; cause?: { code?: string; message?: string } } | undefined;
  const msg =
    typeof err === "string"
      ? err
      : `${anyErr?.message || ""} ${anyErr?.cause?.code || ""} ${anyErr?.cause?.message || ""}`;
  if (BLOCK_RE.test(msg)) return "block";
  if (NETWORK_RE.test(msg)) return "network";
  return "other";
}

function fmtWait(ms: number): string {
  if (ms <= 0) return "sebentar";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} detik`;
  const m = Math.ceil(s / 60);
  return `${m} menit`;
}

export function createScrapeGuard(
  config: GuardConfig,
  clock: () => number = () => Date.now(),
) {
  const domains = new Map<string, Entry>();

  function entry(domain: string): Entry {
    let e = domains.get(domain);
    if (!e) {
      e = { lastAt: 0, stamps: [], blockedUntil: 0, blockReason: null };
      domains.set(domain, e);
    }
    return e;
  }

  function prune(e: Entry, now: number): void {
    if (e.stamps.length) e.stamps = e.stamps.filter((t) => now - t < HOUR_MS);
  }

  function check(domain: string): GuardDecision {
    const now = clock();
    const e = entry(domain);
    prune(e, now);

    if (e.blockedUntil > now) {
      const retryAfterMs = e.blockedUntil - now;
      return {
        ok: false,
        reason: "cooldown",
        retryAfterMs,
        message: `${e.blockReason || "Permintaan ke marketplace dibatasi."} Coba lagi dalam ${fmtWait(retryAfterMs)}.`,
      };
    }
    const sinceLast = now - e.lastAt;
    if (e.lastAt && sinceLast < config.minIntervalMs) {
      const retryAfterMs = config.minIntervalMs - sinceLast;
      return {
        ok: false,
        reason: "interval",
        retryAfterMs,
        message: `Terlalu cepat — beri jeda ${fmtWait(retryAfterMs)} sebelum request berikutnya.`,
      };
    }
    if (e.stamps.length >= config.maxPerHour) {
      const retryAfterMs = Math.max(1000, e.stamps[0] + HOUR_MS - now);
      return {
        ok: false,
        reason: "hourly",
        retryAfterMs,
        message: `Batas aman ${config.maxPerHour} import/jam sudah tercapai. Coba lagi dalam ${fmtWait(retryAfterMs)}.`,
      };
    }
    return { ok: true, retryAfterMs: 0 };
  }

  function record(domain: string): void {
    const now = clock();
    const e = entry(domain);
    prune(e, now);
    e.lastAt = now;
    e.stamps.push(now);
    if (e.stamps.length > config.maxPerHour + 5) {
      e.stamps = e.stamps.slice(-(config.maxPerHour + 5));
    }
  }

  function openBreaker(domain: string, reason: string, ms: number = config.cooldownMs): number {
    const now = clock();
    const e = entry(domain);
    e.blockedUntil = Math.max(e.blockedUntil, now + ms);
    e.blockReason = reason;
    return e.blockedUntil;
  }

  // Record a failed attempt. "block" and "network" both trip the breaker
  // (marketplaces drop/RST connections when throttling); "other" does not,
  // since a page-structure change is not a network problem.
  function noteFailure(domain: string, err: unknown): ScrapeFailureKind {
    return noteFailureKind(domain, classifyScrapeFailure(err));
  }

  // Same as noteFailure() but with an explicit kind (used when the scraper
  // already classified the failure and returned it in `raw.failureKind`).
  function noteFailureKind(domain: string, kind: ScrapeFailureKind): ScrapeFailureKind {
    if (kind === "block") {
      openBreaker(
        domain,
        "Tokopedia/Shopee membatasi permintaan (rate-limit/anti-bot).",
      );
    } else if (kind === "network") {
      openBreaker(
        domain,
        "Koneksi ke marketplace gagal/terputus — kemungkinan IP server diblok atau jaringan dibatasi.",
      );
    }
    return kind;
  }

  function noteSuccess(domain: string): void {
    const e = domains.get(domain);
    if (e) {
      e.blockedUntil = 0;
      e.blockReason = null;
    }
  }

  function status(domain: string): GuardDomainStatus {
    const now = clock();
    const e = entry(domain);
    prune(e, now);
    const inCooldown = e.blockedUntil > now;
    const decision = check(domain);
    return {
      domain,
      lastRequestAt: e.lastAt || null,
      requestsLastHour: e.stamps.length,
      inCooldown,
      cooldownUntil: inCooldown ? e.blockedUntil : null,
      cooldownReason: inCooldown ? e.blockReason : null,
      retryAfterMs: decision.ok ? 0 : decision.retryAfterMs,
    };
  }

  function snapshot(): GuardSnapshot {
    return { config, domains: [...domains.keys()].map(status) };
  }

  return { config, check, record, openBreaker, noteFailure, noteFailureKind, noteSuccess, status, snapshot };
}

export type ScrapeGuard = ReturnType<typeof createScrapeGuard>;

// Production singleton, configured from env (defaults are conservative).
export const scrapeGuard = createScrapeGuard(guardConfigFromEnv());
