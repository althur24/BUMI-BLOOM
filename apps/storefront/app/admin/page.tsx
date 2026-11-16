import '@/css/shop.css';
import '@/css/admin.css';
import body from '@/content/admin.html';
import { Scripts } from '@/components/Scripts';
import { ADMIN_CHAIN } from '@/lib/scripts';

export const metadata = {
  title: 'Admin',
  description: 'BUMI / BLOOM admin — manage products, stock, brands and promotions.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={ADMIN_CHAIN} />
    </>
  );
}
