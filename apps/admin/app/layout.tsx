import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin — BUMI / BLOOM",
  description: "BUMI / BLOOM admin — import produk & analytics.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
