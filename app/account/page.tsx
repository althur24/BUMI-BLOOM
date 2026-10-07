import '@/css/shop.css';
import body from '@/content/account.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'My Account',
  description: "Your account at BUMI / BLOOM — orders, addresses and settings.",
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/page-account.js']} />
    </>
  );
}
