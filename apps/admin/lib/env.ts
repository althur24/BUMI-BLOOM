// Non-secret env presence checks for dashboard/health display.
// Detects placeholder values (TODO_, <...>, "example") so the check reflects
// real configuration, not just a non-empty string. Never returns secret values.

function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  const s = v.trim();
  if (!s) return true;
  return (
    s.startsWith("TODO_") ||
    s.startsWith("<") ||
    /example|change-me|fill/i.test(s)
  );
}

function real(...vals: (string | undefined)[]): boolean {
  return vals.every((v) => !isPlaceholder(v));
}

export function checkEnv() {
  return {
    shopify: real(
      process.env.SHOPIFY_SHOP,
      process.env.SHOPIFY_CLIENT_ID,
      process.env.SHOPIFY_CLIENT_SECRET,
    ),
    supabase: real(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    database: real(process.env.DATABASE_URL),
  };
}
