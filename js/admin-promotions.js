// Bumi & Bloom - Admin Promotions Logic

let allPromotions = [];

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadPromotions, 500);

  document.getElementById('btn-add-promotion').addEventListener('click', () => {
    openPromotionForm();
  });

  document.getElementById('promotion-form').addEventListener('submit', handleSavePromotion);
  document.getElementById('btn-delete-promotion').addEventListener('click', handleDeletePromotion);

  // Update the value input suffix when the type changes.
  document.getElementById('promotion-type').addEventListener('change', updateValueSuffix);
});

// PERCENTAGE: stored as rate (0.10). FIXED_AMOUNT: stored as cents (2000).
// toFixed avoids float artifacts like 0.1 * 100 === 10.000000000000002.
function promoValueToInput(promo) {
  if (!promo || promo.value == null) return '';
  if (promo.type === 'PERCENTAGE') return String(Number((promo.value * 100).toFixed(4)));
  return String(promo.value / 100);
}

function promoValueFromInput(inputVal, type) {
  const n = parseFloat(inputVal) || 0;
  if (type === 'PERCENTAGE') return n / 100;     // 10 -> 0.10
  return Math.round(n * 100);                      // 20 -> 2000
}

function promoValueDisplay(promo) {
  if (promo.value == null) return '-';
  if (promo.type === 'PERCENTAGE') return `${Number((promo.value * 100).toFixed(4))}%`;
  return `$${(promo.value / 100).toFixed(2)}`;
}

function updateValueSuffix() {
  const type = document.getElementById('promotion-type').value;
  const suffix = document.getElementById('promotion-value-suffix');
  if (suffix) suffix.textContent = type === 'PERCENTAGE' ? '%' : 'AUD';
}

// ISO timestamp -> datetime-local input value (local time).
function toDatetimeLocal(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadPromotions() {
  const supabase = window.bbSupabase.getClient();
  const tbody = document.getElementById('promotions-table-body');

  const { data, error } = await supabase
    .from('Promotion')
    .select('*')
    .order('createdAt', { ascending: false });

  if (error) {
    console.error(error);
    window.bbAdminApp.showToast("Failed to load promotions", "error");
    tbody.innerHTML = '<tr><td colspan="7">Error loading promotions.</td></tr>';
    return;
  }

  allPromotions = data;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No promotions found.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(p => `
    <tr>
      <td><strong>${p.code}</strong></td>
      <td>${p.label || '<span style="color: var(--text-muted);">—</span>'}</td>
      <td>${p.type === 'PERCENTAGE' ? 'Percentage' : 'Fixed Amount'}</td>
      <td>${promoValueDisplay(p)}</td>
      <td><span class="admin-badge ${p.isActive ? 'success' : 'neutral'}">${p.isActive ? 'Active' : 'Inactive'}</span></td>
      <td>${p.usedCount || 0}${p.usageLimit ? ' / ' + p.usageLimit : ''}</td>
      <td>
        <button class="btn-admin btn-admin--outline" style="padding: var(--space-1) var(--space-2); font-size: 0.8rem;" onclick="editPromotion('${p.id}')">Edit</button>
      </td>
    </tr>
  `).join('');
}

function openPromotionForm(promotion = null) {
  const form = document.getElementById('promotion-form');
  form.reset();

  document.getElementById('promotion-id').value = promotion ? promotion.id : '';
  document.getElementById('promotion-modal-title').textContent = promotion ? 'Edit Promotion' : 'Add Promotion';

  if (promotion) {
    document.getElementById('promotion-code').value = promotion.code || '';
    document.getElementById('promotion-label').value = promotion.label || '';
    document.getElementById('promotion-type').value = promotion.type || 'PERCENTAGE';
    document.getElementById('promotion-value').value = promoValueToInput(promotion);
    document.getElementById('promotion-starts-at').value = toDatetimeLocal(promotion.startsAt);
    document.getElementById('promotion-ends-at').value = toDatetimeLocal(promotion.endsAt);
    document.getElementById('promotion-usage-limit').value = promotion.usageLimit ?? '';
    document.getElementById('promotion-is-active').checked = promotion.isActive !== false;
    document.getElementById('btn-delete-promotion').style.display = 'inline-block';
  } else {
    document.getElementById('promotion-is-active').checked = true;
    document.getElementById('btn-delete-promotion').style.display = 'none';
  }

  updateValueSuffix();
  window.bbAdminApp.openModal('promotion-modal');
}

function editPromotion(id) {
  const promotion = allPromotions.find(p => p.id === id);
  if (promotion) openPromotionForm(promotion);
}

async function handleSavePromotion(e) {
  e.preventDefault();

  const id = document.getElementById('promotion-id').value;
  const isUpdate = !!id;
  const type = document.getElementById('promotion-type').value;

  const payload = {
    code: document.getElementById('promotion-code').value.trim().toUpperCase(),
    label: document.getElementById('promotion-label').value,
    type,
    value: promoValueFromInput(document.getElementById('promotion-value').value, type),
    currency: 'AUD',
    startsAt: document.getElementById('promotion-starts-at').value
      ? new Date(document.getElementById('promotion-starts-at').value).toISOString() : null,
    endsAt: document.getElementById('promotion-ends-at').value
      ? new Date(document.getElementById('promotion-ends-at').value).toISOString() : null,
    usageLimit: document.getElementById('promotion-usage-limit').value
      ? parseInt(document.getElementById('promotion-usage-limit').value, 10) : null,
    isActive: document.getElementById('promotion-is-active').checked,
  };

  const supabase = window.bbSupabase.getClient();
  const btn = document.getElementById('btn-save-promotion');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    if (isUpdate) {
      const { error } = await supabase.from('Promotion').update(payload).eq('id', id);
      if (error) throw error;

      await supabase.from('AuditLog').insert({
        action: 'promotion.update', entity: 'Promotion', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: { code: payload.code }
      });
      window.bbAdminApp.showToast("Promotion updated successfully");
    } else {
      payload.id = window.bbAdminApp.generateId();
      payload.usedCount = 0;
      const { data, error } = await supabase.from('Promotion').insert(payload).select().single();
      if (error) throw error;

      await supabase.from('AuditLog').insert({
        action: 'promotion.create', entity: 'Promotion', entityId: data.id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: { code: payload.code }
      });
      window.bbAdminApp.showToast("Promotion created successfully");
    }

    window.bbAdminApp.closeModal('promotion-modal');
    loadPromotions();
  } catch (err) {
    console.error(err);
    window.bbAdminApp.showToast(err.message || "Failed to save promotion", "error");
  } finally {
    btn.textContent = 'Save Promotion';
    btn.disabled = false;
  }
}

async function handleDeletePromotion() {
  const id = document.getElementById('promotion-id').value;
  if (!id) return;

  if (await window.bbAdminApp.confirmAction("Are you sure you want to delete this promotion?")) {
    const supabase = window.bbSupabase.getClient();
    try {
      const { error } = await supabase.from('Promotion').delete().eq('id', id);
      if (error) throw error;

      await supabase.from('AuditLog').insert({
        action: 'promotion.delete', entity: 'Promotion', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: {}
      });
      window.bbAdminApp.showToast("Promotion deleted successfully");
      window.bbAdminApp.closeModal('promotion-modal');
      loadPromotions();
    } catch (err) {
      console.error(err);
      window.bbAdminApp.showToast(err.message || "Failed to delete promotion", "error");
    }
  }
}
