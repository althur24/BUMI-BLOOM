import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin — BUMI / BLOOM",
  description: "BUMI / BLOOM admin — import produk & analytics.",
  robots: { index: false, follow: false },
};

// Inject public (anon) Supabase config at RUNTIME into the client.
// IMPORTANT: NEXT_PUBLIC_* vars are inlined at BUILD time (empty on Railway
// Docker where env is injected at runtime). So we read the NON-public vars
// (SUPABASE_URL, SUPABASE_ANON_KEY) which Next.js reads at RUNTIME on the
// server. The browser client (lib/supabase-browser) reads window.__PUBLIC_ENV__.
const publicEnv = JSON.stringify({
  supabaseUrl:
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseAnonKey:
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
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
