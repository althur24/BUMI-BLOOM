// Browser-side Supabase client (anon key, public). Uses @supabase/ssr's
// createBrowserClient so the session lives in COOKIES (not localStorage) —
// middleware can read it for server-side page gating, and same-origin fetch
// calls to /api/* send the cookie automatically (no manual Bearer header).
"use client";

import { createBrowserClient } from "@supabase/ssr";

type BrowserClient = ReturnType<typeof createBrowserClient>;

let _client: BrowserClient | null = null;

// Resolve public Supabase config. Prefer the runtime-injected global
// (window.__PUBLIC_ENV__, set by app/layout.tsx) so the client works on Railway
// where NEXT_PUBLIC_* vars are injected at runtime, not build time. Fall back to
// process.env for local dev where .env.local inlines them at build.
function readPublicEnv(): { url?: string; anon?: string } {
  const injected =
    typeof window !== "undefined"
      ? (window as { __PUBLIC_ENV__?: { supabaseUrl?: string; supabaseAnonKey?: string } })
          .__PUBLIC_ENV__
      : undefined;
  return {
    url: injected?.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: injected?.supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function supabaseBrowser(): BrowserClient {
  if (_client) return _client;
  const { url, anon } = readPublicEnv();
  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum di-set",
    );
  }
  _client = createBrowserClient(url, anon);
  return _client;
}
