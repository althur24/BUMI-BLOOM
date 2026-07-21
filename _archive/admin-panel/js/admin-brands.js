// Bumi & Bloom - Admin Brands Logic

let allBrands = [];

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadBrands, 500);

  document.getElementById('btn-add-brand').addEventListener('click', () => {
    openBrandForm();
  });

  document.getElementById('brand-form').addEventListener('submit', handleSaveBrand);
  document.getElementById('btn-delete-brand').addEventListener('click', handleDeleteBrand);
});

async function loadBrands() {
  const supabase = window.bbSupabase.getClient();
  const tbody = document.getElementById('brands-table-body');
  
  const { data, error } = await supabase
    .from('Brand')
    .select('*')
    .order('name');
    
  if (error) {
    console.error(error);
    window.bbAdminApp.showToast("Failed to load brands", "error");
    tbody.innerHTML = '<tr><td colspan="5">Error loading brands.</td></tr>';
    return;
  }
  
  allBrands = data;
  
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No brands found.</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(b => `
    <tr>
      <td><strong>${b.name}</strong><br><small style="color: var(--text-muted);">${b.slug}</small></td>
      <td>${b.city}, ${b.country}</td>
      <td>${b.audience}</td>
      <td><span class="admin-badge ${b.status === 'PUBLISHED' ? 'success' : 'neutral'}">${b.status}</span></td>
      <td>
        <button class="btn-admin btn-admin--outline" style="padding: var(--space-1) var(--space-2); font-size: 0.8rem;" onclick="editBrand('${b.id}')">Edit</button>
      </td>
    </tr>
  `).join('');
}

function openBrandForm(brand = null) {
  const form = document.getElementById('brand-form');
  form.reset();
  
  document.getElementById('brand-id').value = brand ? brand.id : '';
  document.getElementById('brand-modal-title').textContent = brand ? 'Edit Brand' : 'Add Brand';
  
  if (brand) {
    document.getElementById('brand-name').value = brand.name || '';
    document.getElementById('brand-slug').value = brand.slug || '';
    document.getElementById('brand-city').value = brand.city || '';
    document.getElementById('brand-country').value = brand.country || 'Indonesia';
    document.getElementById('brand-audience').value = brand.audience || 'UNISEX';
    document.getElementById('brand-status').value = brand.status || 'DRAFT';
    document.getElementById('brand-desc').value = brand.shortDesc || '';
    document.getElementById('btn-delete-brand').style.display = 'inline-block';
  } else {
    document.getElementById('btn-delete-brand').style.display = 'none';
  }
  
  window.bbAdminApp.openModal('brand-modal');
}

function editBrand(id) {
  const brand = allBrands.find(b => b.id === id);
  if (brand) openBrandForm(brand);
}

async function handleSaveBrand(e) {
  e.preventDefault();
  
  const id = document.getElementById('brand-id').value;
  const isUpdate = !!id;
  const name = document.getElementById('brand-name').value;
  let slug = document.getElementById('brand-slug').value.trim();
  
  if (!slug) slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  
  const payload = {
    name,
    slug,
    city: document.getElementById('brand-city').value,
    country: document.getElementById('brand-country').value,
    audience: document.getElementById('brand-audience').value,
    status: document.getElementById('brand-status').value,
    shortDesc: document.getElementById('brand-desc').value,
  };
  
  const supabase = window.bbSupabase.getClient();
  const btn = document.getElementById('btn-save-brand');
  btn.textContent = 'Saving...';
  btn.disabled = true;
  
  try {
    if (isUpdate) {
      const { error } = await supabase.from('Brand').update(payload).eq('id', id);
      if (error) throw error;
      
      await supabase.from('AuditLog').insert({
        action: 'brand.update', entity: 'Brand', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: { name }
      });
      window.bbAdminApp.showToast("Brand updated successfully");
    } else {
      payload.id = window.bbAdminApp.generateId();
      const { data, error } = await supabase.from('Brand').insert(payload).select().single();
      if (error) throw error;
      
      await supabase.from('AuditLog').insert({
        action: 'brand.create', entity: 'Brand', entityId: data.id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: { name }
      });
      window.bbAdminApp.showToast("Brand created successfully");
    }
    
    window.bbAdminApp.closeModal('brand-modal');
    loadBrands();
  } catch (err) {
    console.error(err);
    window.bbAdminApp.showToast(err.message || "Failed to save brand", "error");
  } finally {
    btn.textContent = 'Save Brand';
    btn.disabled = false;
  }
}

async function handleDeleteBrand() {
  const id = document.getElementById('brand-id').value;
  if (!id) return;
  
  if (await window.bbAdminApp.confirmAction("Are you sure you want to delete this brand?")) {
    const supabase = window.bbSupabase.getClient();
    try {
      // Pre-check for linked products to avoid FK constraint error
      const { count } = await supabase.from('Product').select('*', { count: 'exact', head: true }).eq('brandId', id);
      if (count && count > 0) {
        window.bbAdminApp.showToast(`Cannot delete brand: It is linked to ${count} product(s). Delete or reassign products first.`, "error");
        return;
      }
      
      const { error } = await supabase.from('Brand').delete().eq('id', id);
      if (error) throw error;
      
      await supabase.from('AuditLog').insert({
        action: 'brand.delete', entity: 'Brand', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: {}
      });
      window.bbAdminApp.showToast("Brand deleted successfully");
      window.bbAdminApp.closeModal('brand-modal');
      loadBrands();
    } catch (err) {
      console.error(err);
      window.bbAdminApp.showToast(err.message || "Failed to delete brand", "error");
    }
  }
}

