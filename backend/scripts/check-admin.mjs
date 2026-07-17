import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xugmxibdqiffhklhsawu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z214aWJkcWlmZmhrbGhzYXd1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE3NTY1MywiZXhwIjoyMDk5NzUxNjUzfQ.cqztPj48s9ab9JmBxeuQaBsPE7Hg4kOZezOaR_-avW0';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkUser() {
  const email = 'admin@bumibloom.example';
  const { data, error } = await supabase.from('AdminUser').select('*').eq('email', email);
  console.log("AdminUser table data for", email, ":");
  console.log(JSON.stringify(data, null, 2));
  if (error) console.error("Error:", error);
}

checkUser();
