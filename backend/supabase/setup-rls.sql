-- Bumi & Bloom — Row Level Security
-- Idempotent: safe to run repeatedly (DROP POLICY IF EXISTS before each CREATE).
-- Apply with: node scripts/apply-rls.mjs   (from the backend/ directory)
--
-- v2 changes:
--  - Public read policies also exclude soft-deleted rows ("deletedAt" IS NULL).
--  - AdminUser SELECT narrowed to the caller's own row, so admins can no longer
--    read each other's passwordHash via the API.
--  - Added "AdminUserSafe" view (no passwordHash) for any future admin-list UI.

-- Enable RLS on all tables
ALTER TABLE "Brand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductColor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Collection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Promotion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is an admin
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM "AdminUser"
    WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
    AND "isActive" = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Super-admin check. SECURITY DEFINER is required here: a policy on "AdminUser"
-- that queries "AdminUser" directly causes infinite recursion — the function
-- owner (postgres) bypasses RLS, breaking the cycle.
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM "AdminUser"
    WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
    AND role = 'SUPER_ADMIN'
    AND "isActive" = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 1. Brand (Public: SELECT PUBLISHED + not deleted, Admin: ALL)
DROP POLICY IF EXISTS "Public can read published brands" ON "Brand";
CREATE POLICY "Public can read published brands" ON "Brand" FOR SELECT
  USING (status = 'PUBLISHED' AND "deletedAt" IS NULL);
DROP POLICY IF EXISTS "Admin full access on Brand" ON "Brand";
CREATE POLICY "Admin full access on Brand" ON "Brand" FOR ALL USING (is_admin());

-- 2. Category (Public: SELECT PUBLISHED + not deleted, Admin: ALL)
DROP POLICY IF EXISTS "Public can read published categories" ON "Category";
CREATE POLICY "Public can read published categories" ON "Category" FOR SELECT
  USING (status = 'PUBLISHED' AND "deletedAt" IS NULL);
DROP POLICY IF EXISTS "Admin full access on Category" ON "Category";
CREATE POLICY "Admin full access on Category" ON "Category" FOR ALL USING (is_admin());

-- 3. Product (Public: SELECT PUBLISHED + not deleted, Admin: ALL)
DROP POLICY IF EXISTS "Public can read published products" ON "Product";
CREATE POLICY "Public can read published products" ON "Product" FOR SELECT
  USING (status = 'PUBLISHED' AND "deletedAt" IS NULL);
DROP POLICY IF EXISTS "Admin full access on Product" ON "Product";
CREATE POLICY "Admin full access on Product" ON "Product" FOR ALL USING (is_admin());

-- 4. ProductColor (Public: SELECT if Product is PUBLISHED + not deleted, Admin: ALL)
DROP POLICY IF EXISTS "Public can read colors of published products" ON "ProductColor";
CREATE POLICY "Public can read colors of published products" ON "ProductColor" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Product" WHERE "Product".id = "ProductColor"."productId"
    AND "Product".status = 'PUBLISHED' AND "Product"."deletedAt" IS NULL)
);
DROP POLICY IF EXISTS "Admin full access on ProductColor" ON "ProductColor";
CREATE POLICY "Admin full access on ProductColor" ON "ProductColor" FOR ALL USING (is_admin());

-- 5. ProductVariant (Public: SELECT if Product is PUBLISHED + not deleted, Admin: ALL)
DROP POLICY IF EXISTS "Public can read variants of published products" ON "ProductVariant";
CREATE POLICY "Public can read variants of published products" ON "ProductVariant" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Product" WHERE "Product".id = "ProductVariant"."productId"
    AND "Product".status = 'PUBLISHED' AND "Product"."deletedAt" IS NULL)
);
DROP POLICY IF EXISTS "Admin full access on ProductVariant" ON "ProductVariant";
CREATE POLICY "Admin full access on ProductVariant" ON "ProductVariant" FOR ALL USING (is_admin());

-- 6. ProductImage (Public: SELECT if Product is PUBLISHED + not deleted, Admin: ALL)
DROP POLICY IF EXISTS "Public can read images of published products" ON "ProductImage";
CREATE POLICY "Public can read images of published products" ON "ProductImage" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Product" WHERE "Product".id = "ProductImage"."productId"
    AND "Product".status = 'PUBLISHED' AND "Product"."deletedAt" IS NULL)
);
DROP POLICY IF EXISTS "Admin full access on ProductImage" ON "ProductImage";
CREATE POLICY "Admin full access on ProductImage" ON "ProductImage" FOR ALL USING (is_admin());

-- 7. MediaAsset (Public: SELECT, Admin: ALL)
DROP POLICY IF EXISTS "Public can read all media assets" ON "MediaAsset";
CREATE POLICY "Public can read all media assets" ON "MediaAsset" FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin full access on MediaAsset" ON "MediaAsset";
CREATE POLICY "Admin full access on MediaAsset" ON "MediaAsset" FOR ALL USING (is_admin());

-- 8. Collection (Public: SELECT PUBLISHED, Admin: ALL)
DROP POLICY IF EXISTS "Public can read published collections" ON "Collection";
CREATE POLICY "Public can read published collections" ON "Collection" FOR SELECT USING (status = 'PUBLISHED');
DROP POLICY IF EXISTS "Admin full access on Collection" ON "Collection";
CREATE POLICY "Admin full access on Collection" ON "Collection" FOR ALL USING (is_admin());

-- 9. Promotion (Public: SELECT ACTIVE, Admin: ALL)
DROP POLICY IF EXISTS "Public can read active promotions" ON "Promotion";
CREATE POLICY "Public can read active promotions" ON "Promotion" FOR SELECT USING ("isActive" = true);
DROP POLICY IF EXISTS "Admin full access on Promotion" ON "Promotion";
CREATE POLICY "Admin full access on Promotion" ON "Promotion" FOR ALL USING (is_admin());

-- 10. AdminUser (No public access. Admin: SELECT own row only. Super Admin: ALL)
--    Own-row SELECT means no admin can read another admin's passwordHash.
DROP POLICY IF EXISTS "Admin can read admin users" ON "AdminUser";
DROP POLICY IF EXISTS "Admin can read own admin row" ON "AdminUser";
CREATE POLICY "Admin can read own admin row" ON "AdminUser" FOR SELECT
  USING (email = current_setting('request.jwt.claims', true)::json->>'email');
DROP POLICY IF EXISTS "Super Admin can manage admin users" ON "AdminUser";
CREATE POLICY "Super Admin can manage admin users" ON "AdminUser" FOR ALL USING (is_super_admin());

-- Safe view for listing admins WITHOUT passwordHash. security_invoker makes the
-- caller's RLS apply (own-row policy above), so it inherits the same protection.
CREATE OR REPLACE VIEW "AdminUserSafe"
WITH (security_invoker = true) AS
SELECT id, email, name, role, "isActive", "lastLoginAt", "createdAt", "updatedAt"
FROM "AdminUser";

-- 11. AuditLog (No public access. Admin: SELECT, INSERT)
DROP POLICY IF EXISTS "Admin can read audit logs" ON "AuditLog";
CREATE POLICY "Admin can read audit logs" ON "AuditLog" FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Admin can insert audit logs" ON "AuditLog";
CREATE POLICY "Admin can insert audit logs" ON "AuditLog" FOR INSERT WITH CHECK (is_admin());

-- 12. Implicit M:N join tables (Prisma convention: _RelationName, columns "A"/"B").
--     Without policies these are writable by anyone holding the anon key.
--     Public: SELECT (membership of published rows is not sensitive). Admin: ALL.
ALTER TABLE "_CategoryToProduct" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read category-product links" ON "_CategoryToProduct";
CREATE POLICY "Public can read category-product links" ON "_CategoryToProduct" FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin full access on _CategoryToProduct" ON "_CategoryToProduct";
CREATE POLICY "Admin full access on _CategoryToProduct" ON "_CategoryToProduct" FOR ALL USING (is_admin());

ALTER TABLE "_CollectionToProduct" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read collection-product links" ON "_CollectionToProduct";
CREATE POLICY "Public can read collection-product links" ON "_CollectionToProduct" FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin full access on _CollectionToProduct" ON "_CollectionToProduct";
CREATE POLICY "Admin full access on _CollectionToProduct" ON "_CollectionToProduct" FOR ALL USING (is_admin());
