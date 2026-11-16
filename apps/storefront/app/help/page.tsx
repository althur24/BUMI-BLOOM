import '@/css/shop.css';
import body from '@/content/help.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Help & Info',
  description: "Size guide, shipping, returns, FAQs and contact details for BUMI / BLOOM — delivered Australia-wide.",
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={STOREFRONT_CHAIN} />
    </>
  );
}
