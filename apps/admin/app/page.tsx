import Link from "next/link";
import { checkEnv } from "@/lib/env";
import AnalyticsWidget from "@/components/AnalyticsWidget";

// Fase 3: dashboard placeholder with links. Page-level session enforcement +
// login redirect are client-handled in /import; server-side page gating is a
// Fase 5 hardening item.
export default function Page() {
  const env = checkEnv();
  return (
    <main className="admin-shell">
      <h1>BUMI / BLOOM — Admin</h1>
      <p>Import produk &middot; Analytics</p>
      <div className="admin-placeholder">
        <p style={{ marginTop: 0 }}>
          <strong>Fase 1–3 siap.</strong> Import pipeline (scrape → preview →
          push to Shopify) sudah live.
        </p>
        <p>
          <Link href="/import" className="btn btn--primary">Buka Import →</Link>{" "}
          <Link href="/login" className="btn">Sign In</Link>
        </p>
        <ul>
          <li>Shopify Admin API: {env.shopify ? "configured" : "missing env"}</li>
          <li>Supabase: {env.supabase ? "configured" : "missing env"}</li>
          <li>Database: {env.database ? "configured" : "missing env"}</li>
        </ul>
      </div>

      <div style={{ marginTop: 20 }}>
        <AnalyticsWidget />
      </div>
    </main>
  );
}
