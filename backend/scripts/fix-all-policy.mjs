import pg from 'pg';

const connectionString = process.env.DIRECT_URL || "postgresql://postgres.xugmxibdqiffhklhsawu:penangkap4us@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?schema=public";
const pool = new pg.Pool({ connectionString });

async function fixPolicies() {
  const client = await pool.connect();
  try {
    console.log("Dropping ALL policy on AdminUser...");
    await client.query(`DROP POLICY IF EXISTS "Super Admin can manage admin users" ON "AdminUser";`);
    
    console.log("Creating is_super_admin() function...");
    await client.query(`
      CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean AS $$
      BEGIN
        RETURN EXISTS (
          SELECT 1 FROM "AdminUser" 
          WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
          AND role = 'SUPER_ADMIN'
          AND "isActive" = true
        );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);

    console.log("Creating specific policies for Super Admin...");
    await client.query(`
      CREATE POLICY "Super Admin can insert" ON "AdminUser" FOR INSERT WITH CHECK (is_super_admin());
      CREATE POLICY "Super Admin can update" ON "AdminUser" FOR UPDATE USING (is_super_admin());
      CREATE POLICY "Super Admin can delete" ON "AdminUser" FOR DELETE USING (is_super_admin());
    `);

    console.log("✅ Fixed AdminUser ALL policy successfully!");
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

fixPolicies();
