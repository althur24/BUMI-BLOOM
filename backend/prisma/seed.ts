// Idempotent seed: brands → categories → products (+colors/variants/images) →
// collections → promotion → bootstrap admin. Re-runnable; upserts by slug/code/email.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  BRANDS,
  PRODUCTS,
  NAV_CATEGORY_SLUGS,
  NAV_CATEGORY_LABELS,
  type Audience,
  type ProductType,
  type Badge,
} from "./seed-data.js";

const prisma = new PrismaClient();

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const dollarsToCents = (dollars: number): number => Math.round(dollars * 100);

// Mirror of BumiData.filterByCategory — used to populate Collections.
const byAudience = (cat: string) =>
  PRODUCTS.filter((p) => p.audience === (cat.toUpperCase() as Audience) || p.audience === "UNISEX");

const COLLECTION_PREDICATES: Record<string, (p: (typeof PRODUCTS)[number]) => boolean> = {
  new: (p) => p.isNew,
  sale: (p) => Boolean(p.compareAt && p.compareAt > p.price),
  bestsellers: (p) => p.isBestseller,
  essentials: (p) => ["TSHIRTS", "SHORTS", "ACCESSORIES"].includes(p.category),
  girls: (p) => p.audience === "GIRLS" || p.audience === "UNISEX",
  boys: (p) => p.audience === "BOYS" || p.audience === "UNISEX",
  baby: (p) => p.audience === "BABY" || p.audience === "UNISEX",
  kids: () => true, // data.js: "kids" returns everything
};

const COLLECTION_LABELS: Record<string, string> = {
  new: "New This Week",
  sale: "On Sale",
  bestsellers: "Bestsellers",
  essentials: "Everyday Essentials",
  girls: "Girls' Collection",
  boys: "Boys' Collection",
  baby: "Baby Collection",
  kids: "Kids' Collection",
};

async function seedBrands(): Promise<Map<string, string>> {
  const idByName = new Map<string, string>();
  for (const b of BRANDS) {
    const row = await prisma.brand.upsert({
      where: { slug: b.slug },
      create: {
        slug: b.slug,
        name: b.name,
        city: b.city,
        country: "Indonesia",
        audience: b.audience,
        website: b.website,
        shortDesc: b.desc,
        status: "PUBLISHED",
      },
      update: {
        name: b.name,
        city: b.city,
        audience: b.audience,
        website: b.website,
        shortDesc: b.desc,
      },
    });
    idByName.set(b.name, row.id);
  }
  return idByName;
}

async function seedCategories(): Promise<void> {
  for (const slug of NAV_CATEGORY_SLUGS) {
    await prisma.category.upsert({
      where: { slug },
      create: { slug, name: NAV_CATEGORY_LABELS[slug] ?? slug, menuVisible: true, status: "PUBLISHED" },
      update: { name: NAV_CATEGORY_LABELS[slug] ?? slug },
    });
  }
}

// A MediaAsset for a frontend placeholder image. storagePath strips the leading "images/".
async function upsertPlaceholderAsset(path: string) {
  const storagePath = path.replace(/^images\//, "");
  const fileName = storagePath.split("/").pop() ?? storagePath;
  return prisma.mediaAsset.upsert({
    where: { bucket_storagePath: { bucket: "products", storagePath } },
    create: {
      bucket: "products",
      storagePath,
      publicUrl: path, // served by the static frontend origin
      fileName,
      mimeType: "image/png",
      type: "IMAGE",
    },
    update: {},
  });
}

async function seedProducts(brandIdByName: Map<string, string>): Promise<Map<string, string>> {
  const productIdBySlug = new Map<string, string>();

  for (const p of PRODUCTS) {
    const brandId = brandIdByName.get(p.brand);
    if (!brandId) throw new Error(`Unknown brand "${p.brand}" for product ${p.id}`);

    const product = await prisma.product.upsert({
      where: { slug: p.id },
      create: {
        slug: p.id,
        name: p.name,
        brandId,
        audience: p.audience,
        category: p.category as ProductType,
        fibre: p.fibre,
        material: p.material,
        description: p.description,
        priceAudCents: dollarsToCents(p.price),
        compareAtAudCents: p.compareAt ? dollarsToCents(p.compareAt) : null,
        currency: "AUD",
        badge: p.badge as Badge | null,
        isNew: p.isNew,
        isBestseller: p.isBestseller,
        rating: p.rating,
        reviewsCount: p.reviews,
        addedAtRank: p.addedAt,
        status: "PUBLISHED",
      },
      update: {
        name: p.name,
        brandId,
        audience: p.audience,
        category: p.category as ProductType,
        fibre: p.fibre,
        material: p.material,
        description: p.description,
        priceAudCents: dollarsToCents(p.price),
        compareAtAudCents: p.compareAt ? dollarsToCents(p.compareAt) : null,
        badge: p.badge as Badge | null,
        isNew: p.isNew,
        isBestseller: p.isBestseller,
        rating: p.rating,
        reviewsCount: p.reviews,
        addedAtRank: p.addedAt,
      },
    });
    productIdBySlug.set(p.id, product.id);

    // Colors (replace to keep order/edits in sync)
    await prisma.productColor.deleteMany({ where: { productId: product.id } });
    for (let i = 0; i < p.colors.length; i++) {
      const c = p.colors[i];
      await prisma.productColor.create({
        data: { productId: product.id, name: c.name, hex: c.hex, sortOrder: i },
      });
    }

    // Variants: one per (color × size). SKU = slug-color-size. Default stock 50.
    await prisma.productVariant.deleteMany({ where: { productId: product.id } });
    const colors = await prisma.productColor.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: "asc" },
    });
    for (const color of colors) {
      for (const size of p.sizes) {
        await prisma.productVariant.create({
          data: {
            productId: product.id,
            colorId: color.id,
            size,
            sku: `${p.id}-${slugify(color.name)}-${size}`.toUpperCase(),
            stock: 50,
          },
        });
      }
    }

    // Images (dedupe within product; first is primary)
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    const orderedPaths = Array.from(new Set([p.image, ...p.gallery]));
    for (let i = 0; i < orderedPaths.length; i++) {
      const asset = await upsertPlaceholderAsset(orderedPaths[i]);
      await prisma.productImage.create({
        data: {
          productId: product.id,
          assetId: asset.id,
          sortOrder: i,
          isPrimary: i === 0,
          altText: p.name,
        },
      });
    }
  }

  return productIdBySlug;
}

async function seedCollections(productIdBySlug: Map<string, string>): Promise<void> {
  let order = 0;
  for (const [slug, predicate] of Object.entries(COLLECTION_PREDICATES)) {
    const productIds = PRODUCTS.filter(predicate).map((p) => productIdBySlug.get(p.id)!).filter(Boolean);
    await prisma.collection.upsert({
      where: { slug },
      create: {
        slug,
        name: COLLECTION_LABELS[slug] ?? slug,
        kind: "landing",
        sortOrder: order++,
        status: "PUBLISHED",
        products: { connect: productIds.map((id) => ({ id })) },
      },
      update: {
        name: COLLECTION_LABELS[slug] ?? slug,
        sortOrder: order++,
        products: { set: productIds.map((id) => ({ id })) },
      },
    });
  }
}

async function seedPromotion(): Promise<void> {
  await prisma.promotion.upsert({
    where: { code: "WELCOME10" },
    create: {
      code: "WELCOME10",
      label: "Welcome — 10% off",
      type: "PERCENTAGE",
      value: 0.1,
      currency: "AUD",
      isActive: true,
    },
    update: { label: "Welcome — 10% off", type: "PERCENTAGE", value: 0.1, isActive: true },
  });
}

async function seedBootstrapAdmin(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    console.warn("⚠️  ADMIN_BOOTSTRAP_EMAIL/PASSWORD not set — skipping admin user creation.");
    return;
  }
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return;
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.create({
    data: { email, name: "Store Admin", passwordHash, role: "SUPER_ADMIN", isActive: true },
  });
  console.log(`✅ Created bootstrap admin: ${email}`);
}

async function main(): Promise<void> {
  console.log("🌱 Seeding…");
  const brandIdByName = await seedBrands();
  await seedCategories();
  const productIdBySlug = await seedProducts(brandIdByName);
  await seedCollections(productIdBySlug);
  await seedPromotion();
  await seedBootstrapAdmin();
  console.log(
    `✅ Done: ${BRANDS.length} brands, ${PRODUCTS.length} products (+colors/variants/images), collections, WELCOME10.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
