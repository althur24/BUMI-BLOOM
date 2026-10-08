import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin — BUMI / BLOOM",
  description: "BUMI / BLOOM admin — import produk & analytics.",
  robots: { index: false, follow: false },
};

// Inject public (anon) Supabase config at RUNTIME into the client. This bypasses
// Next.js build-time inlining of NEXT_PUBLIC_* vars — critical for Railway Docker
// deploys where service variables are injected at runtime, not build time. The
// browser client (lib/supabase-browser) reads window.__PUBLIC_ENV__.
const publicEnv = JSON.stringify({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
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
