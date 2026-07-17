import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@bumibloom.example';
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'BumiBloom2026!';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function main() {
  console.log(`Checking if user ${ADMIN_EMAIL} exists in Supabase Auth...`);
  
  // Create user in Supabase Auth
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true
  });

  if (error) {
    if (error.message.includes('already exists')) {
      console.log(`User ${ADMIN_EMAIL} already exists in Supabase Auth.`);
    } else {
      console.error('Error creating user:', error.message);
      process.exit(1);
    }
  } else {
    console.log(`✅ Successfully created Supabase Auth user: ${ADMIN_EMAIL}`);
  }
}

main();
