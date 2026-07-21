// One-off: replace seeded mockup product images with the real photos from
// ../Clothing/, matching products by slug. Uploads to the `products` bucket,
// creates MediaAsset rows, swaps ProductImage links (new image = primary).
// Run from backend/: node scripts/import-clothing-images.mjs
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLOTHING_DIR = path.join(__dirname, '..', '..', 'Clothing');

const MAP = {
  'elliot-pant': 'bohopanna_elliot_pant.jpg',
  'basic-tee-girl': 'bohopanna_basic_tee_girl.jpg',
  'pannadaily-set-girl': 'bohopanna_pannadaily_set_girl.jpg',
  'pannadaily-playsuit': 'bohopanna_playsuit_girl_print.jpg',
  'barrel-jeans': 'bohopanna_barrel_jeans.jpg',
  'horse-linen-sashiko-shirt': 'sabine_horse_linen_sashiko.jpg',
  'howdy-embroidery-tee': 'sabine_howdy_embroidery_tee.jpg',
  'wonder-linen-shirt-black': 'sabine_wonder_black.jpg',
  'na-willa-knitted-vest': 'sabine_na_willa_vest.jpg',
  'wonder-linen-shirt-white': 'sabine_wonder_broken_white.jpg',
  'piccolo-jacket': 'anakmu_piccolo_jacket.jpg',
  'torena-sweater': 'anakmu_torena_sweater.jpg',
  'gufi-rib-sweater': 'anakmu_gufi_rib_sweater.jpg',
  'organic-pocket-tee': 'anakmu_organic_pocket_tshirt.jpg',
  'brisa-cargo-pants': 'anakmu_brisa_cargo_pants.jpg',
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const prisma = new PrismaClient();
const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);

let failures = 0;

for (const [slug, fileName] of Object.entries(MAP)) {
  const product = await prisma.product.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!product) {
    console.error(`MISS  ${slug} — no product with that slug`);
    failures++;
    continue;
  }

  // 1. Upload photo (upsert so re-runs are idempotent)
  const storagePath = `${product.id}/${fileName}`;
  const file = await readFile(path.join(CLOTHING_DIR, fileName));
  const { error: upErr } = await supabase.storage
    .from('products')
    .upload(storagePath, file, { contentType: 'image/jpeg', upsert: true });
  if (upErr) {
    console.error(`FAIL  ${slug} — upload: ${upErr.message}`);
    failures++;
    continue;
  }
  const { data: pub } = supabase.storage.from('products').getPublicUrl(storagePath);

  // 2. MediaAsset row (upsert on bucket+storagePath unique key)
  const asset = await prisma.mediaAsset.upsert({
    where: { bucket_storagePath: { bucket: 'products', storagePath } },
    update: { publicUrl: pub.publicUrl, sizeBytes: file.length },
    create: {
      id: newId(), bucket: 'products', storagePath, publicUrl: pub.publicUrl,
      fileName, mimeType: 'image/jpeg', sizeBytes: file.length, type: 'IMAGE',
      altText: product.name, tags: [], updatedAt: new Date(),
    },
  });

  // 3. Swap images: drop mockup links, link the real photo as primary
  await prisma.productImage.deleteMany({ where: { productId: product.id } });
  await prisma.productImage.create({
    data: {
      id: newId(), productId: product.id, assetId: asset.id,
      altText: product.name, sortOrder: 0, isPrimary: true,
    },
  });

  console.log(`OK    ${slug}  <-  ${fileName}`);
}

// Clean up MediaAsset rows left orphaned by the swap (storage objects kept — harmless)
const orphaned = await prisma.mediaAsset.deleteMany({
  where: { productImages: { none: {} }, brandLogos: { none: {} }, categoryImages: { none: {} } },
});
console.log(`\nRemoved ${orphaned.count} orphaned MediaAsset row(s).`);

await prisma.$disconnect();
console.log(failures === 0 ? 'ALL 15 IMAGES SWAPPED' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
