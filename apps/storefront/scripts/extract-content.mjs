import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const pages = [
  'index.html',
  'products.html',
  'product-detail.html',
  'cart.html',
  'checkout.html',
  'account.html',
  'wishlist.html',
  'brands.html',
  'journal.html',
  'admin.html',
];

const outDir = path.join(ROOT, 'content');
fs.mkdirSync(outDir, { recursive: true });

for (const src of pages) {
  let html = fs.readFileSync(path.join(ROOT, src), 'utf8');
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = m ? m[1] : html;
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.replace(/href="\.\//g, 'href="/');
  body = body.replace(/href="(?!\/|#|http:|https:|mailto:|tel:)([^"]*)"/g, (_m, p) => `href="/${p}"`);
  body = body.replace(/src="(?!\/|http:|https:|data:)([^"]*)"/g, (_m, p) => `src="/${p}"`);
  fs.writeFileSync(path.join(outDir, src), body.trim() + '\n');
  console.log('wrote content/' + src, body.length, 'chars');
}
