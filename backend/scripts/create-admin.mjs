import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xugmxibdqiffhklhsawu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z214aWJkcWlmZmhrbGhzYXd1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE3NTY1MywiZXhwIjoyMDk5NzUxNjUzfQ.cqztPj48s9ab9JmBxeuQaBsPE7Hg4kOZezOaR_-avW0';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const email = 'admin@bumibloom.example';
  const password = 'BumiBloom2026!';

  console.log(`Checking if user ${email} exists in Supabase Auth...`);
  
  // Create user in Auth
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (authError) {
    if (authError.message.includes('already exists') || authError.message.includes('User already registered')) {
      console.log('✅ User already exists in Supabase Auth.');
    } else {
      console.error('❌ Failed to create user in Auth:', authError.message);
      process.exit(1);
    }
  } else {
    console.log('✅ User created in Supabase Auth successfully.');
  }

  // Ensure user is in AdminUser table
  const { data: adminUser, error: adminError } = await supabase
    .from('AdminUser')
    .select('id')
    .eq('email', email)
    .single();

  if (adminError && adminError.code !== 'PGRST116') {
    console.error('❌ Failed to query AdminUser:', adminError.message);
    process.exit(1);
  }

  if (!adminUser) {
    console.log(`User not found in AdminUser table. Adding...`);
    const { error: insertError } = await supabase
      .from('AdminUser')
      .insert({
        id: 'cuid_admin_123',
        email,
        passwordHash: 'supauth', // Not used since we use Supabase Auth
        name: 'Store Admin',
        role: 'SUPER_ADMIN',
        isActive: true
      });
      
    if (insertError) {
      console.error('❌ Failed to insert into AdminUser:', insertError.message);
      process.exit(1);
    }
    console.log('✅ User added to AdminUser table.');
  } else {
    console.log('✅ User already exists in AdminUser table.');
  }
}

main();
