// Bumi & Bloom - Admin Products Logic

let allProducts = [];
let allBrands = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Populate ProductType enum options (single source of truth in admin-app.js).
  window.bbAdminApp.populateProductTypes(document.getElementById('product-category'));

  // Wait a tiny bit for auth to resolve
  setTimeout(() => {
    loadBrands();
    loadProducts();
  }, 500);

  // Setup event listeners
  document.getElementById('btn-add-product').addEventListener('click', () => {
    openProductForm();
  });

  document.getElementById('product-form').addEventListener('submit', handleSaveProduct);
  document.getElementById('btn-delete-product').addEventListener('click', handleDeleteProduct);
  
  document.getElementById('search-products').addEventListener('input', debounce(() => {
    renderProductsTable();
  }, 300));
  
  document.getElementById('filter-brand').addEventListener('change', () => {
    renderProductsTable();
  });
  
  document.getElementById('filter-status').addEventListener('change', () => {
    renderProductsTable();
  });

  // Color & size option rows
  document.getElementById('btn-add-color').addEventListener('click', () => addColorRow());
  document.getElementById('btn-add-size').addEventListener('click', () => addSizeRow());
  document.getElementById('product-colors-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.product-remove-color');
    if (btn) btn.closest('.product-color-row').remove();
  });
  document.getElementById('product-sizes-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.product-remove-size');
    if (btn) btn.closest('.product-size-row').remove();
  });
});

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const REMOVE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

// ── Color & Size option rows ──
function addColorRow(name = '', hex = '#cccccc') {
  const list = document.getElementById('product-colors-list');
  const row = document.createElement('div');
  row.className = 'product-color-row';
  row.style.cssText = 'display: flex; align-items: center; gap: var(--space-2);';
  row.innerHTML = `
    <input type="color" class="product-color-picker" value="${hex}" style="width: 42px; height: 42px; padding: 0; border: 1px solid var(--border-color); border-radius: var(--radius-sm); cursor: pointer; background: none;" aria-label="Color swatch">
    <input type="text" class="admin-input product-color-name" placeholder="Color name (e.g. Khaki)" style="flex: 1;">
    <button type="button" class="btn-admin btn-admin--outline product-remove-color" style="padding: var(--space-2); border: none;" aria-label="Remove color">${REMOVE_ICON}</button>
  `;
  row.querySelector('.product-color-name').value = name;
  list.appendChild(row);
}

function addSizeRow(value = '') {
  const list = document.getElementById('product-sizes-list');
  const row = document.createElement('div');
  row.className = 'product-size-row';
  row.style.cssText = 'display: flex; align-items: center; gap: var(--space-2);';
  row.innerHTML = `
    <input type="text" class="admin-input product-size-value" placeholder="Size (e.g. 3T)" style="flex: 1;">
    <button type="button" class="btn-admin btn-admin--outline product-remove-size" style="padding: var(--space-2); border: none;" aria-label="Remove size">${REMOVE_ICON}</button>
  `;
  row.querySelector('.product-size-value').value = value;
  list.appendChild(row);
}

function readColors() {
  const seen = new Set();
  const out = [];
  document.querySelectorAll('#product-colors-list .product-color-row').forEach((row) => {
    const name = row.querySelector('.product-color-name').value.trim();
    const hex = row.querySelector('.product-color-picker').value || '#cccccc';
    const key = name.toLowerCase();
    if (name && !seen.has(key)) { seen.add(key); out.push({ name, hex }); }
  });
  return out;
}

function readSizes() {
  const seen = new Set();
  const out = [];
  document.querySelectorAll('#product-sizes-list .product-size-row').forEach((row) => {
    const v = row.querySelector('.product-size-value').value.trim();
    const key = v.toLowerCase();
    if (v && !seen.has(key)) { seen.add(key); out.push(v); }
  });
  return out;
}

// Rebuild the color/size rows from a product (or seed one empty row each for "Add").
function populateProductOptions(product) {
  const colorList = document.getElementById('product-colors-list');
  const sizeList = document.getElementById('product-sizes-list');
  colorList.innerHTML = '';
  sizeList.innerHTML = '';

  const colors = (product && Array.isArray(product.ProductColor)) ? product.ProductColor : [];
  const sortedColors = [...colors].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (sortedColors.length) {
    sortedColors.forEach((c) => addColorRow(c.name || '', c.hex || '#cccccc'));
  } else {
    addColorRow();
  }

  const variants = (product && Array.isArray(product.ProductVariant)) ? product.ProductVariant : [];
  const sizes = Array.from(new Set(variants.map((v) => v.size)));
  if (sizes.length) {
    sizes.forEach((s) => addSizeRow(s));
  } else {
    addSizeRow();
  }
}

async function loadBrands() {
  const supabase = window.bbSupabase.getClient();
  const { data, error } = await supabase.from('Brand').select('id, name').order('name');
  
  if (!error && data) {
    allBrands = data;
    const filterSelect = document.getElementById('filter-brand');
    const formSelect = document.getElementById('product-brand');
    
    const options = data.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    filterSelect.innerHTML += options;
    formSelect.innerHTML += options;
  }
}

async function loadProducts() {
  const supabase = window.bbSupabase.getClient();
  const tbody = document.getElementById('products-table-body');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading products...</td></tr>';
  
  const { data, error } = await supabase
    .from('Product')
    .select(`
      *,
      Brand(name),
      ProductImage(sortOrder,isPrimary,MediaAsset(publicUrl)),
      ProductColor(name),
      ProductVariant(size)
    `)
    .order('createdAt', { ascending: false });
    
  if (error) {
    console.error("Error fetching products:", error);
    window.bbAdminApp.showToast("Failed to load products", "error");
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--color-red);">Failed to load products.</td></tr>';
    return;
  }
  
  allProducts = data;
  renderProductsTable();
}

function renderProductsTable() {
  const tbody = document.getElementById('products-table-body');
  const searchTerm = document.getElementById('search-products').value.toLowerCase();
  const filterBrand = document.getElementById('filter-brand').value;
  const filterStatus = document.getElementById('filter-status').value;
  
  let filtered = allProducts.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(searchTerm) || p.slug.toLowerCase().includes(searchTerm);
    const matchBrand = filterBrand ? p.brandId === filterBrand : true;
    const matchStatus = filterStatus ? p.status === filterStatus : true;
    return matchSearch && matchBrand && matchStatus;
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No products found.</td></tr>';
    return;
  }
  
  tbody.innerHTML = filtered.map(p => {
    const primaryImg = p.ProductImage?.find(img => img.isPrimary) || p.ProductImage?.[0];
    const imgSrc = (primaryImg && primaryImg.MediaAsset && primaryImg.MediaAsset.publicUrl) ? `../${primaryImg.MediaAsset.publicUrl}` : '../images/placeholder.png';
    const statusBadge = `<span class="admin-badge ${p.status === 'PUBLISHED' ? 'success' : p.status === 'DRAFT' ? 'warning' : 'neutral'}">${p.status}</span>`;
    
    return `
      <tr>
        <td><img src="${imgSrc}" class="thumbnail" alt="${p.name}"></td>
        <td><strong>${p.name}</strong><br><small style="color: var(--text-muted);">${p.slug}</small></td>
        <td>${p.Brand?.name || 'Unknown'}</td>
        <td>${window.bbAdminApp.formatPrice(p.priceAudCents)}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn-admin btn-admin--outline" style="padding: var(--space-1) var(--space-2); font-size: 0.8rem;" onclick="editProduct('${p.id}')">Edit</button>
        </td>
      </tr>
    `;
  }).join('');
}

function openProductForm(product = null) {
  const form = document.getElementById('product-form');
  form.reset();
  
  document.getElementById('product-id').value = product ? product.id : '';
  document.getElementById('product-modal-title').textContent = product ? 'Edit Product' : 'Add Product';
  
  if (product) {
    document.getElementById('product-name').value = product.name || '';
    document.getElementById('product-slug').value = product.slug || '';
    document.getElementById('product-brand').value = product.brandId || '';
    document.getElementById('product-category').value = product.category || 'TSHIRTS';
    document.getElementById('product-audience').value = product.audience || 'UNISEX';
    document.getElementById('product-status').value = product.status || 'DRAFT';
    document.getElementById('product-price').value = (product.priceAudCents / 100).toFixed(2);
    if (product.compareAtAudCents) {
      document.getElementById('product-compare-at').value = (product.compareAtAudCents / 100).toFixed(2);
    }
    document.getElementById('product-badge').value = product.badge || '';
    document.getElementById('product-fibre').value = product.fibre || '';
    document.getElementById('product-material').value = product.material || '';
    document.getElementById('product-description').value = product.description || '';
    
    // Read Image URL
    const primaryImg = product.ProductImage?.find(img => img.isPrimary) || product.ProductImage?.[0];
    document.getElementById('product-image').value = (primaryImg && primaryImg.MediaAsset && primaryImg.MediaAsset.publicUrl) || '';

    document.getElementById('btn-delete-product').style.display = 'inline-block';
  } else {
    document.getElementById('btn-delete-product').style.display = 'none';
  }

  populateProductOptions(product);
  window.bbAdminApp.openModal('product-modal');
}

function editProduct(id) {
  const product = allProducts.find(p => p.id === id);
  if (product) openProductForm(product);
}

async function handleSaveProduct(e) {
  e.preventDefault();
  
  const id = document.getElementById('product-id').value;
  const isUpdate = !!id;
  const name = document.getElementById('product-name').value;
  let slug = document.getElementById('product-slug').value.trim();
  
  if (!slug) {
    slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  
  const payload = {
    name,
    slug,
    brandId: document.getElementById('product-brand').value,
    category: document.getElementById('product-category').value,
    audience: document.getElementById('product-audience').value,
    status: document.getElementById('product-status').value,
    priceAudCents: Math.round(parseFloat(document.getElementById('product-price').value) * 100),
    badge: document.getElementById('product-badge').value || null,
    fibre: document.getElementById('product-fibre').value,
    material: document.getElementById('product-material').value,
    description: document.getElementById('product-description').value,
  };
  
  const compareAt = document.getElementById('product-compare-at').value;
  if (compareAt) {
    payload.compareAtAudCents = Math.round(parseFloat(compareAt) * 100);
  } else {
    payload.compareAtAudCents = null;
  }
  
  const imageUrl = document.getElementById('product-image').value.trim();
  const colorsList = readColors();   // [{ name, hex }]
  const sizesList = readSizes();     // ['2T', '3T', ...]
  
  const supabase = window.bbSupabase.getClient();
  const btn = document.getElementById('btn-save-product');
  btn.textContent = 'Saving...';
  btn.disabled = true;
  
  try {
    let savedProductId = id;
    
    if (isUpdate) {
      const { error } = await supabase.from('Product').update(payload).eq('id', id);
      if (error) throw error;
      
      await supabase.from('AuditLog').insert({
        action: 'product.update',
        entity: 'Product',
        entityId: id,
        actorId: window.currentAdminUser.id,
        actorEmail: window.currentAdminUser.email,
        detail: { fields: Object.keys(payload) }
      });
    } else {
      payload.id = window.bbAdminApp.generateId();
      const { data, error } = await supabase.from('Product').insert(payload).select().single();
      if (error) throw error;
      savedProductId = data.id;
      
      await supabase.from('AuditLog').insert({
        action: 'product.create',
        entity: 'Product',
        entityId: data.id,
        actorId: window.currentAdminUser.id,
        actorEmail: window.currentAdminUser.email,
        detail: { name: data.name }
      });
    }
    
    // Save Colors
    await supabase.from('ProductColor').delete().eq('productId', savedProductId);
    if (colorsList.length > 0) {
      const colorInserts = colorsList.map((c, i) => ({
        id: window.bbAdminApp.generateId(),
        productId: savedProductId, name: c.name, hex: c.hex, sortOrder: i
      }));
      await supabase.from('ProductColor').insert(colorInserts);
    }
    
    // Save Sizes & Variants
    await supabase.from('ProductVariant').delete().eq('productId', savedProductId);
    if (sizesList.length > 0) {
      const { data: savedColors } = await supabase.from('ProductColor').select('id, name').eq('productId', savedProductId);
      
      const variantInserts = [];
      
      // If we have colors, create size variants for EACH color
      if (savedColors && savedColors.length > 0) {
        for (const c of savedColors) {
          for (const s of sizesList) {
            variantInserts.push({
              id: window.bbAdminApp.generateId(),
              productId: savedProductId,
              colorId: c.id,
              size: s,
              sku: `${slug}-${c.name.substring(0,3)}-${s}`.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
              stock: 50
            });
          }
        }
      } else {
        // No colors, just sizes
        for (const s of sizesList) {
          variantInserts.push({
            id: window.bbAdminApp.generateId(),
            productId: savedProductId,
            colorId: null,
            size: s,
            sku: `${slug}-${s}`.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
            stock: 50
          });
        }
      }
      
      await supabase.from('ProductVariant').insert(variantInserts);
    }
    
    // Save Image URL
    await supabase.from('ProductImage').delete().eq('productId', savedProductId);
    if (imageUrl) {
      let { data: asset } = await supabase.from('MediaAsset')
        .select('*')
        .eq('bucket', 'products')
        .eq('storagePath', imageUrl.replace(/^images\//, ''))
        .maybeSingle();
        
      if (!asset) {
        const { data: newAsset } = await supabase.from('MediaAsset').insert({
          id: window.bbAdminApp.generateId(),
          bucket: 'products',
          storagePath: imageUrl.replace(/^images\//, ''),
          publicUrl: imageUrl,
          fileName: imageUrl.split('/').pop(),
          mimeType: 'image/png',
          type: 'IMAGE'
        }).select().single();
        asset = newAsset;
      }
      
      if (asset) {
        await supabase.from('ProductImage').insert({
          id: window.bbAdminApp.generateId(),
          productId: savedProductId,
          assetId: asset.id,
          sortOrder: 0,
          isPrimary: true,
          altText: name
        });
      }
    }
    
    window.bbAdminApp.showToast(isUpdate ? "Product updated successfully" : "Product created successfully");
    window.bbAdminApp.closeModal('product-modal');
    loadProducts(); // refresh
  } catch (err) {
    console.error("Save error:", err);
    window.bbAdminApp.showToast(err.message || "Failed to save product", "error");
  } finally {
    btn.textContent = 'Save Product';
    btn.disabled = false;
  }
}

async function handleDeleteProduct() {
  const id = document.getElementById('product-id').value;
  if (!id) return;
  
  if (await window.bbAdminApp.confirmAction("Are you sure you want to delete this product?")) {
    const supabase = window.bbSupabase.getClient();
    
    try {
      // Note: In real app, might just archive it. Let's delete.
      const { error } = await supabase.from('Product').delete().eq('id', id);
      if (error) throw error;
      
      await supabase.from('AuditLog').insert({
        action: 'product.delete', entity: 'Product', entityId: id, actorId: window.currentAdminUser.id, actorEmail: window.currentAdminUser.email, detail: {}
      });
      
      window.bbAdminApp.showToast("Product deleted successfully");
      window.bbAdminApp.closeModal('product-modal');
      loadProducts();
    } catch (err) {
      console.error(err);
      window.bbAdminApp.showToast(err.message || "Failed to delete product", "error");
    }
  }
}

