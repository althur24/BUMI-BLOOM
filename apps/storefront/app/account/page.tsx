import '@/css/shop.css';
import body from '@/content/account.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Your Orders',
  description: 'BUMI / BLOOM is guest checkout — no account needed. Find your order in your confirmation email.',
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={STOREFRONT_CHAIN} />
    </>
  );
}
