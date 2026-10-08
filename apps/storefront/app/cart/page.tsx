import '@/css/shop.css';
import body from '@/content/cart.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Shopping Bag',
  description: "Shopping Bag — BUMI / BLOOM. Review your curated kids' picks before checkout.",
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/page-cart.js']} />
    </>
  );
}
