// SSRF-safe HTTP helpers for the import pipeline.
//
// Import URLs are admin-supplied, but the server still fetches them, so we must
// not let a crafted link reach loopback/private/link-local addresses or follow
// redirects into them. Every request is validated hop-by-hop, size-capped and
// time-limited.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
}

export interface FetchTextResult {
  ok: boolean;
  status: number;
  headers: Headers;
  text: string;
  finalUrl: string;
}

export interface FetchBytesResult {
  ok: boolean;
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  finalUrl: string;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
  if (v.startsWith("fe80")) return true; // link-local
  if (v.startsWith("::ffff:")) return isPrivateIPv4(v.slice(7));
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true;
}

export function assertHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`URL tidak valid: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Hanya URL http(s) yang diizinkan: ${raw}`);
  }
  if (u.port && u.port !== "80" && u.port !== "443") {
    throw new Error(`Port ${u.port} tidak diizinkan untuk import.`);
  }
  if (u.username || u.password) {
    throw new Error("URL dengan kredensial tidak diizinkan.");
  }
  return u;
}

// Resolve and reject anything that isn't a public address. Note: this is a
// pre-flight check (DNS rebinding is possible in theory); it blocks the common
// SSRF vectors which is enough for an admin-only tool.
export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`Host privat tidak diizinkan: ${host}`);
    return;
  }
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new Error(`Host internal tidak diizinkan: ${host}`);
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error(`DNS gagal untuk host: ${host}`);
  }
  if (!addrs.length) throw new Error(`Host tidak dapat di-resolve: ${host}`);
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) {
      throw new Error(`Host mengarah ke alamat privat: ${host} (${a.address})`);
    }
  }
}

async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    throw new Error(`Konten terlalu besar (${declared} byte > ${maxBytes})`);
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Konten melebihi batas ${maxBytes} byte`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function fetchFollowing(
  rawUrl: string,
  opts: Required<Pick<FetchOptions, "timeoutMs" | "maxBytes" | "maxRedirects">> &
    FetchOptions,
): Promise<{ res: Response; finalUrl: string }> {
  let current = assertHttpUrl(rawUrl);
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    await assertPublicHost(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "*/*",
          "Accept-Language": "id,en;q=0.9",
          ...(opts.headers || {}),
        },
      });
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === "AbortError") {
        throw new Error(`Timeout ${opts.timeoutMs}ms: ${current.href}`);
      }
      throw new Error(`Fetch gagal: ${e?.message || e}`);
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: current.href };
      if (hop === opts.maxRedirects) {
        throw new Error(`Terlalu banyak redirect: ${rawUrl}`);
      }
      current = assertHttpUrl(new URL(loc, current).href);
      continue;
    }
    return { res, finalUrl: current.href };
  }
  throw new Error(`Terlalu banyak redirect: ${rawUrl}`);
}

export async function safeFetchText(
  url: string,
  options: FetchOptions = {},
): Promise<FetchTextResult> {
  const opts = {
    timeoutMs: options.timeoutMs ?? 20_000,
    maxBytes: options.maxBytes ?? 10 * 1024 * 1024,
    maxRedirects: options.maxRedirects ?? 3,
    headers: options.headers,
  };
  const { res, finalUrl } = await fetchFollowing(url, opts);
  const bytes = await readCapped(res, opts.maxBytes);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return { ok: res.ok, status: res.status, headers: res.headers, text, finalUrl };
}

export async function safeFetchBytes(
  url: string,
  options: FetchOptions = {},
): Promise<FetchBytesResult> {
  const opts = {
    timeoutMs: options.timeoutMs ?? 30_000,
    maxBytes: options.maxBytes ?? 20 * 1024 * 1024,
    maxRedirects: options.maxRedirects ?? 3,
    headers: options.headers,
  };
  const { res, finalUrl } = await fetchFollowing(url, opts);
  const bytes = await readCapped(res, opts.maxBytes);
  return { ok: res.ok, status: res.status, headers: res.headers, bytes, finalUrl };
}

export const BROWSER_UA = DEFAULT_UA;
