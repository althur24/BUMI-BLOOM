import Link from "next/link";
import { checkEnv } from "@/lib/env";
import AnalyticsWidget from "@/components/AnalyticsWidget";

export const dynamic = "force-dynamic";

export default function Page() {
  const env = checkEnv();
  return (
    <main className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>BUMI / BLOOM</h1>
          <p className="muted">Panel Admin — Import produk & Analytics</p>
        </div>
        <Link href="/import" className="btn btn--primary">Import Produk →</Link>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0 }}>Status Konfigurasi</h3>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Shopify: {env.shopify ? "✓" : "✗"} · Supabase: {env.supabase ? "✓" : "✗"} · Database: {env.database ? "✓" : "✗"}
            </p>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <AnalyticsWidget />
      </div>
    </main>
  );
}
