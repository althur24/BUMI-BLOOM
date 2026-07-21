// Apply backend/supabase/setup-rls.sql to the database via DIRECT_URL.
// Usage: node scripts/apply-rls.mjs   (from the backend/ directory)
import "dotenv/config";
import fs from "node:fs";
import pg from "pg";

const sql = fs.readFileSync(new URL("../supabase/setup-rls.sql", import.meta.url), "utf8");

if (!process.env.DIRECT_URL) {
  console.error("❌ DIRECT_URL is not set — check backend/.env");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
try {
  await client.query(sql);
  console.log("✅ RLS policies applied (setup-rls.sql).");
} finally {
  await client.end();
}
