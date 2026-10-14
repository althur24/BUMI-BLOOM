// Live AUD ↔ IDR exchange rate fetcher. Uses the free open.er-api.com API
// (no API key, updated daily). Rate is cached for 1 hour to avoid spamming.
// Falls back to IDR_TO_AUD_RATE env (default 10000) if the API is unreachable.

let cachedRate: number | null = null;
let cachedAt = 0;
const CACHE_MS = 3_600_000; // 1 hour

// Returns how many IDR equal 1 AUD (e.g., 12507.25).
export async function getAudToIdrRate(): Promise<number> {
  if (cachedRate && Date.now() - cachedAt < CACHE_MS) return cachedRate;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/AUD");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const rate = json?.rates?.IDR;
    if (rate && rate > 0) {
      cachedRate = rate;
      cachedAt = Date.now();
      return rate;
    }
  } catch (e) {
    // API unreachable — fall through to env/default.
  }
  return Number(process.env.IDR_TO_AUD_RATE) || 10000;
}
