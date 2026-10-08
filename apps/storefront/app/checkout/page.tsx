import '@/css/shop.css';
import body from '@/content/checkout.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Checkout',
  description: 'Checkout at BUMI / BLOOM — secure, simple checkout for your kids\' picks.',
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/page-checkout.js']} />
    </>
  );
}
