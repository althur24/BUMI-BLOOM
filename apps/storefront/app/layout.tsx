import '../css/variables.css';
import '../css/base.css';
import '../css/components.css';
import '../css/layout.css';
import '../css/pages.css';

export const metadata = {
  title: {
    default: "BUMI / BLOOM — Colourful, comfy kidswear & screen-free busy books, delivered Australia-wide",
    template: '%s — BUMI / BLOOM',
  },
  description: "Colourful, comfy kidswear and screen-free busy books from Indonesian designers, delivered Australia-wide. Free AU shipping over $99, 30-day returns.",
  icons: { icon: '/images/characters/whale.webp' },
};

export const viewport = {
  themeColor: '#F2EEE9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
