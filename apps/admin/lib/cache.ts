// Tiny in-process TTL cache for the admin server.
//
// The admin runs as a single long-lived Node process (Railway/Docker), so a
// module-level Map is shared by every request. It exists to stop the panel from
// re-hitting Shopify/Prisma for read-only data on every page load — the main
// cause of slow admin pages. Entries are short-lived and explicitly invalidated
// on writes, so an edit is still visible immediately after saving.

interface Entry {
  value: unknown;
  expiresAt: number;
}

// Cap the map so a burst of unique keys (e.g. per-token auth entries) cannot
// grow without bound.
const MAX_ENTRIES = 1000;
const store = new Map<string, Entry>();

function prune(): void {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  // Still too big: drop oldest insertions (Map preserves insertion order).
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): T {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  prune();
  return value;
}

// Read-through cache. Concurrent callers may both load (no stampede protection
// on purpose: these are cheap, idempotent reads).
export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  return cacheSet(key, value, ttlMs);
}

// Drop every key with this prefix (call after a write so the next read is fresh).
export function cacheDelete(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
