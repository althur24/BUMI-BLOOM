import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = 'https://xugmxibdqiffhklhsawu.supabase.co';
// Use anon key to simulate client
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z214aWJkcWlmZmhrbGhzYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzU2NTMsImV4cCI6MjA5OTc1MTY1M30.SRPEk3OlShyuldb7ZcEC5z6StS4yleJ3fQ3yQubdqUg';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testLogin() {
  const email = 'admin@bumibloom.example';
  const password = 'BumiBloom2026!';

  console.log("Signing in...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) {
    console.error("Login failed:", authError.message);
    return;
  }
  
  console.log("Login success! User ID:", authData.user.id);
  console.log("JWT Claims:", authData.session.access_token);

  console.log("Selecting AdminUser...");
  const { data, error } = await supabase
    .from('AdminUser')
    .select('*')
    .eq('email', email)
    .single();

  if (error) {
    console.error("Select error:", error);
  } else {
    console.log("Select success:", data);
  }
}

testLogin();
