import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client — bypasses RLS. SERVER ONLY.
// Used by Route Handlers to write ImportJob / AuditLog and to verify admin
// sessions. The anon key (browser) is never used server-side.
let _client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin env missing: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  if (!_client) {
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

// Verify a user JWT (Bearer token from the admin frontend) and return the user,
// or null if invalid. Does NOT trust the client to assert roles — callers must
// re-check the role against AdminUser (Prisma) by email.
export async function getUserFromJwt(jwt: string) {
  const { data, error } = await supabaseAdmin().auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user;
}
