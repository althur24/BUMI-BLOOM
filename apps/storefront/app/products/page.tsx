import '@/css/shop.css';
import body from '@/content/products.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';
import { resolveCategoryMeta } from '@/lib/category-meta';

export function generateMetadata({ searchParams }: { searchParams: { category?: string; search?: string } }) {
  const meta = resolveCategoryMeta(searchParams?.category, searchParams?.search);
  return {
    title: meta.title,
    description: "Shop kids' clothing at BUMI / BLOOM — playful, comfortable, made-to-last pieces from Indonesian brands. Dresses, tees, shorts, outerwear and more.",
  };
}

export default function Page({ searchParams }: { searchParams: { category?: string; search?: string } }) {
  const meta = resolveCategoryMeta(searchParams?.category, searchParams?.search);
  let html = body;
  html = html.replace(`id="plp-title">Kids' Collection<`, `id="plp-title">${meta.title}<`);
  html = html.replace(`id="plp-subtitle" style="max-width: 52ch;">Playful, comfortable, and made to last.<`, `id="plp-subtitle" style="max-width: 52ch;">${meta.subtitle}<`);
  html = html.replace(`id="breadcrumb-current">Shop<`, `id="breadcrumb-current">${meta.breadcrumb}<`);

  const cat = (searchParams?.category || '').toLowerCase();
  const NAV_CATS = ['new', 'girls', 'boys', 'baby', 'essentials', 'sale'];
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
