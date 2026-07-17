import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function setupBuckets() {
  const buckets = ['products', 'brands', 'editorial'];
  
  for (const name of buckets) {
    const { data, error } = await supabaseAdmin.storage.createBucket(name, { public: true });
    if (error && !error.message.includes('already exists')) {
      console.error(`Failed to create bucket ${name}:`, error.message);
    } else {
      console.log(`✅ Bucket ready: ${name}`);
    }
  }
}

async function setupStorageRLS() {
  const { Client } = pg;
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  
  await client.connect();
  
  const sql = `
    -- Use supabase_storage_admin role to manage storage policies
    SET ROLE supabase_storage_admin;

    -- Enable RLS on storage.objects if not already
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    -- Drop existing policies if any
    DROP POLICY IF EXISTS "Public Access" ON storage.objects;
    DROP POLICY IF EXISTS "Admin Upload Access" ON storage.objects;
    DROP POLICY IF EXISTS "Admin Update Access" ON storage.objects;
    DROP POLICY IF EXISTS "Admin Delete Access" ON storage.objects;

    -- Public can read any object in these buckets
    CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (
      bucket_id IN ('products', 'brands', 'editorial')
    );

    -- Admin can insert/update/delete
    -- We use our custom is_admin() function, which works in the public schema
    CREATE POLICY "Admin Upload Access" ON storage.objects FOR INSERT WITH CHECK (
      public.is_admin()
    );
    CREATE POLICY "Admin Update Access" ON storage.objects FOR UPDATE USING (
      public.is_admin()
    );
    CREATE POLICY "Admin Delete Access" ON storage.objects FOR DELETE USING (
      public.is_admin()
    );

    -- Reset role
    RESET ROLE;
  `;
  
  try {
    await client.query(sql);
    console.log('✅ Executed storage RLS policies successfully.');
  } catch (e) {
    console.error('❌ Failed to execute storage RLS setup:', e.message);
  } finally {
    await client.end();
  }
}

async function main() {
  console.log("Setting up storage buckets...");
  await setupBuckets();
  console.log("Setting up storage RLS...");
  await setupStorageRLS();
  console.log("Done.");
}

main();
