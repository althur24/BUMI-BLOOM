// Bumi & Bloom - Admin Collections Logic

let allCollections = [];

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadCollections, 500);

  document.getElementById('btn-add-collection').addEventListener('click', () => {
    openCollectionForm();
  });

  document.getElementById('collection-form').addEventListener('submit', handleSaveCollection);
  document.getElementById('btn-delete-collection').addEventListener('click', handleDeleteCollection);
});

async function loadCollections() {
  const supabase = window.bbSupabase.getClient();
  const tbody = document.getElementById('collections-table-body');

  const { data, error } = await supabase
    .from('Collection')
    .select('*')
    .order('sortOrder', { ascending: true });

  if (error) {
    console.error(error);
    window.bbAdminApp.showToast("Failed to load collections", "error");
    tbody.innerHTML = '<tr><td colspan="5">Error loading collections.</td></tr>';
    return;
  }

  allCollections = data;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No collections found.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(c => `
    <tr>
      <td><strong>${c.name}</strong><br><small style="color: var(--text-muted);">${c.slug}</small></td>
      <td>${c.kind ? `<span class="admin-badge neutral">${c.kind}</span>` : '<span style="color: var(--text-muted);">—</span>'}</td>
      <td><span class="admin-badge ${c.status === 'PUBLISHED' ? 'success' : 'neutral'}">${c.status}</span></td>
      <td>${c.sortOrder ?? 0}</td>
      <td>
        <button class="btn-admin btn-admin--outline" style="padding: var(--space-1) var(--space-2); font-size: 0.8rem;" onclick="editCollection('${c.id}')">Edit</button>
      </td>
    </tr>
  `).join('');
}

function openCollectionForm(collection = null) {
  const form = document.getElementById('collection-form');
  form.reset();

  document.getElementById('collection-id').value = collection ? collection.id : '';
  document.getElementById('collection-modal-title').textContent = collection ? 'Edit Collection' : 'Add Collection';

  if (collection) {
    document.getElementById('collection-name').value = collection.name || '';
    document.getElementById('collection-slug').value = collection.slug || '';
    document.getElementById('collection-kind').value = collection.kind || '';
    document.getElementById('collection-sort-order').value = collection.sortOrder ?? 0;
    document.getElementById('collection-status').value = collection.status || 'PUBLISHED';
    document.getElementById('collection-description').value = collection.description || '';
    document.getElementById('btn-delete-collection').style.display = 'inline-block';
  } else {
    document.getElementById('collection-sort-order').value = 0;
    document.getElementById('btn-delete-collection').style.display = 'none';
  }

  window.bbAdminApp.openModal('collection-modal');
}

function editCollection(id) {
  const collection = allCollections.find(c => c.id === id);
  if (collection) openCollectionForm(collection);
}

async function handleSaveCollection(e) {
  e.preventDefault();

  const id = document.getElementById('collection-id').value;
  const isUpdate = !!id;
  const name = document.getElementById('collection-name').value;
  let slug = document.getElementById('collection-slug').value.trim();

  if (!slug) slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const payload = {
    name,
    slug,
    kind: document.getElementById('collection-kind').value || null,
    description: document.getElementById('collection-description').value || null,
    status: document.getElementById('collection-status').value,
    sortOrder: parseInt(document.getElementById('collection-sort-order').value, 10) || 0,
  };

  const supabase = window.bbSupabase.getClient();
  const btn = document.getElementById('btn-save-collection');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    if (isUpdate) {
      const { error } = await supabase.from('Collection').update(payload).eq('id', id);
      if (error) throw error;

      await supabase.from('AuditLog').insert({
        action: 'collection.update', entity: 'Collection', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: { name }
      });
      window.bbAdminApp.showToast("Collection updated successfully");
    } else {
      payload.id = window.bbAdminApp.generateId();
      const { data, error } = await supabase.from('Collection').insert(payload).select().single();
      if (error) throw error;

      await supabase.from('AuditLog').insert({
        action: 'collection.create', entity: 'Collection', entityId: data.id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: { name }
      });
      window.bbAdminApp.showToast("Collection created successfully");
    }

    window.bbAdminApp.closeModal('collection-modal');
    loadCollections();
  } catch (err) {
    console.error(err);
    window.bbAdminApp.showToast(err.message || "Failed to save collection", "error");
  } finally {
    btn.textContent = 'Save Collection';
    btn.disabled = false;
  }
}

async function handleDeleteCollection() {
  const id = document.getElementById('collection-id').value;
  if (!id) return;

  if (await window.bbAdminApp.confirmAction("Are you sure you want to delete this collection?")) {
    const supabase = window.bbSupabase.getClient();
    try {
      const { error } = await supabase.from('Collection').delete().eq('id', id);
      if (error) throw error;

      await supabase.from('AuditLog').insert({
        action: 'collection.delete', entity: 'Collection', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: {}
      });
      window.bbAdminApp.showToast("Collection deleted successfully");
      window.bbAdminApp.closeModal('collection-modal');
      loadCollections();
    } catch (err) {
      console.error(err);
      window.bbAdminApp.showToast(err.message || "Failed to delete collection", "error");
    }
  }
}
