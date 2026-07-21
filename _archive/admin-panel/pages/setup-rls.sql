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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. Brand (Public: SELECT PUBLISHED, Admin: ALL)
CREATE POLICY "Public can read published brands" ON "Brand" FOR SELECT USING (status = 'PUBLISHED');
CREATE POLICY "Admin full access on Brand" ON "Brand" FOR ALL USING (is_admin());

-- 2. Category (Public: SELECT PUBLISHED, Admin: ALL)
CREATE POLICY "Public can read published categories" ON "Category" FOR SELECT USING (status = 'PUBLISHED');
CREATE POLICY "Admin full access on Category" ON "Category" FOR ALL USING (is_admin());

-- 3. Product (Public: SELECT PUBLISHED, Admin: ALL)
CREATE POLICY "Public can read published products" ON "Product" FOR SELECT USING (status = 'PUBLISHED');
CREATE POLICY "Admin full access on Product" ON "Product" FOR ALL USING (is_admin());

-- 4. ProductColor (Public: SELECT if Product is PUBLISHED, Admin: ALL)
CREATE POLICY "Public can read colors of published products" ON "ProductColor" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Product" WHERE "Product".id = "ProductColor"."productId" AND "Product".status = 'PUBLISHED')
);
CREATE POLICY "Admin full access on ProductColor" ON "ProductColor" FOR ALL USING (is_admin());

-- 5. ProductVariant (Public: SELECT if Product is PUBLISHED, Admin: ALL)
CREATE POLICY "Public can read variants of published products" ON "ProductVariant" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Product" WHERE "Product".id = "ProductVariant"."productId" AND "Product".status = 'PUBLISHED')
);
CREATE POLICY "Admin full access on ProductVariant" ON "ProductVariant" FOR ALL USING (is_admin());

-- 6. ProductImage (Public: SELECT if Product is PUBLISHED, Admin: ALL)
CREATE POLICY "Public can read images of published products" ON "ProductImage" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Product" WHERE "Product".id = "ProductImage"."productId" AND "Product".status = 'PUBLISHED')
);
CREATE POLICY "Admin full access on ProductImage" ON "ProductImage" FOR ALL USING (is_admin());

-- 7. MediaAsset (Public: SELECT, Admin: ALL)
CREATE POLICY "Public can read all media assets" ON "MediaAsset" FOR SELECT USING (true);
CREATE POLICY "Admin full access on MediaAsset" ON "MediaAsset" FOR ALL USING (is_admin());

-- 8. Collection (Public: SELECT PUBLISHED, Admin: ALL)
CREATE POLICY "Public can read published collections" ON "Collection" FOR SELECT USING (status = 'PUBLISHED');
CREATE POLICY "Admin full access on Collection" ON "Collection" FOR ALL USING (is_admin());

-- 9. Promotion (Public: SELECT ACTIVE, Admin: ALL)
CREATE POLICY "Public can read active promotions" ON "Promotion" FOR SELECT USING ("isActive" = true);
CREATE POLICY "Admin full access on Promotion" ON "Promotion" FOR ALL USING (is_admin());

-- 10. AdminUser (No public access. Admin: SELECT. Super Admin: ALL)
CREATE POLICY "Admin can read admin users" ON "AdminUser" FOR SELECT USING (is_admin());
CREATE POLICY "Super Admin can manage admin users" ON "AdminUser" FOR ALL USING (
  EXISTS (
    SELECT 1 FROM "AdminUser" au 
    WHERE au.email = current_setting('request.jwt.claims', true)::json->>'email'
    AND au.role = 'SUPER_ADMIN'
    AND au."isActive" = true
  )
);

-- 11. AuditLog (No public access. Admin: SELECT, INSERT)
CREATE POLICY "Admin can read audit logs" ON "AuditLog" FOR SELECT USING (is_admin());
CREATE POLICY "Admin can insert audit logs" ON "AuditLog" FOR INSERT WITH CHECK (is_admin());
