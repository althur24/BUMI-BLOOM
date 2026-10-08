import '@/css/shop.css';
import body from '@/content/journal.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'The Journal',
  description: "The Journal — stories, style guides and the people behind Indonesian kids' fashion, from BUMI / BLOOM.",
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={STOREFRONT_CHAIN} />
    </>
  );
}
