import { Router } from "express";
import { prisma } from "../db.js";

// Phase-1 surface: the storefront's public catalog API is a LATER phase. These
// read-only endpoints exist so the DB wiring can be verified end-to-end and give
// the storefront a preview of what's coming. (No customer auth / orders here yet.)
export const apiRouter = Router();

apiRouter.get("/", (_req, res) => {
  res.json({
    name: "Bumi & Bloom API",
    phase: "1 — admin/CMS",
    upcoming: ["/api/products", "/api/brands", "/api/collections/:slug", "customer auth", "orders + payment"],
  });
});

// Published products with brand + primary image, AUD cents.
// Paginated: ?page=1&pageSize=24 (pageSize capped at 100).
apiRouter.get("/products", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 24));
    const where = { status: "PUBLISHED" as const, deletedAt: null };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { addedAtRank: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          brand: { select: { id: true, name: true, slug: true } },
          colors: { orderBy: { sortOrder: "asc" } },
          images: { where: { isPrimary: true }, take: 1, include: { asset: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);
    res.json({ products, page, pageSize, total });
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/brands", async (_req, res, next) => {
  try {
    const brands = await prisma.brand.findMany({
      where: { status: "PUBLISHED", deletedAt: null },
      orderBy: { sortOrder: "asc" },
    });
    res.json({ brands });
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/collections/:slug", async (req, res, next) => {
  try {
    const collection = await prisma.collection.findUnique({
      where: { slug: req.params.slug },
      include: {
        products: {
          where: { status: "PUBLISHED", deletedAt: null },
          include: { brand: { select: { name: true } } },
        },
      },
    });
    if (!collection) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    res.json({ collection });
  } catch (err) {
    next(err);
  }
});
