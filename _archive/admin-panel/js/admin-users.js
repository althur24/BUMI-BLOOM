// Bumi & Bloom - Admin Users Logic (SUPER_ADMIN only)

let allUsers = [];

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (!window.currentAdminUser || window.currentAdminUser.role !== 'SUPER_ADMIN') {
      // Defense in depth: the nav link is hidden for non-super admins too.
      window.bbAdminApp.showToast("Access denied. Super Admin role required.", "error");
      window.location.href = 'index.html';
      return;
    }
    loadUsers();
  }, 500);

  document.getElementById('user-form').addEventListener('submit', handleSaveUser);
  document.getElementById('btn-deactivate-user').addEventListener('click', handleDeactivateUser);
});

function formatRole(role) {
  if (!role) return '—';
  return role.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatLastLogin(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

async function loadUsers() {
  const supabase = window.bbSupabase.getClient();
  const tbody = document.getElementById('users-table-body');

  const { data, error } = await supabase
    .from('AdminUser')
    .select('*')
    .order('createdAt', { ascending: false });

  if (error) {
    console.error(error);
    window.bbAdminApp.showToast("Failed to load admin users", "error");
    tbody.innerHTML = '<tr><td colspan="5">Error loading admin users.</td></tr>';
    return;
  }

  allUsers = data;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No admin users found.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(u => `
    <tr>
      <td><strong>${u.name || '—'}</strong><br><small style="color: var(--text-muted);">${u.email}</small></td>
      <td><span class="admin-badge ${u.role === 'SUPER_ADMIN' ? 'warning' : 'neutral'}">${formatRole(u.role)}</span></td>
      <td><span class="admin-badge ${u.isActive ? 'success' : 'danger'}">${u.isActive ? 'Active' : 'Inactive'}</span></td>
      <td style="color: var(--text-muted);">${formatLastLogin(u.lastLoginAt)}</td>
      <td>
        <button class="btn-admin btn-admin--outline" style="padding: var(--space-1) var(--space-2); font-size: 0.8rem;" onclick="editUser('${u.id}')">Edit</button>
      </td>
    </tr>
  `).join('');
}

function openUserForm(user = null) {
  const form = document.getElementById('user-form');
  form.reset();

  document.getElementById('user-id').value = user ? user.id : '';
  document.getElementById('user-modal-title').textContent = user ? 'Edit Admin User' : 'Admin User';

  if (user) {
    document.getElementById('user-email').value = user.email || '';
    document.getElementById('user-name').value = user.name || '';
    document.getElementById('user-role').value = user.role || 'MARKETPLACE_ADMIN';
    document.getElementById('user-is-active').checked = user.isActive !== false;

    const deactivateBtn = document.getElementById('btn-deactivate-user');
    deactivateBtn.style.display = user.isActive ? 'inline-block' : 'none';
    deactivateBtn.textContent = user.isActive ? 'Deactivate' : 'Reactivate';
  }

  window.bbAdminApp.openModal('user-modal');
}

function editUser(id) {
  const user = allUsers.find(u => u.id === id);
  if (user) openUserForm(user);
}

async function handleSaveUser(e) {
  e.preventDefault();

  const id = document.getElementById('user-id').value;
  if (!id) return; // email/readonly; only existing users are editable here

  const payload = {
    name: document.getElementById('user-name').value || null,
    role: document.getElementById('user-role').value,
    isActive: document.getElementById('user-is-active').checked,
  };

  const supabase = window.bbSupabase.getClient();
  const btn = document.getElementById('btn-save-user');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    const { error } = await supabase.from('AdminUser').update(payload).eq('id', id);
    if (error) throw error;

    await supabase.from('AuditLog').insert({
      action: 'adminuser.update', entity: 'AdminUser', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: { role: payload.role, isActive: payload.isActive }
    });
    window.bbAdminApp.showToast("Admin user updated successfully");
    window.bbAdminApp.closeModal('user-modal');
    loadUsers();
  } catch (err) {
    console.error(err);
    window.bbAdminApp.showToast(err.message || "Failed to save admin user", "error");
  } finally {
    btn.textContent = 'Save User';
    btn.disabled = false;
  }
}

// Deactivate / reactivate in one click. Deactivating revokes admin access
// immediately (is_admin() requires isActive = true), without deleting the row
// or orphaning the linked Supabase Auth account.
async function handleDeactivateUser() {
  const id = document.getElementById('user-id').value;
  if (!id) return;

  const user = allUsers.find(u => u.id === id);
  const currentlyActive = user && user.isActive !== false;
  const message = currentlyActive
    ? "Deactivate this admin? They will immediately lose access."
    : "Reactivate this admin? They will be able to sign in again.";

  if (await window.bbAdminApp.confirmAction(message)) {
    const supabase = window.bbSupabase.getClient();
    try {
      const { error } = await supabase.from('AdminUser').update({ isActive: !currentlyActive }).eq('id', id);
      if (error) throw error;

      await supabase.from('AuditLog').insert({
        action: currentlyActive ? 'adminuser.deactivate' : 'adminuser.reactivate',
        entity: 'AdminUser', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: {}
      });
      window.bbAdminApp.showToast(currentlyActive ? "Admin deactivated" : "Admin reactivated");
      window.bbAdminApp.closeModal('user-modal');
      loadUsers();
    } catch (err) {
      console.error(err);
      window.bbAdminApp.showToast(err.message || "Failed to update admin user", "error");
    }
  }
}
