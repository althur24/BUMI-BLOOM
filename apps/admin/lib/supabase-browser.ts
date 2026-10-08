// Browser-side Supabase client (anon key, public). Uses @supabase/ssr's
// createBrowserClient so the session lives in COOKIES (not localStorage) —
// middleware can read it for server-side page gating, and same-origin fetch
// calls to /api/* send the cookie automatically (no manual Bearer header).
"use client";

import { createBrowserClient } from "@supabase/ssr";

type BrowserClient = ReturnType<typeof createBrowserClient>;

let _client: BrowserClient | null = null;

export function supabaseBrowser(): BrowserClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum di-set",
    );
  }
  _client = createBrowserClient(url, anon);
  return _client;
}
