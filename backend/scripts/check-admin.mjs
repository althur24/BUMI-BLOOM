import { createClient } from '@supabase/supabase-js';

// SECURITY: credentials come ONLY from env. Never hardcode keys here.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env — set them in backend/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkUser() {
  const email = 'admin@bumibloom.example';
  const { data, error } = await supabase.from('AdminUser').select('*').eq('email', email);
  console.log("AdminUser table data for", email, ":");
  console.log(JSON.stringify(data, null, 2));
  if (error) console.error("Error:", error);
}

checkUser();
