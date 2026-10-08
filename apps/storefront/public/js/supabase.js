// Bumi & Bloom - Supabase Client Initialization

// Supabase URL and Anon Key
const SUPABASE_URL = 'https://xugmxibdqiffhklhsawu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z214aWJkcWlmZmhrbGhzYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzU2NTMsImV4cCI6MjA5OTc1MTY1M30.SRPEk3OlShyuldb7ZcEC5z6StS4yleJ3fQ3yQubdqUg';

// Wait for the Supabase library to load if it's deferred
let _supabaseClient = null;

function getSupabase() {
  if (_supabaseClient) return _supabaseClient;
  if (!window.supabase) {
    throw new Error('Supabase client library not found. Make sure https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 is loaded.');
  }
  _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabaseClient;
}

window.bbSupabase = {
  getClient: getSupabase,
  
  // Auth helpers
  async signIn(email, password) {
    const supabase = getSupabase();
    return await supabase.auth.signInWithPassword({ email, password });
  },
  
  async signOut() {
    const supabase = getSupabase();
    return await supabase.auth.signOut();
  },
  
  async getSession() {
    const supabase = getSupabase();
    return await supabase.auth.getSession();
  },

  onAuthStateChange(callback) {
    const supabase = getSupabase();
    return supabase.auth.onAuthStateChange(callback);
  }
};
