import type { Metadata } from "next";
import "./globals.css";

// Force runtime rendering. Without this, the layout is statically prerendered at
// build time, so process.env.SUPABASE_URL / SUPABASE_ANON_KEY (runtime vars) are
// read at BUILD (empty on Railway Docker, which injects env at runtime) and
// baked empty into window.__PUBLIC_ENV__ -> client login throws. force-dynamic
// makes the layout render per-request so runtime env is read correctly.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — BUMI / BLOOM",
  description: "BUMI / BLOOM admin — import produk & analytics.",
  robots: { index: false, follow: false },
};

// Extract only the valid JWT portion (3 dot-separated base64url segments) from
// a value. Defends against paste errors where extra junk (quotes, newlines, or
// even other env vars like "GEMINI_API_KEY=..." leaked into SUPABASE_ANON_KEY)
// would otherwise break the apikey header AND leak secrets into the client HTML.
function sanitizeJwt(v: string | undefined): string {
  if (!v) return "";
  const m = v.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return m ? m[0] : v.trim();
}

// Inject public (anon) Supabase config at RUNTIME into the client.
// IMPORTANT: NEXT_PUBLIC_* vars are inlined at BUILD time (empty on Railway
// Docker where env is injected at runtime). So we read the NON-public vars
// (SUPABASE_URL, SUPABASE_ANON_KEY) which Next.js reads at RUNTIME on the
// server. The browser client (lib/supabase-browser) reads window.__PUBLIC_ENV__.
const publicEnv = JSON.stringify({
  supabaseUrl: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
  supabaseAnonKey: sanitizeJwt(
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
}).replace(/</g, "\\u003c");

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.webp" type="image/webp" />
        <script
          dangerouslySetInnerHTML={{ __html: `window.__PUBLIC_ENV__=${publicEnv};` }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
