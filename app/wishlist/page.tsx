import '@/css/shop.css';
import body from '@/content/wishlist.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Wishlist',
  description: "Your wishlist at BUMI / BLOOM — the kids' pieces you've saved for later.",
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/page-wishlist.js']} />
    </>
  );
}
