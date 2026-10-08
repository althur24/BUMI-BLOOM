import '@/css/shop.css';
import body from '@/content/brands.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Our Brands',
  description: "Discover independent Indonesian kids' brands on BUMI / BLOOM — curated local labels creating playful, comfortable clothing.",
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/page-brands.js']} />
    </>
  );
}
