// Optional egress proxy support for the import scraper.
//
// Tokopedia/Shopee block datacenter IPs (Railway) at the network layer, so the
// only reliable fix is to send requests through a residential/Indonesian IP.
// Set IMPORT_PROXY_URL (e.g. http://user:pass@host:port) to route both the HTTP
// fast path and Playwright through it. When unset, everything stays direct.
//
// undici is used explicitly for the proxied fetch because Node's global fetch
// does not expose its dispatcher. The agent is created once and reused; most
// residential providers rotate egress IPs at their end.

import { ProxyAgent, fetch as undiciFetch } from "undici";

export interface SimpleResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

let _agent: ProxyAgent | null | undefined;

export function proxyUrl(): string | undefined {
  const v = (process.env.IMPORT_PROXY_URL || "").trim();
  return v || undefined;
}

function agent(): ProxyAgent | undefined {
  if (_agent !== undefined) return _agent ?? undefined;
  const url = proxyUrl();
  if (!url) {
    _agent = null;
    return undefined;
  }
  try {
    _agent = new ProxyAgent(url);
    return _agent;
  } catch {
    // Never log the raw error: IMPORT_PROXY_URL may embed credentials.
    console.warn(
      "[proxy] IMPORT_PROXY_URL tidak valid — periksa formatnya (http://user:pass@host:port).",
    );
    _agent = null;
    return undefined;
  }
}

// Fetch through the configured proxy when set, otherwise use the global fetch.
export async function fetchWithProxy(
  url: string,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<SimpleResponse> {
  const headers = init.headers || {};
  const timeout = init.timeoutMs ?? 60_000;
  const dispatcher = agent();
  if (dispatcher) {
    const res = await undiciFetch(url, {
      redirect: "follow",
      headers,
      dispatcher,
      signal: AbortSignal.timeout(timeout),
    });
    return res as unknown as SimpleResponse;
  }
  const res = await fetch(url, {
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(timeout),
  });
  return res as unknown as SimpleResponse;
}

// Playwright proxy config parsed from the same env var.
export function playwrightProxy():
  | { server: string; username?: string; password?: string }
  | undefined {
  const raw = proxyUrl();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return {
      server: `${u.protocol}//${u.host}`,
      username: u.username || undefined,
      password: u.password || undefined,
    };
  } catch {
    return undefined;
  }
}
