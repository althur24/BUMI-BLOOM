// Bumi & Bloom - Admin Auth Guard & Helpers

async function checkAdminAuth() {
  const supabase = window.bbSupabase.getClient();
  const { data: { session }, error: sessionError } = await window.bbSupabase.getSession();
  
  const isLoginPage = window.location.pathname.includes('/admin/login.html');

  if (sessionError || !session) {
    if (!isLoginPage) {
      window.location.href = '/admin/login.html';
    }
    return null;
  }

  // Check if user has admin role in AdminUser table
  const userEmail = session.user.email;
  const { data: adminUser, error: adminError } = await supabase
    .from('AdminUser')
    .select('*')
    .eq('email', userEmail)
    .single();

  if (adminError || !adminUser || !adminUser.isActive) {
    // If not an admin, sign out and redirect to login if not already there
    await window.bbSupabase.signOut();
    if (!isLoginPage) {
      alert('Access denied. You do not have admin privileges.');
      window.location.href = '/admin/login.html';
    }
    return null;
  }

  // If on login page and already logged in as admin, redirect to dashboard
  if (isLoginPage) {
    window.location.href = '/admin/index.html';
  }

  return adminUser;
}

window.bbAdminAuth = {
  checkAdminAuth,
  
  async handleLogin(email, password, errorElementId) {
    const errorEl = document.getElementById(errorElementId);
    if (errorEl) errorEl.textContent = '';
    if (errorEl) errorEl.style.display = 'none';

    const { data, error } = await window.bbSupabase.signIn(email, password);
    
    if (error) {
      if (errorEl) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
      }
      return false;
    }
    
    // Check role
    const supabase = window.bbSupabase.getClient();
    const { data: adminUser, error: adminError } = await supabase
      .from('AdminUser')
      .select('*')
      .eq('email', email)
      .single();

    if (adminError || !adminUser || !adminUser.isActive) {
      await window.bbSupabase.signOut();
      if (errorEl) {
        errorEl.textContent = 'Access denied. You do not have admin privileges.';
        errorEl.style.display = 'block';
      }
      return false;
    }
    
    // Success, redirect to dashboard
    window.location.href = '/admin/index.html';
    return true;
  },
  
  async handleLogout() {
    await window.bbSupabase.signOut();
    window.location.href = '/admin/login.html';
  }
};

// Run check immediately on page load
if (window.location.pathname.includes('/admin/')) {
  document.addEventListener('DOMContentLoaded', () => {
    checkAdminAuth().then(user => {
      // Store user globally for the page if needed
      window.currentAdminUser = user;

      // Sidebar (user info + logout) is owned by admin-app.js (injectAdminSidebar);
      // feed it the resolved user once auth completes.
      if (user && window.bbAdminApp && window.bbAdminApp.populateAdminUserInfo) {
        window.bbAdminApp.populateAdminUserInfo(user);
      }
    });
  });
}
