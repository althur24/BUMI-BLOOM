import '@/css/paper.css';
import body from '@/content/index.html';
import { Scripts } from '@/components/Scripts';
import { STOREFRONT_CHAIN } from '@/lib/scripts';

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Scripts srcs={[...STOREFRONT_CHAIN, '/js/products.js', '/js/paper.js']} />
    </>
  );
}
