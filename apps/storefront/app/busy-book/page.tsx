import '@/css/shop.css';
import body from '@/content/busy-book.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'The Busy Book',
  description:
    'A soft, reusable screen-free activity book for little ones — handmade in Indonesia with velcro pages that build fine motor skills.',
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={STOREFRONT_CHAIN} />
    </>
  );
}
