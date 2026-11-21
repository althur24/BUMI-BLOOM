import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { cacheGet, cacheSet } from "./cache";

// Service-role client — bypasses RLS. SERVER ONLY. Used for Supabase Storage
// uploads (re-hosting images). The anon key (browser) is never used here.
let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin env missing: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  if (/^(TODO_FILL|your[-_]|changeme)/i.test(key.trim())) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY masih placeholder. Isi dengan service role key asli " +
        "(Supabase Dashboard → Project Settings → API) atau tarik dari Vercel.",
    );
  }
  if (!_admin) {
    _admin = createClient(url, key, { auth: { persistSession: false } });
  }
  return _admin;
}

// Cookie-based server client (anon key). Reads the session from the request
// cookies via next/headers. Used by route handlers + requireAdmin to verify
// the signed-in user. Cookie refresh is handled by middleware (setAll is a
// safe no-op here because route-handler cookies() may be readonly).
export function createSupabaseServerClient(): SupabaseClient {
  // Read NON-public vars first (runtime on Railway Docker). NEXT_PUBLIC_* are
  // build-inlined and empty at runtime on Railway, so they're only a fallback
  // for local dev where .env.local provides them at build.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase URL/anon key missing: set SUPABASE_URL + SUPABASE_ANON_KEY",
    );
  }
  const store = cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value, options }) => {
          try {
            store.set(name, value, options);
          } catch {
            // readonly in this context — middleware handles refresh.
          }
        });
      },
    },
  });
}

// Returns the signed-in user from the cookie session, or null.
//
// `auth.getUser()` is a network round-trip to Supabase Auth. The admin page
// fires several API calls at once (product editor = detail + vendors, hero =
// cards + products, …), so the same token would be verified repeatedly. The
// verified result is cached for 60s keyed by a hash of the access token (never
// the raw token) — a revoked session is still rejected once the entry expires.
const USER_CACHE_TTL_MS = 60_000;

export async function getServerUser(): Promise<User | null> {
  const supabase = createSupabaseServerClient();

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return null;

  const cacheKey = `auth:user:${createHash("sha256").update(token).digest("hex")}`;
  const cachedUser = cacheGet<User>(cacheKey);
  if (cachedUser) return cachedUser;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return cacheSet(cacheKey, data.user, USER_CACHE_TTL_MS);
}
