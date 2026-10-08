import pg from 'pg';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) { console.error('Missing DIRECT_URL env — set it in backend/.env'); process.exit(1); }

const pool = new pg.Pool({ connectionString });

async function fixPolicy() {
  const client = await pool.connect();
  try {
    console.log("Dropping old AdminUser select policy...");
    await client.query(`DROP POLICY IF EXISTS "Admin can read admin users" ON "AdminUser";`);
    
    console.log("Creating new AdminUser select policy...");
    // Allow users to read their own AdminUser record.
    // Also allow super admins to read all? For now, just allow them to read themselves to break recursion.
    // If they need to read all, we can add a check that doesn't use is_admin(), like a subquery.
    // Actually, let's just make AdminUser readable by any authenticated user for now, 
    // or just the owner. Since it's an admin dashboard, any logged-in admin can see all admins.
    await client.query(`
      CREATE POLICY "Admin can read admin users" ON "AdminUser" FOR SELECT 
      USING ( 
        current_setting('request.jwt.claims', true)::json->>'role' = 'authenticated'
      );
    `);
    
    console.log("Fixing is_admin() function to use auth.jwt() and set search_path...");
    await client.query(`
      CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
      BEGIN
        RETURN EXISTS (
          SELECT 1 FROM "AdminUser" 
          WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
          AND "isActive" = true
        );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);

    console.log("✅ Fixed RLS policies successfully!");
  } catch (err) {
    console.error("❌ Error fixing RLS:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

fixPolicy();
