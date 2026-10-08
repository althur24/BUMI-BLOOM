import { checkEnv } from "@/lib/env";

// Fase 1: dashboard placeholder. Belum ter-protect (login UI + page-level
// middleware enforcement datang di Fase 3). Hanya /api/imports & /api/analytics
// yang di-gate middleware untuk sekarang. Tab Import + widget analytics
// menyusul di Fase 3 & 4.
export default function Page() {
  const env = checkEnv();
  return (
    <main className="admin-shell">
      <h1>BUMI / BLOOM — Admin</h1>
      <p>Import produk &middot; Analytics</p>
      <div className="admin-placeholder">
        <p>
          <strong>Fase 1 — fondasi siap.</strong> Scaffolded. Tab &ldquo;Import&rdquo;
          dan widget analytics menyusul di Fase 3 &amp; 4.
        </p>
        <ul>
          <li>Shopify Admin API: {env.shopify ? "configured" : "missing env"}</li>
          <li>Supabase: {env.supabase ? "configured" : "missing env"}</li>
          <li>Database: {env.database ? "configured" : "missing env"}</li>
        </ul>
      </div>
    </main>
  );
}
