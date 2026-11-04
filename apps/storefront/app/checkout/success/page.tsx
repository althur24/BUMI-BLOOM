import '@/css/shop.css';
import '@/css/checkout.css';
import body from '@/content/checkout-success.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Order confirmed',
  description: 'Your BUMI / BLOOM order is confirmed.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/page-checkout-success.js']} />
    </>
  );
}
