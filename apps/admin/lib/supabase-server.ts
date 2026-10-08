import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum di-set",
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
export async function getServerUser() {
  const { data, error } = await createSupabaseServerClient().auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
