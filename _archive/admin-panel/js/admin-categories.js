// Bumi & Bloom - Admin Categories Logic

let allCategories = [];

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadCategories, 500);

  document.getElementById('btn-add-category').addEventListener('click', () => {
    openCategoryForm();
  });

  document.getElementById('category-form').addEventListener('submit', handleSaveCategory);
  document.getElementById('btn-delete-category').addEventListener('click', handleDeleteCategory);
});

async function loadCategories() {
  const supabase = window.bbSupabase.getClient();
  const tbody = document.getElementById('categories-table-body');
  
  const { data, error } = await supabase
    .from('Category')
    .select('*')
    .order('name');
    
  if (error) {
    console.error(error);
    window.bbAdminApp.showToast("Failed to load categories", "error");
    tbody.innerHTML = '<tr><td colspan="4">Error loading categories.</td></tr>';
    return;
  }
  
  allCategories = data;
  
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No categories found.</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(c => `
    <tr>
      <td><strong>${c.name}</strong><br><small style="color: var(--text-muted);">${c.slug}</small></td>
      <td><span class="admin-badge ${c.status === 'PUBLISHED' ? 'success' : 'neutral'}">${c.status}</span></td>
      <td>${c.menuVisible ? 'Yes' : 'No'}</td>
      <td>
        <button class="btn-admin btn-admin--outline" style="padding: var(--space-1) var(--space-2); font-size: 0.8rem;" onclick="editCategory('${c.id}')">Edit</button>
      </td>
    </tr>
  `).join('');
}

function openCategoryForm(category = null) {
  const form = document.getElementById('category-form');
  form.reset();
  
  document.getElementById('category-id').value = category ? category.id : '';
  document.getElementById('category-modal-title').textContent = category ? 'Edit Category' : 'Add Category';
  
  if (category) {
    document.getElementById('category-name').value = category.name || '';
    document.getElementById('category-slug').value = category.slug || '';
    document.getElementById('category-status').value = category.status || 'PUBLISHED';
    document.getElementById('category-menu-visible').checked = category.menuVisible !== false;
    document.getElementById('btn-delete-category').style.display = 'inline-block';
  } else {
    document.getElementById('category-menu-visible').checked = true;
    document.getElementById('btn-delete-category').style.display = 'none';
  }
  
  window.bbAdminApp.openModal('category-modal');
}

function editCategory(id) {
  const category = allCategories.find(c => c.id === id);
  if (category) openCategoryForm(category);
}

async function handleSaveCategory(e) {
  e.preventDefault();
  
  const id = document.getElementById('category-id').value;
  const isUpdate = !!id;
  const name = document.getElementById('category-name').value;
  let slug = document.getElementById('category-slug').value.trim();
  
  if (!slug) slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  
  const payload = {
    name,
    slug,
    status: document.getElementById('category-status').value,
    menuVisible: document.getElementById('category-menu-visible').checked,
  };
  
  const supabase = window.bbSupabase.getClient();
  const btn = document.getElementById('btn-save-category');
  btn.textContent = 'Saving...';
  btn.disabled = true;
  
  try {
    if (isUpdate) {
      const { error } = await supabase.from('Category').update(payload).eq('id', id);
      if (error) throw error;
      
      await supabase.from('AuditLog').insert({
        action: 'category.update', entity: 'Category', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: { name }
      });
      window.bbAdminApp.showToast("Category updated successfully");
    } else {
      payload.id = window.bbAdminApp.generateId();
      const { data, error } = await supabase.from('Category').insert(payload).select().single();
      if (error) throw error;
      
      await supabase.from('AuditLog').insert({
        action: 'category.create', entity: 'Category', entityId: data.id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: { name }
      });
      window.bbAdminApp.showToast("Category created successfully");
    }
    
    window.bbAdminApp.closeModal('category-modal');
    loadCategories();
  } catch (err) {
    console.error(err);
    window.bbAdminApp.showToast(err.message || "Failed to save category", "error");
  } finally {
    btn.textContent = 'Save Category';
    btn.disabled = false;
  }
}

async function handleDeleteCategory() {
  const id = document.getElementById('category-id').value;
  if (!id) return;
  
  if (await window.bbAdminApp.confirmAction("Are you sure you want to delete this category?")) {
    const supabase = window.bbSupabase.getClient();
    try {
      const { error } = await supabase.from('Category').delete().eq('id', id);
      if (error) throw error;
      
      await supabase.from('AuditLog').insert({
        action: 'category.delete', entity: 'Category', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: {}
      });
      window.bbAdminApp.showToast("Category deleted successfully");
      window.bbAdminApp.closeModal('category-modal');
      loadCategories();
    } catch (err) {
      console.error(err);
      window.bbAdminApp.showToast(err.message || "Failed to delete category", "error");
    }
  }
}

