import '@/css/shop.css';
import '@/css/christmas.css';
import body from '@/content/products.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';
import { resolveCategoryMeta } from '@/lib/category-meta';

// Brand names live in Shopify and are only resolved in the browser, so the
// server can only turn the slug into a readable label ("sabine-heem" →
// "Sabine Heem"). The client replaces this with the real brand name once loaded.
// The slug comes straight from the query string, so strip anything that is not
// a letter/digit/dash before it is interpolated into server-rendered HTML.
function brandLabelFromSlug(slug?: string): string {
  const words = String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, ' ')
    .trim()
    .slice(0, 64)
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
  return words || 'Shop by Brand';
}

// Defence in depth for the values spliced into the static HTML below.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function generateMetadata({ searchParams }: { searchParams: { category?: string; search?: string; brand?: string } }) {
  if (searchParams?.brand && !searchParams?.search) {
    const brand = brandLabelFromSlug(searchParams.brand);
    return {
      title: `${brand} — Shop by Brand`,
      description: `Shop ${brand} kidswear at BUMI / BLOOM — playful, comfortable pieces from Indonesian labels, delivered Australia-wide.`,
    };
  }
  const meta = resolveCategoryMeta(searchParams?.category, searchParams?.search);
  return {
    title: meta.title,
    description: "Shop kids' clothing at BUMI / BLOOM — playful, comfortable, made-to-last pieces from Indonesian brands. Dresses, tees, shorts, outerwear and more.",
  };
}

export default function Page({ searchParams }: { searchParams: { category?: string; search?: string; brand?: string } }) {
  const brandRoute = searchParams?.brand && !searchParams?.search;
  const meta = brandRoute
    ? {
        title: brandLabelFromSlug(searchParams.brand),
        subtitle: 'Pieces from this label.',
        breadcrumb: brandLabelFromSlug(searchParams.brand),
      }
    : resolveCategoryMeta(searchParams?.category, searchParams?.search);
  let html = body;
  html = html.replace(
    `id="plp-title">Kids' Collection<`,
    () => `id="plp-title">${escapeHtml(meta.title)}<`,
  );
  html = html.replace(
    `id="plp-subtitle" style="max-width: 52ch;">Playful, comfortable, and made to last.<`,
    () => `id="plp-subtitle" style="max-width: 52ch;">${escapeHtml(meta.subtitle)}<`,
  );
  html = html.replace(
    `id="breadcrumb-current">Shop<`,
    () => `id="breadcrumb-current">${escapeHtml(meta.breadcrumb)}<`,
  );

  const cat = (searchParams?.category || '').toLowerCase();
  const NAV_CATS = ['new', 'all', 'sale', 'girls', 'boys'];
  if (!searchParams?.search && NAV_CATS.includes(cat)) {
    html = html.replace(`href="/products?category=${cat}" class="header__nav-link`, `href="/products?category=${cat}" class="header__nav-link is-active`);
  }

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/products.js']} />
    </>
  );
}
