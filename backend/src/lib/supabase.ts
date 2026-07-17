import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

// Server-side Supabase client using the SERVICE-ROLE key.
// NEVER import this into browser-facing code or expose the key to the client.
// Used here only for Storage uploads from the admin.
export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
