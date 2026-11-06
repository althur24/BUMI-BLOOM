import '@/css/shop.css';
import '@/css/checkout.css';
import '@/css/order-tracking.css';
import body from '@/content/order-tracking.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Order tracking',
  description: 'Track your BUMI / BLOOM order.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/page-order-tracking.js']} />
    </>
  );
}
