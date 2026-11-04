import '@/css/shop.css';
import '@/css/checkout.css';
import body from '@/content/checkout.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Checkout',
  description: 'Secure checkout at BUMI / BLOOM.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/page-checkout.js']} />
    </>
  );
}
