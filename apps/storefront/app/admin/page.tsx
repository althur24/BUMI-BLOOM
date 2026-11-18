import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

// The storefront used to ship its own admin panel (content/admin.html +
// public/js/admin.js) that wrote directly to a Supabase database from the
// browser. The live storefront now reads/writes Shopify (see
// public/js/data.js and the separate apps/admin app), so that panel is dead:
// edits made there never reach the store.
//
// This route therefore no longer renders the legacy panel. When
// NEXT_PUBLIC_ADMIN_APP_URL is configured it redirects to the real admin app;
// otherwise it explains the move so nobody keeps editing the wrong system.
export default function Page() {
  const url = (process.env.ADMIN_APP_URL || process.env.NEXT_PUBLIC_ADMIN_APP_URL || '').trim();
  if (url) redirect(url);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', marginBottom: 'var(--space-3)' }}>
          Admin sudah dipindahkan
        </h1>
        <p style={{ opacity: 0.75, marginBottom: 'var(--space-4)' }}>
          Panel admin lama di halaman ini tidak lagi terhubung ke storefront dan
          perubahan di sini tidak akan muncul di toko. Gunakan aplikasi admin
          terpisah untuk mengelola produk, brand, dan promo.
        </p>
        <p style={{ opacity: 0.6, fontSize: 'var(--text-sm)' }}>
          Set <code>NEXT_PUBLIC_ADMIN_APP_URL</code> pada environment storefront
          agar halaman ini otomatis dialihkan ke admin yang benar.
        </p>
        <a href="/" className="btn btn--primary" style={{ marginTop: 'var(--space-5)' }}>
          Kembali ke toko
        </a>
      </div>
    </main>
  );
}
