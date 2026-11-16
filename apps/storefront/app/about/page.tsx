import '@/css/shop.css';
import body from '@/content/about.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Our Story',
  description: "BUMI / BLOOM is a small, family-run shop for colourful kids' clothing designed and made in Indonesia — delivered Australia-wide.",
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={STOREFRONT_CHAIN} />
    </>
  );
}
