import pg from 'pg';

const connectionString = process.env.DIRECT_URL || "postgresql://postgres.xugmxibdqiffhklhsawu:penangkap4us@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?schema=public";
const pool = new pg.Pool({ connectionString });

async function checkPolicies() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT policyname, permissive, roles, cmd, qual, with_check 
      FROM pg_policies 
      WHERE tablename = 'AdminUser';
    `);
    console.log("Policies on AdminUser:", res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}
checkPolicies();
