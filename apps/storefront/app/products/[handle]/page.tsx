import '@/css/shop.css';
import body from '@/content/product-detail.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Product',
  description: "Shop kids' clothing at BUMI / BLOOM — playful, comfortable, made-to-last pieces from Indonesian brands.",
};

function escapeHtmlAttribute(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default function Page({ params }: { params: { handle: string } }) {
  const html = body.replace(
    'id="pdp-root"',
    () => `id="pdp-root" data-handle="${escapeHtmlAttribute(params.handle)}"`,
  );
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/page-pdp.js']} />
    </>
  );
}
