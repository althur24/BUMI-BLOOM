/* ============================================
   BUMI / BLOOM — Admin Panel
   Single-page tabbed admin talking DIRECTLY to
   Supabase from the browser (anon key + RLS).
   Every write is gated server-side by is_admin();
   this client only renders what RLS allows and
   mirrors each mutation into AuditLog.

   Tabs: Dashboard · Products · Brands ·
   Categories · Collections · Promotions
   ============================================ */

(function () {
  'use strict';

  /* ── Shared state ── */
  let client = null;
  const state = { admin: null, tab: 'dashboard' };

  const AUDIENCES = ['GIRLS', 'BOYS', 'BABY', 'UNISEX'];
  const PRODUCT_TYPES = ['TSHIRTS', 'SHORTS', 'DRESSES', 'OUTERWEAR', 'ACCESSORIES', 'BABY'];
  const BADGES = ['NEW', 'BESTSELLER', 'SALE'];
  const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
  const STATUS_BADGE = { PUBLISHED: 'badge--green', DRAFT: 'badge--yellow', ARCHIVED: 'badge--coral' };
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* Cents → "$49" / "$49.95" (whole dollars when exact, storefront parity). */
  function fmtCents(cents) {
    const d = (cents || 0) / 100;
    return '$' + (Number.isInteger(d)
      ? d.toLocaleString('en-AU')
      : d.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }

  /* "49.95" → 4995, "" / junk → null. */
  function toCents(str) {
    if (str === '' || str == null) return null;
    const n = parseFloat(str);
    return Number.isNaN(n) ? null : Math.round(n * 100);
  }

  function slugify(s) {
    return String(s || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /* Prisma's @default(cuid()) is applied by the Prisma client, not Postgres —
     browser inserts via PostgREST must supply their own id. */
  function newId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  }

  /* ISO → value for <input type="datetime-local"> (local wall time). */
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function statusBadge(status) {
    return '<span class="badge ' + (STATUS_BADGE[status] || 'badge--dark') + '">' + esc(status) + '</span>';
  }

  /* ── Toast ── */
  let toastTimer = null;
  function toast(msg, type) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast is-active' + (type ? ' toast--' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-active'), 3500);
  }

  function fail(err, fallback) {
    console.error(fallback, err);
    toast(fallback + (err && err.message ? ': ' + err.message : ''), 'error');
  }

  /* ── Modal ── */
  function openModal(html, opts) {
    const modal = $('modal');
    modal.classList.toggle('modal--wide', !!(opts && opts.wide));
    modal.innerHTML = '<button type="button" class="modal__close" id="modal-close" aria-label="Close">✕</button>' + html;
    $('modal-overlay').classList.add('is-active');
    modal.classList.add('is-active');
    $('modal-close').addEventListener('click', closeModal);
  }

  function closeModal() {
    $('modal-overlay').classList.remove('is-active');
    $('modal').classList.remove('is-active');
    if (state.tab === 'products') refreshProducts();
  }

  /* ── Audit trail (admin SELECT + INSERT per RLS) ── */
  async function audit(action, entity, entityId, detail) {
    try {
      await client.from('AuditLog').insert({
        actorId: state.admin ? state.admin.id : null,
        actorEmail: state.admin ? state.admin.email : null,
        action: action,
        entity: entity,
        entityId: entityId == null ? null : String(entityId),
        detail: detail || null
      });
    } catch (err) {
      console.error('AuditLog insert failed', err);
    }
  }

  /* ────────────────────────────────────────────
     AUTH
     ──────────────────────────────────────────── */

  /* Own-row policy lets the caller read ONLY their own AdminUser row. */
  async function verifyAdmin(session) {
    try {
      const { data, error } = await client
        .from('AdminUser')
        .select('id,email,name,role,isActive')
        .eq('email', session.user.email)
        .single();
      if (error || !data || !data.isActive) return null;
      return data;
    } catch {
      return null;
    }
  }

  function showLogin() {
    state.admin = null;
    $('admin-shell').classList.remove('is-active');
    $('admin-login').classList.add('is-active');
  }

  function showShell(admin) {
    state.admin = admin;
    $('admin-login').classList.remove('is-active');
    $('admin-shell').classList.add('is-active');
    $('admin-user-name').textContent = admin.name || admin.email;
    $('admin-user-role').textContent = String(admin.role || '').replace(/_/g, ' ');
    switchTab('dashboard');
  }

  function wireAuth() {
    $('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('login-submit');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      const reset = () => { btn.disabled = false; btn.textContent = 'Sign In'; };
      try {
        const { data, error } = await window.bbSupabase.signIn($('login-email').value.trim(), $('login-password').value);
        if (error || !data.session) {
          toast((error && error.message) || 'Sign-in failed.', 'error');
          reset();
          return;
        }
        const admin = await verifyAdmin(data.session);
        if (!admin) {
          await window.bbSupabase.signOut();
          toast('This account is not authorized for the admin panel.', 'error');
          reset();
          return;
        }
        showShell(admin);
      } catch (err) {
        fail(err, 'Sign-in failed');
      }
      reset();
    });

    $('sign-out-btn').addEventListener('click', async () => {
      await window.bbSupabase.signOut();
      showLogin();
    });
  }

  /* ────────────────────────────────────────────
     ROUTER / TABS
     ──────────────────────────────────────────── */

  const TAB_LOADERS = {
    dashboard: loadDashboard,
    products: loadProducts,
    brands: loadBrands,
    categories: loadCategories,
    collections: loadCollections,
    promotions: loadPromotions
  };

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.admin-nav__item').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.tab === tab));
    document.querySelectorAll('.admin-tab').forEach((p) =>
      p.classList.toggle('is-active', p.dataset.tabPanel === tab));
    TAB_LOADERS[tab]();
  }

  function wireNav() {
    document.querySelectorAll('.admin-nav__item').forEach((b) =>
      b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('modal-overlay').addEventListener('click', closeModal);
  }

  /* ────────────────────────────────────────────
     DASHBOARD
     ──────────────────────────────────────────── */

  async function loadDashboard() {
    const el = $('tab-dashboard');
    el.innerHTML = '<h2 class="admin-tab__title">Dashboard</h2><p>Loading…</p>';

    const [prodRes, promoRes, varRes, logRes] = await Promise.all([
      client.from('Product').select('id,status').is('deletedAt', null),
      client.from('Promotion').select('id').eq('isActive', true),
      client.from('ProductVariant')
        .select('id,size,sku,stock,lowStockThreshold,productId,Product(name,slug),ProductColor(name)'),
      client.from('AuditLog')
        .select('createdAt,actorEmail,action,entity,entityId')
        .order('createdAt', { ascending: false })
        .limit(10)
    ]);
    if (prodRes.error) return fail(prodRes.error, 'Could not load products');
    if (varRes.error) return fail(varRes.error, 'Could not load variants');

    const counts = { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
    (prodRes.data || []).forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });
    const lowStock = (varRes.data || []).filter((v) => v.stock <= v.lowStockThreshold);
    const logs = logRes.error ? [] : (logRes.data || []);

    el.innerHTML =
      '<h2 class="admin-tab__title">Dashboard</h2>' +
      '<div class="stat-cards">' +
        statCard(counts.PUBLISHED, 'Published products') +
        statCard(counts.DRAFT, 'Draft products') +
        statCard(counts.ARCHIVED, 'Archived products') +
        statCard(promoRes.error ? '—' : (promoRes.data || []).length, 'Active promotions') +
        statCard(lowStock.length, 'Low-stock variants', lowStock.length > 0) +
      '</div>' +

      '<h3 class="admin-section-title">Low stock</h3>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>Product</th><th>SKU</th><th>Color</th><th>Size</th><th>Stock</th><th>Threshold</th>' +
      '</tr></thead><tbody>' +
      (lowStock.length
        ? lowStock.map((v) =>
            '<tr data-lowstock-product="' + esc(v.productId) + '" style="cursor:pointer;" title="Open product">' +
              '<td><strong>' + esc(v.Product ? v.Product.name : '—') + '</strong></td>' +
              '<td>' + esc(v.sku || '—') + '</td>' +
              '<td>' + esc(v.ProductColor ? v.ProductColor.name : '—') + '</td>' +
              '<td>' + esc(v.size) + '</td>' +
              '<td><span class="badge badge--coral">' + v.stock + '</span></td>' +
              '<td>' + v.lowStockThreshold + '</td>' +
            '</tr>').join('')
        : '<tr><td colspan="6" class="admin-table__empty">No variants below their low-stock threshold. 🎉</td></tr>') +
      '</tbody></table></div>' +

      '<h3 class="admin-section-title">Recent activity</h3>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>Time</th><th>Actor</th><th>Action</th><th>Entity</th>' +
      '</tr></thead><tbody>' +
      (logs.length
        ? logs.map((l) =>
            '<tr>' +
              '<td>' + esc(fmtDateTime(l.createdAt)) + '</td>' +
              '<td>' + esc(l.actorEmail || '—') + '</td>' +
              '<td><code>' + esc(l.action) + '</code></td>' +
              '<td>' + esc(l.entity || '—') + (l.entityId ? ' · ' + esc(l.entityId) : '') + '</td>' +
            '</tr>').join('')
        : '<tr><td colspan="4" class="admin-table__empty">No audit entries yet.</td></tr>') +
      '</tbody></table></div>';

    el.querySelectorAll('[data-lowstock-product]').forEach((row) =>
      row.addEventListener('click', () => openProductModal(row.dataset.lowstockProduct)));
  }

  function statCard(value, label, accent) {
    return '<div class="stat-card' + (accent ? ' stat-card--accent' : '') + '">' +
      '<div class="stat-card__value">' + esc(value) + '</div>' +
      '<div class="stat-card__label">' + esc(label) + '</div></div>';
  }

  /* ────────────────────────────────────────────
     PRODUCTS
     ──────────────────────────────────────────── */

  const prodState = { q: '', status: 'ALL', rows: [] };

  function loadProducts() {
    const el = $('tab-products');
    el.innerHTML =
      '<h2 class="admin-tab__title">Products</h2>' +
      '<div class="admin-toolbar">' +
        '<input type="search" class="input admin-toolbar__search" id="product-search" placeholder="Search by name or slug…" value="' + esc(prodState.q) + '">' +
        '<select class="select" id="product-status-filter">' +
          '<option value="ALL"' + (prodState.status === 'ALL' ? ' selected' : '') + '>All statuses</option>' +
          STATUSES.map((s) => '<option value="' + s + '"' + (prodState.status === s ? ' selected' : '') + '>' + s + '</option>').join('') +
        '</select>' +
        '<span class="admin-toolbar__spacer"></span>' +
        '<button type="button" class="btn btn--primary" id="product-new">+ New product</button>' +
      '</div>' +
      '<div id="products-table"><p>Loading…</p></div>';

    $('product-search').addEventListener('input', (e) => { prodState.q = e.target.value; renderProductsTable(); });
    $('product-status-filter').addEventListener('change', (e) => { prodState.status = e.target.value; renderProductsTable(); });
    $('product-new').addEventListener('click', () => openProductModal(null));
    refreshProducts();
  }

  async function refreshProducts() {
    const { data, error } = await client
      .from('Product')
      .select('id,slug,name,priceAudCents,status,Brand(name),ProductVariant(stock),ProductImage(isPrimary,sortOrder,MediaAsset(publicUrl))')
      .is('deletedAt', null)
      .order('name');
    if (error) {
      fail(error, 'Could not load products');
      return;
    }
    prodState.rows = data || [];
    renderProductsTable();
  }

  function primaryImageUrl(p) {
    const imgs = (p.ProductImage || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const primary = imgs.find((i) => i.isPrimary) || imgs[0];
    return (primary && primary.MediaAsset && primary.MediaAsset.publicUrl) || '';
  }

  function renderProductsTable() {
    const wrap = $('products-table');
    if (!wrap) return;
    const q = prodState.q.trim().toLowerCase();
    const rows = prodState.rows.filter((p) => {
      if (prodState.status !== 'ALL' && p.status !== prodState.status) return false;
      if (q && !(p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))) return false;
      return true;
    });

    wrap.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th></th><th>Name</th><th>Brand</th><th>Category</th><th>Price</th><th>Status</th><th>Stock</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      (rows.length
        ? rows.map((p) => {
            const img = primaryImageUrl(p);
            const stock = (p.ProductVariant || []).reduce((sum, v) => sum + (v.stock || 0), 0);
            return '<tr>' +
              '<td>' + (img
                ? '<img class="admin-table__thumb" src="' + esc(img) + '" alt="">'
                : '<span class="admin-table__thumb"></span>') + '</td>' +
              '<td><strong>' + esc(p.name) + '</strong><br><small style="opacity:0.6;">' + esc(p.slug) + '</small></td>' +
              '<td>' + esc(p.Brand ? p.Brand.name : '—') + '</td>' +
              '<td>' + esc(p.category || '—') + '</td>' +
              '<td>' + fmtCents(p.priceAudCents) + '</td>' +
              '<td>' + statusBadge(p.status) + '</td>' +
              '<td>' + stock + '</td>' +
              '<td><div class="admin-table__actions">' +
                '<button type="button" class="btn btn--ghost btn--sm" data-edit="' + esc(p.id) + '">Edit</button>' +
                (p.status === 'ARCHIVED'
                  ? '<button type="button" class="btn btn--green btn--sm" data-restore="' + esc(p.id) + '">Restore</button>'
                  : '<button type="button" class="btn btn--accent btn--sm" data-archive="' + esc(p.id) + '">Archive</button>') +
              '</div></td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="8" class="admin-table__empty">No products match.</td></tr>') +
      '</tbody></table></div>';

    wrap.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => openProductModal(b.dataset.edit)));
    wrap.querySelectorAll('[data-archive]').forEach((b) =>
      b.addEventListener('click', () => setProductStatus(b.dataset.archive, 'ARCHIVED')));
    wrap.querySelectorAll('[data-restore]').forEach((b) =>
      b.addEventListener('click', () => setProductStatus(b.dataset.restore, 'PUBLISHED')));
  }

  /* Soft delete: status ARCHIVED (Product has no public "delete" — RLS is status-based). */
  async function setProductStatus(id, status) {
    const { error } = await client.from('Product').update({ status: status }).eq('id', id);
    if (error) return fail(error, 'Could not update product');
    await audit(status === 'ARCHIVED' ? 'product.archive' : 'product.restore', 'Product', id, { status: status });
    toast(status === 'ARCHIVED' ? 'Product archived.' : 'Product restored.', 'success');
    refreshProducts();
  }

  /* ── Product create / edit modal ── */

  async function openProductModal(productId) {
    const brandsRes = await client.from('Brand')
      .select('id,name').is('deletedAt', null).order('name');
    if (brandsRes.error) return fail(brandsRes.error, 'Could not load brands');

    let product = null;
    if (productId) {
      const { data, error } = await client
        .from('Product')
        .select('*')
        .eq('id', productId)
        .single();
      if (error) return fail(error, 'Could not load product');
      product = data;
    }

    openModal(productFormHTML(product, brandsRes.data || []), { wide: true });
    wireProductForm(product);
    if (product) {
      renderImageManager(product);
      renderVariantSection(product);
      renderColorSection(product);
    }
  }

  function productFormHTML(p, brands) {
    const v = (key) => (p && p[key] != null ? p[key] : '');
    const checked = (key) => (p && p[key] ? ' checked' : '');
    return '<h3 class="modal__title">' + (p ? 'Edit product' : 'New product') + '</h3>' +
      '<form id="product-form"><div class="form-grid">' +

        '<div class="field"><label class="field__label">Name <span class="req">*</span></label>' +
          '<input class="input" name="name" required value="' + esc(v('name')) + '"></div>' +

        '<div class="field"><label class="field__label">Slug <span class="req">*</span></label>' +
          '<input class="input" name="slug" required value="' + esc(v('slug')) + '"' + (p ? '' : ' placeholder="auto-generated-from-name"') + '>' +
          (p
            ? '<p class="form-grid__warning">Changing the slug breaks storefront links and saved carts that use the old slug.</p>'
            : '<p class="form-grid__hint">Auto-filled from the name — edit only if needed.</p>') +
        '</div>' +

        '<div class="field"><label class="field__label">Brand <span class="req">*</span></label>' +
          '<select class="select" name="brandId" required>' +
            '<option value="">— choose —</option>' +
            brands.map((b) => '<option value="' + esc(b.id) + '"' + (p && p.brandId === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') +
          '</select></div>' +

        '<div class="field"><label class="field__label">Audience</label>' +
          '<select class="select" name="audience">' +
            AUDIENCES.map((a) => '<option value="' + a + '"' + (p && p.audience === a ? ' selected' : '') + '>' + a + '</option>').join('') +
          '</select></div>' +

        '<div class="field"><label class="field__label">Category</label>' +
          '<select class="select" name="category">' +
            PRODUCT_TYPES.map((c) => '<option value="' + c + '"' + (p && p.category === c ? ' selected' : '') + '>' + c + '</option>').join('') +
          '</select></div>' +

        '<div class="field"><label class="field__label">Status</label>' +
          '<select class="select" name="status">' +
            STATUSES.map((s) => '<option value="' + s + '"' + ((p ? p.status : 'DRAFT') === s ? ' selected' : '') + '>' + s + '</option>').join('') +
          '</select></div>' +

        '<div class="field"><label class="field__label">Price (AUD) <span class="req">*</span></label>' +
          '<input class="input" name="priceAud" type="number" min="0" step="0.01" required value="' + (p ? (p.priceAudCents / 100).toFixed(2) : '') + '"></div>' +

        '<div class="field"><label class="field__label">Compare-at price (AUD)</label>' +
          '<input class="input" name="compareAtAud" type="number" min="0" step="0.01" value="' + (p && p.compareAtAudCents != null ? (p.compareAtAudCents / 100).toFixed(2) : '') + '">' +
          '<p class="form-grid__hint">Crossed-out RRP — leave empty for none.</p></div>' +

        '<div class="field"><label class="field__label">Fibre</label>' +
          '<input class="input" name="fibre" value="' + esc(v('fibre')) + '" placeholder="e.g. 100% organic cotton"></div>' +

        '<div class="field"><label class="field__label">Material / care</label>' +
          '<input class="input" name="material" value="' + esc(v('material')) + '" placeholder="e.g. Machine wash cold"></div>' +

        '<div class="field"><label class="field__label">Badge</label>' +
          '<select class="select" name="badge">' +
            '<option value="">None</option>' +
            BADGES.map((b) => '<option value="' + b + '"' + (p && p.badge === b ? ' selected' : '') + '>' + b + '</option>').join('') +
          '</select></div>' +

        '<div class="field"><label class="field__label">Flags</label>' +
          '<label class="form-grid__check"><input type="checkbox" name="isNew"' + checked('isNew') + '> New arrival</label>' +
          '<label class="form-grid__check"><input type="checkbox" name="isBestseller"' + checked('isBestseller') + '> Bestseller</label>' +
        '</div>' +

        '<div class="field form-grid__full"><label class="field__label">Description</label>' +
          '<textarea class="input" name="description" rows="4">' + esc(v('description')) + '</textarea></div>' +

      '</div>' +
      '<div class="modal__actions">' +
        '<button type="button" class="btn btn--ghost" id="product-cancel">Cancel</button>' +
        '<button type="submit" class="btn btn--primary">' + (p ? 'Save changes' : 'Create product') + '</button>' +
      '</div></form>' +

      (p
        ? '<div class="modal__section" id="image-manager-section">' +
            '<h4 class="modal__section-title">Images</h4><div id="image-manager"><p>Loading…</p></div>' +
          '</div>' +
          '<div class="modal__section">' +
            '<h4 class="modal__section-title">Colors</h4><div id="color-manager"><p>Loading…</p></div>' +
          '</div>' +
          '<div class="modal__section">' +
            '<h4 class="modal__section-title">Variants (stock)</h4><div id="variant-manager"><p>Loading…</p></div>' +
          '</div>'
        : '<p class="form-grid__hint" style="margin-top:var(--space-4);">Save the product first — then you can add images, colors and variants.</p>');
  }

  function wireProductForm(p) {
    const form = $('product-form');
    $('product-cancel').addEventListener('click', closeModal);

    /* Auto-slugify from name until the slug field is manually touched (create only). */
    if (!p) {
      const nameInput = form.elements.name;
      const slugInput = form.elements.slug;
      nameInput.addEventListener('input', () => {
        if (!slugInput.dataset.touched) slugInput.value = slugify(nameInput.value);
      });
      slugInput.addEventListener('input', () => { slugInput.dataset.touched = '1'; });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const priceCents = toCents(fd.get('priceAud'));
      const payload = {
        name: String(fd.get('name') || '').trim(),
        slug: slugify(fd.get('slug')),
        brandId: fd.get('brandId') || null,
        audience: fd.get('audience'),
        category: fd.get('category'),
        status: fd.get('status'),
        priceAudCents: priceCents == null ? 0 : priceCents,
        compareAtAudCents: toCents(fd.get('compareAtAud')),
        fibre: String(fd.get('fibre') || '').trim() || null,
        material: String(fd.get('material') || '').trim() || null,
        description: String(fd.get('description') || '').trim() || null,
        badge: fd.get('badge') || null,
        isNew: fd.get('isNew') === 'on',
        isBestseller: fd.get('isBestseller') === 'on'
      };
      if (!payload.name || !payload.slug || !payload.brandId) {
        toast('Name, slug and brand are required.', 'error');
        return;
      }

      if (p) {
        const { error } = await client.from('Product').update(payload).eq('id', p.id);
        if (error) return fail(error, 'Could not save product');
        await audit('product.update', 'Product', p.id, { slug: payload.slug });
        if (payload.slug !== p.slug) {
          toast('Saved — note the slug changed, so old storefront links to "' + p.slug + '" will break.', 'error');
        } else {
          toast('Product saved.', 'success');
        }
        closeModal();
      } else {
        const { data, error } = await client.from('Product').insert({ id: newId(), updatedAt: new Date().toISOString(), ...payload }).select().single();
        if (error) return fail(error, 'Could not create product');
        await audit('product.create', 'Product', data.id, { slug: payload.slug });
        toast('Product created — now add images, colors and variants.', 'success');
        refreshProducts();
        openProductModal(data.id); // reopen in edit mode
      }
    });
  }

  /* ── Image manager ── */

  async function fetchProductImages(productId) {
    const { data, error } = await client
      .from('ProductImage')
      .select('id,assetId,altText,sortOrder,isPrimary,MediaAsset(id,bucket,storagePath,publicUrl)')
      .eq('productId', productId)
      .order('sortOrder');
    if (error) fail(error, 'Could not load images');
    return data || [];
  }

  async function renderImageManager(product) {
    const container = $('image-manager');
    if (!container) return;
    const images = await fetchProductImages(product.id);

    container.innerHTML =
      '<div class="image-manager__grid">' +
      images.map((img, i) =>
        '<div class="image-manager__item' + (img.isPrimary ? ' is-primary' : '') + '">' +
          '<img class="image-manager__img" src="' + esc(img.MediaAsset ? img.MediaAsset.publicUrl : '') + '" alt="' + esc(img.altText || '') + '">' +
          '<button type="button" class="image-manager__primary' + (img.isPrimary ? ' is-active' : '') + '" data-primary="' + esc(img.id) + '" title="Set as primary">★</button>' +
          '<input class="image-manager__alt" data-alt="' + esc(img.id) + '" value="' + esc(img.altText || '') + '" placeholder="Alt text">' +
          '<div class="image-manager__controls">' +
            '<button type="button" class="btn btn--ghost" data-move-up="' + esc(img.id) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" class="btn btn--ghost" data-move-down="' + esc(img.id) + '"' + (i === images.length - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button type="button" class="btn btn--accent" data-delete-image="' + esc(img.id) + '">Delete</button>' +
          '</div>' +
        '</div>').join('') +
      '</div>' +
      '<div class="image-manager__upload">' +
        '<input type="file" id="image-upload" accept="image/jpeg,image/png,image/webp,image/gif">' +
        '<span class="image-manager__hint">JPEG, PNG, WebP or GIF · max 5 MB</span>' +
      '</div>';

    $('image-upload').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadProductImage(product, file);
    });
    container.querySelectorAll('[data-primary]').forEach((b) =>
      b.addEventListener('click', () => setPrimaryImage(product, b.dataset.primary)));
    container.querySelectorAll('[data-alt]').forEach((input) =>
      input.addEventListener('change', () => saveImageAlt(product, input.dataset.alt, input.value)));
    container.querySelectorAll('[data-move-up]').forEach((b) =>
      b.addEventListener('click', () => moveImage(product, b.dataset.moveUp, -1)));
    container.querySelectorAll('[data-move-down]').forEach((b) =>
      b.addEventListener('click', () => moveImage(product, b.dataset.moveDown, 1)));
    container.querySelectorAll('[data-delete-image]').forEach((b) =>
      b.addEventListener('click', () => deleteProductImage(product, b.dataset.deleteImage)));
  }

  async function uploadProductImage(product, file) {
    if (!IMAGE_TYPES.includes(file.type)) {
      toast('Only JPEG, PNG, WebP or GIF images are allowed.', 'error');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast('Image must be 5 MB or smaller.', 'error');
      return;
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const path = product.id + '/' + Date.now() + '-' + safeName;

    const { error: upErr } = await client.storage.from('products').upload(path, file, { contentType: file.type });
    if (upErr) return fail(upErr, 'Upload failed');

    const { data: pub } = client.storage.from('products').getPublicUrl(path);
    const { data: asset, error: assetErr } = await client.from('MediaAsset').insert({
      id: newId(),
      updatedAt: new Date().toISOString(),
      bucket: 'products',
      storagePath: path,
      publicUrl: pub.publicUrl,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      type: 'IMAGE',
      tags: []
    }).select().single();
    if (assetErr) return fail(assetErr, 'Could not register the image');

    const existing = await fetchProductImages(product.id);
    const nextOrder = existing.length ? Math.max.apply(null, existing.map((i) => i.sortOrder || 0)) + 1 : 0;
    const { error: linkErr } = await client.from('ProductImage').insert({
      id: newId(),
      productId: product.id,
      assetId: asset.id,
      altText: file.name.replace(/\.[^.]+$/, ''),
      sortOrder: nextOrder,
      isPrimary: existing.length === 0
    });
    if (linkErr) return fail(linkErr, 'Could not attach the image');

    await audit('product.image.add', 'Product', product.id, { path: path });
    toast('Image uploaded.', 'success');
    renderImageManager(product);
  }

  async function setPrimaryImage(product, imageId) {
    const { error: clearErr } = await client.from('ProductImage')
      .update({ isPrimary: false }).eq('productId', product.id);
    if (clearErr) return fail(clearErr, 'Could not update primary image');
    const { error } = await client.from('ProductImage')
      .update({ isPrimary: true }).eq('id', imageId);
    if (error) return fail(error, 'Could not update primary image');
    await audit('product.image.primary', 'Product', product.id, { imageId: imageId });
    renderImageManager(product);
  }

  async function saveImageAlt(product, imageId, altText) {
    const { error } = await client.from('ProductImage')
      .update({ altText: altText.trim() || null }).eq('id', imageId);
    if (error) return fail(error, 'Could not save alt text');
    await audit('product.image.alt', 'Product', product.id, { imageId: imageId, altText: altText.trim() });
    toast('Alt text saved.', 'success');
  }

  async function moveImage(product, imageId, dir) {
    const images = await fetchProductImages(product.id);
    const idx = images.findIndex((i) => i.id === imageId);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= images.length) return;
    const a = images[idx];
    const b = images[swap];
    const { error: e1 } = await client.from('ProductImage').update({ sortOrder: b.sortOrder }).eq('id', a.id);
    const { error: e2 } = await client.from('ProductImage').update({ sortOrder: a.sortOrder }).eq('id', b.id);
    if (e1 || e2) return fail(e1 || e2, 'Could not reorder images');
    await audit('product.image.reorder', 'Product', product.id, { imageId: imageId, direction: dir });
    renderImageManager(product);
  }

  /* Hard delete: join row + MediaAsset row + storage object (per delete semantics). */
  async function deleteProductImage(product, imageId) {
    if (!window.confirm('Delete this image? This removes the file from storage too.')) return;
    const images = await fetchProductImages(product.id);
    const img = images.find((i) => i.id === imageId);
    if (!img) return;

    const { error: linkErr } = await client.from('ProductImage').delete().eq('id', img.id);
    if (linkErr) return fail(linkErr, 'Could not delete image');
    const { error: assetErr } = await client.from('MediaAsset').delete().eq('id', img.assetId);
    if (assetErr) return fail(assetErr, 'Could not delete media asset');
    if (img.MediaAsset) {
      await client.storage.from(img.MediaAsset.bucket).remove([img.MediaAsset.storagePath]);
    }
    await audit('product.image.delete', 'Product', product.id, { imageId: img.id });
    toast('Image deleted.', 'success');
    renderImageManager(product);
  }

  /* ── Color manager ── */

  async function fetchProductColors(productId) {
    const { data, error } = await client
      .from('ProductColor')
      .select('id,name,hex,sortOrder')
      .eq('productId', productId)
      .order('sortOrder');
    if (error) fail(error, 'Could not load colors');
    return data || [];
  }

  async function renderColorSection(product) {
    const container = $('color-manager');
    if (!container) return;
    const colors = await fetchProductColors(product.id);

    container.innerHTML =
      '<div class="color-grid">' +
      colors.map((c) =>
        '<div class="color-grid__row">' +
          '<input class="input" data-color-name="' + esc(c.id) + '" value="' + esc(c.name) + '" placeholder="Color name">' +
          '<input type="color" class="color-grid__hex" data-color-hex="' + esc(c.id) + '" value="' + esc(c.hex || '#CCCCCC') + '">' +
          '<button type="button" class="btn btn--accent btn--sm" data-color-delete="' + esc(c.id) + '">Delete</button>' +
        '</div>').join('') +
      '</div>' +
      '<div class="color-grid__row">' +
        '<input class="input" id="color-new-name" placeholder="New color name, e.g. Khaki">' +
        '<input type="color" class="color-grid__hex" id="color-new-hex" value="#B9A88A">' +
        '<button type="button" class="btn btn--secondary btn--sm" id="color-add">+ Add</button>' +
      '</div>';

    container.querySelectorAll('[data-color-name]').forEach((input) =>
      input.addEventListener('change', () =>
        updateColor(product, input.dataset.colorName, { name: input.value.trim() })));
    container.querySelectorAll('[data-color-hex]').forEach((input) =>
      input.addEventListener('change', () =>
        updateColor(product, input.dataset.colorHex, { hex: input.value })));
    container.querySelectorAll('[data-color-delete]').forEach((b) =>
      b.addEventListener('click', () => deleteColor(product, b.dataset.colorDelete)));
    $('color-add').addEventListener('click', () => addColor(product));
  }

  async function addColor(product) {
    const name = $('color-new-name').value.trim();
    const hex = $('color-new-hex').value;
    if (!name) {
      toast('Give the color a name first.', 'error');
      return;
    }
    const { error } = await client.from('ProductColor').insert({ id: newId(), productId: product.id, name: name, hex: hex });
    if (error) return fail(error, 'Could not add color (name must be unique per product)');
    await audit('product.color.add', 'Product', product.id, { name: name, hex: hex });
    toast('Color added.', 'success');
    renderColorSection(product);
    renderVariantSection(product); // variant color selects reference colors
  }

  async function updateColor(product, colorId, patch) {
    const { error } = await client.from('ProductColor').update(patch).eq('id', colorId);
    if (error) return fail(error, 'Could not update color');
    await audit('product.color.update', 'Product', product.id, { colorId: colorId, patch: patch });
    toast('Color saved.', 'success');
    renderVariantSection(product);
  }

  /* Hard delete: join row only (variants keep colorId → set null by FK). */
  async function deleteColor(product, colorId) {
    if (!window.confirm('Delete this color? Variants using it will lose their color.')) return;
    const { error } = await client.from('ProductColor').delete().eq('id', colorId);
    if (error) return fail(error, 'Could not delete color');
    await audit('product.color.delete', 'Product', product.id, { colorId: colorId });
    toast('Color deleted.', 'success');
    renderColorSection(product);
    renderVariantSection(product);
  }

  /* ── Variant manager ── */

  async function fetchProductVariants(productId) {
    const { data, error } = await client
      .from('ProductVariant')
      .select('id,colorId,size,sku,stock,lowStockThreshold,priceOverrideAudCents')
      .eq('productId', productId)
      .order('size');
    if (error) fail(error, 'Could not load variants');
    return data || [];
  }

  async function renderVariantSection(product) {
    const container = $('variant-manager');
    if (!container) return;
    const [variants, colors] = await Promise.all([
      fetchProductVariants(product.id),
      fetchProductColors(product.id)
    ]);

    const colorOptions = (selected) =>
      '<option value="">—</option>' +
      colors.map((c) => '<option value="' + esc(c.id) + '"' + (selected === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');

    container.innerHTML =
      '<div class="variant-grid">' +
        '<div class="variant-grid__row variant-grid__row--head">' +
          '<span>Color</span><span>Size</span><span>SKU</span><span>Stock</span><span>Low-stock at</span><span>Price override (AUD)</span><span></span>' +
        '</div>' +
        variants.map((v) =>
          '<div class="variant-grid__row">' +
            '<select class="select" data-variant-field="colorId" data-variant="' + esc(v.id) + '">' + colorOptions(v.colorId) + '</select>' +
            '<input class="input" data-variant-field="size" data-variant="' + esc(v.id) + '" value="' + esc(v.size) + '" placeholder="2T">' +
            '<input class="input" data-variant-field="sku" data-variant="' + esc(v.id) + '" value="' + esc(v.sku || '') + '" placeholder="slug-color-2T">' +
            '<input class="input" type="number" min="0" step="1" data-variant-field="stock" data-variant="' + esc(v.id) + '" value="' + v.stock + '">' +
            '<input class="input" type="number" min="0" step="1" data-variant-field="lowStockThreshold" data-variant="' + esc(v.id) + '" value="' + v.lowStockThreshold + '">' +
            '<input class="input" type="number" min="0" step="0.01" data-variant-field="priceOverride" data-variant="' + esc(v.id) + '" value="' + (v.priceOverrideAudCents != null ? (v.priceOverrideAudCents / 100).toFixed(2) : '') + '" placeholder="—">' +
            '<button type="button" class="btn btn--accent btn--sm" data-variant-delete="' + esc(v.id) + '">Delete</button>' +
          '</div>').join('') +
      '</div>' +
      (variants.length === 0 ? '<p class="form-grid__hint">No variants yet — add one per color × size combination.</p>' : '') +
      '<button type="button" class="btn btn--secondary btn--sm" id="variant-add">+ Add variant</button>';

    container.querySelectorAll('[data-variant-field]').forEach((input) =>
      input.addEventListener('change', () =>
        updateVariant(product, input.dataset.variant, input.dataset.variantField, input.value)));
    container.querySelectorAll('[data-variant-delete]').forEach((b) =>
      b.addEventListener('click', () => deleteVariant(product, b.dataset.variantDelete)));
    $('variant-add').addEventListener('click', () => addVariant(product));
  }

  async function addVariant(product) {
    const { error } = await client.from('ProductVariant').insert({
      id: newId(),
      productId: product.id,
      size: '2T',
      stock: 0
    });
    if (error) return fail(error, 'Could not add variant (color × size must be unique)');
    await audit('product.variant.add', 'Product', product.id, {});
    renderVariantSection(product);
  }

  async function updateVariant(product, variantId, field, raw) {
    let patch;
    if (field === 'colorId') patch = { colorId: raw || null };
    else if (field === 'size') patch = { size: raw.trim() };
    else if (field === 'sku') patch = { sku: raw.trim() || null };
    else if (field === 'stock') patch = { stock: Math.max(0, parseInt(raw, 10) || 0) };
    else if (field === 'lowStockThreshold') patch = { lowStockThreshold: Math.max(0, parseInt(raw, 10) || 0) };
    else if (field === 'priceOverride') patch = { priceOverrideAudCents: toCents(raw) };
    else return;

    const { error } = await client.from('ProductVariant').update(patch).eq('id', variantId);
    if (error) {
      fail(error, 'Could not save variant');
      renderVariantSection(product); // revert the input to the stored value
      return;
    }
    await audit('product.variant.update', 'ProductVariant', variantId, patch);
    toast('Variant saved.', 'success');
    if (state.tab === 'products') refreshProducts(); // keep the stock total fresh
  }

  /* Hard delete: join row only. */
  async function deleteVariant(product, variantId) {
    if (!window.confirm('Delete this variant?')) return;
    const { error } = await client.from('ProductVariant').delete().eq('id', variantId);
    if (error) return fail(error, 'Could not delete variant');
    await audit('product.variant.delete', 'ProductVariant', variantId, {});
    toast('Variant deleted.', 'success');
    renderVariantSection(product);
    if (state.tab === 'products') refreshProducts();
  }

  /* ────────────────────────────────────────────
     BRANDS
     ──────────────────────────────────────────── */

  const brandState = { rows: [] };

  function loadBrands() {
    const el = $('tab-brands');
    el.innerHTML =
      '<h2 class="admin-tab__title">Brands</h2>' +
      '<div class="admin-toolbar">' +
        '<span class="admin-toolbar__spacer"></span>' +
        '<button type="button" class="btn btn--primary" id="brand-new">+ New brand</button>' +
      '</div>' +
      '<div id="brands-table"><p>Loading…</p></div>';
    $('brand-new').addEventListener('click', () => openBrandModal(null));
    refreshBrands();
  }

  async function refreshBrands() {
    const { data, error } = await client
      .from('Brand')
      .select('id,slug,name,city,country,isFeatured,sortOrder,status,MediaAsset(publicUrl)')
      .is('deletedAt', null)
      .order('sortOrder')
      .order('name');
    if (error) return fail(error, 'Could not load brands');
    brandState.rows = data || [];
    renderBrandsTable();
  }

  function renderBrandsTable() {
    const wrap = $('brands-table');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th></th><th>Name</th><th>City</th><th>Featured</th><th>Sort</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      (brandState.rows.length
        ? brandState.rows.map((b) => {
            const logo = b.MediaAsset && b.MediaAsset.publicUrl;
            return '<tr>' +
              '<td>' + (logo
                ? '<img class="admin-table__thumb" src="' + esc(logo) + '" alt="">'
                : '<span class="admin-table__thumb"></span>') + '</td>' +
              '<td><strong>' + esc(b.name) + '</strong><br><small style="opacity:0.6;">' + esc(b.slug) + '</small></td>' +
              '<td>' + esc(b.city || '—') + '</td>' +
              '<td>' + (b.isFeatured ? '<span class="badge badge--blue">Featured</span>' : '—') + '</td>' +
              '<td>' + b.sortOrder + '</td>' +
              '<td>' + statusBadge(b.status) + '</td>' +
              '<td><div class="admin-table__actions">' +
                '<button type="button" class="btn btn--ghost btn--sm" data-brand-edit="' + esc(b.id) + '">Edit</button>' +
                (b.status === 'ARCHIVED'
                  ? '<button type="button" class="btn btn--green btn--sm" data-brand-restore="' + esc(b.id) + '">Restore</button>'
                  : '<button type="button" class="btn btn--accent btn--sm" data-brand-archive="' + esc(b.id) + '">Archive</button>') +
              '</div></td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="7" class="admin-table__empty">No brands yet.</td></tr>') +
      '</tbody></table></div>';

    wrap.querySelectorAll('[data-brand-edit]').forEach((b) =>
      b.addEventListener('click', () => openBrandModal(b.dataset.brandEdit)));
    wrap.querySelectorAll('[data-brand-archive]').forEach((b) =>
      b.addEventListener('click', () => setBrandStatus(b.dataset.brandArchive, 'ARCHIVED')));
    wrap.querySelectorAll('[data-brand-restore]').forEach((b) =>
      b.addEventListener('click', () => setBrandStatus(b.dataset.brandRestore, 'PUBLISHED')));
  }

  async function setBrandStatus(id, status) {
    const { error } = await client.from('Brand').update({ status: status }).eq('id', id);
    if (error) return fail(error, 'Could not update brand');
    await audit(status === 'ARCHIVED' ? 'brand.archive' : 'brand.restore', 'Brand', id, { status: status });
    toast(status === 'ARCHIVED' ? 'Brand archived.' : 'Brand restored.', 'success');
    refreshBrands();
  }

  function openBrandModal(brandId) {
    const b = brandId ? brandState.rows.find((r) => r.id === brandId) : null;
    if (brandId && !b) {
      toast('Could not load brand.', 'error');
      return;
    }
    const v = (key) => (b && b[key] != null ? b[key] : '');
    const logo = b && b.MediaAsset && b.MediaAsset.publicUrl;

    openModal(
      '<h3 class="modal__title">' + (b ? 'Edit brand' : 'New brand') + '</h3>' +
      '<form id="brand-form"><div class="form-grid">' +
        '<div class="field"><label class="field__label">Name <span class="req">*</span></label>' +
          '<input class="input" name="name" required value="' + esc(v('name')) + '"></div>' +
        '<div class="field"><label class="field__label">Slug <span class="req">*</span></label>' +
          '<input class="input" name="slug" required value="' + esc(v('slug')) + '"' + (b ? '' : ' placeholder="auto-generated-from-name"') + '></div>' +
        '<div class="field"><label class="field__label">City</label>' +
          '<input class="input" name="city" value="' + esc(v('city')) + '"></div>' +
        '<div class="field"><label class="field__label">Country</label>' +
          '<input class="input" name="country" value="' + esc(v('country') || 'Indonesia') + '"></div>' +
        '<div class="field"><label class="field__label">Website</label>' +
          '<input class="input" name="website" type="url" value="' + esc(v('website')) + '" placeholder="https://…"></div>' +
        '<div class="field"><label class="field__label">Instagram</label>' +
          '<input class="input" name="instagram" value="' + esc(v('instagram')) + '" placeholder="@handle"></div>' +
        '<div class="field"><label class="field__label">TikTok</label>' +
          '<input class="input" name="tiktok" value="' + esc(v('tiktok')) + '" placeholder="@handle"></div>' +
        '<div class="field"><label class="field__label">Sort order</label>' +
          '<input class="input" name="sortOrder" type="number" step="1" value="' + (b ? b.sortOrder : 0) + '"></div>' +
        '<div class="field"><label class="field__label">Status</label>' +
          '<select class="select" name="status">' +
            STATUSES.map((s) => '<option value="' + s + '"' + ((b ? b.status : 'PUBLISHED') === s ? ' selected' : '') + '>' + s + '</option>').join('') +
          '</select></div>' +
        '<div class="field"><label class="field__label">Flags</label>' +
          '<label class="form-grid__check"><input type="checkbox" name="isFeatured"' + (b && b.isFeatured ? ' checked' : '') + '> Featured brand</label>' +
        '</div>' +
        '<div class="field form-grid__full"><label class="field__label">Short description (card)</label>' +
          '<textarea class="input" name="shortDesc" rows="2" maxlength="280">' + esc(v('shortDesc')) + '</textarea></div>' +
      '</div>' +
      '<div class="modal__actions">' +
        '<button type="button" class="btn btn--ghost" id="brand-cancel">Cancel</button>' +
        '<button type="submit" class="btn btn--primary">' + (b ? 'Save changes' : 'Create brand') + '</button>' +
      '</div></form>' +
      (b
        ? '<div class="modal__section"><h4 class="modal__section-title">Logo</h4>' +
            '<div class="image-manager__upload">' +
              (logo ? '<img class="admin-table__thumb" src="' + esc(logo) + '" alt="">' : '<span class="admin-table__thumb"></span>') +
              '<input type="file" id="brand-logo-upload" accept="image/jpeg,image/png,image/webp,image/gif">' +
              '<span class="image-manager__hint">JPEG, PNG, WebP or GIF · max 5 MB</span>' +
            '</div></div>'
        : '<p class="form-grid__hint" style="margin-top:var(--space-4);">Save the brand first — then you can upload a logo.</p>'),
      { wide: true });

    wireBrandForm(b);
    if (b) {
      $('brand-logo-upload').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) uploadBrandLogo(b, file);
      });
    }
  }

  function wireBrandForm(b) {
    const form = $('brand-form');
    $('brand-cancel').addEventListener('click', closeModal);

    if (!b) {
      const nameInput = form.elements.name;
      const slugInput = form.elements.slug;
      nameInput.addEventListener('input', () => {
        if (!slugInput.dataset.touched) slugInput.value = slugify(nameInput.value);
      });
      slugInput.addEventListener('input', () => { slugInput.dataset.touched = '1'; });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: String(fd.get('name') || '').trim(),
        slug: slugify(fd.get('slug')),
        city: String(fd.get('city') || '').trim() || null,
        country: String(fd.get('country') || '').trim() || null,
        website: String(fd.get('website') || '').trim() || null,
        instagram: String(fd.get('instagram') || '').trim() || null,
        tiktok: String(fd.get('tiktok') || '').trim() || null,
        shortDesc: String(fd.get('shortDesc') || '').trim() || null,
        isFeatured: fd.get('isFeatured') === 'on',
        sortOrder: parseInt(fd.get('sortOrder'), 10) || 0,
        status: fd.get('status')
      };
      if (!payload.name || !payload.slug) {
        toast('Name and slug are required.', 'error');
        return;
      }
      if (b) {
        const { error } = await client.from('Brand').update(payload).eq('id', b.id);
        if (error) return fail(error, 'Could not save brand');
        await audit('brand.update', 'Brand', b.id, { slug: payload.slug });
        toast('Brand saved.', 'success');
        closeModal();
        refreshBrands();
      } else {
        const { data, error } = await client.from('Brand').insert({ id: newId(), updatedAt: new Date().toISOString(), ...payload }).select().single();
        if (error) return fail(error, 'Could not create brand');
        await audit('brand.create', 'Brand', data.id, { slug: payload.slug });
        toast('Brand created.', 'success');
        closeModal();
        refreshBrands();
      }
    });
  }

  async function uploadBrandLogo(brand, file) {
    if (!IMAGE_TYPES.includes(file.type)) {
      toast('Only JPEG, PNG, WebP or GIF images are allowed.', 'error');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast('Image must be 5 MB or smaller.', 'error');
      return;
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const path = brand.id + '/' + Date.now() + '-' + safeName;

    const { error: upErr } = await client.storage.from('brands').upload(path, file, { contentType: file.type });
    if (upErr) return fail(upErr, 'Upload failed');

    const { data: pub } = client.storage.from('brands').getPublicUrl(path);
    const { data: asset, error: assetErr } = await client.from('MediaAsset').insert({
      id: newId(),
      updatedAt: new Date().toISOString(),
      bucket: 'brands',
      storagePath: path,
      publicUrl: pub.publicUrl,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      type: 'LOGO',
      tags: []
    }).select().single();
    if (assetErr) return fail(assetErr, 'Could not register the logo');

    const { error: linkErr } = await client.from('Brand').update({ logoAssetId: asset.id }).eq('id', brand.id);
    if (linkErr) return fail(linkErr, 'Could not attach the logo');

    await audit('brand.logo.update', 'Brand', brand.id, { path: path });
    toast('Logo uploaded.', 'success');
    await refreshBrands();
    openBrandModal(brand.id); // re-render with the new logo
  }

  /* ────────────────────────────────────────────
     CATEGORIES
     ──────────────────────────────────────────── */

  const catState = { rows: [] };

  function loadCategories() {
    const el = $('tab-categories');
    el.innerHTML =
      '<h2 class="admin-tab__title">Categories</h2>' +
      '<div class="admin-toolbar">' +
        '<span class="admin-toolbar__spacer"></span>' +
        '<button type="button" class="btn btn--primary" id="category-new">+ New category</button>' +
      '</div>' +
      '<div id="categories-table"><p>Loading…</p></div>';
    $('category-new').addEventListener('click', () => openCategoryModal(null));
    refreshCategories();
  }

  async function refreshCategories() {
    const { data, error } = await client
      .from('Category')
      .select('id,slug,name,parentId,description,menuVisible,homeVisible,sortOrder,status')
      .is('deletedAt', null)
      .order('sortOrder')
      .order('name');
    if (error) return fail(error, 'Could not load categories');
    catState.rows = data || [];
    renderCategoriesTable();
  }

  function categoryName(id) {
    const c = catState.rows.find((r) => r.id === id);
    return c ? c.name : '—';
  }

  function renderCategoriesTable() {
    const wrap = $('categories-table');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>Name</th><th>Parent</th><th>Menu</th><th>Home</th><th>Sort</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      (catState.rows.length
        ? catState.rows.map((c) =>
            '<tr>' +
              '<td><strong>' + esc(c.name) + '</strong><br><small style="opacity:0.6;">' + esc(c.slug) + '</small></td>' +
              '<td>' + esc(c.parentId ? categoryName(c.parentId) : '—') + '</td>' +
              '<td>' + (c.menuVisible ? '✓' : '—') + '</td>' +
              '<td>' + (c.homeVisible ? '✓' : '—') + '</td>' +
              '<td>' + c.sortOrder + '</td>' +
              '<td>' + statusBadge(c.status) + '</td>' +
              '<td><div class="admin-table__actions">' +
                '<button type="button" class="btn btn--ghost btn--sm" data-cat-edit="' + esc(c.id) + '">Edit</button>' +
                (c.status === 'ARCHIVED'
                  ? '<button type="button" class="btn btn--green btn--sm" data-cat-restore="' + esc(c.id) + '">Restore</button>'
                  : '<button type="button" class="btn btn--accent btn--sm" data-cat-archive="' + esc(c.id) + '">Archive</button>') +
              '</div></td>' +
            '</tr>').join('')
        : '<tr><td colspan="7" class="admin-table__empty">No categories yet.</td></tr>') +
      '</tbody></table></div>';

    wrap.querySelectorAll('[data-cat-edit]').forEach((b) =>
      b.addEventListener('click', () => openCategoryModal(b.dataset.catEdit)));
    wrap.querySelectorAll('[data-cat-archive]').forEach((b) =>
      b.addEventListener('click', () => setCategoryStatus(b.dataset.catArchive, 'ARCHIVED')));
    wrap.querySelectorAll('[data-cat-restore]').forEach((b) =>
      b.addEventListener('click', () => setCategoryStatus(b.dataset.catRestore, 'PUBLISHED')));
  }

  async function setCategoryStatus(id, status) {
    const { error } = await client.from('Category').update({ status: status }).eq('id', id);
    if (error) return fail(error, 'Could not update category');
    await audit(status === 'ARCHIVED' ? 'category.archive' : 'category.restore', 'Category', id, { status: status });
    toast(status === 'ARCHIVED' ? 'Category archived.' : 'Category restored.', 'success');
    refreshCategories();
  }

  function openCategoryModal(catId) {
    const c = catId ? catState.rows.find((r) => r.id === catId) : null;
    if (catId && !c) {
      toast('Could not load category.', 'error');
      return;
    }
    const v = (key) => (c && c[key] != null ? c[key] : '');

    openModal(
      '<h3 class="modal__title">' + (c ? 'Edit category' : 'New category') + '</h3>' +
      '<form id="category-form"><div class="form-grid">' +
        '<div class="field"><label class="field__label">Name <span class="req">*</span></label>' +
          '<input class="input" name="name" required value="' + esc(v('name')) + '"></div>' +
        '<div class="field"><label class="field__label">Slug <span class="req">*</span></label>' +
          '<input class="input" name="slug" required value="' + esc(v('slug')) + '"' + (c ? '' : ' placeholder="auto-generated-from-name"') + '></div>' +
        '<div class="field"><label class="field__label">Parent</label>' +
          '<select class="select" name="parentId">' +
            '<option value="">— none (top level) —</option>' +
            catState.rows
              .filter((r) => !c || r.id !== c.id) // never offer self as parent
              .map((r) => '<option value="' + esc(r.id) + '"' + (c && c.parentId === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') +
          '</select></div>' +
        '<div class="field"><label class="field__label">Sort order</label>' +
          '<input class="input" name="sortOrder" type="number" step="1" value="' + (c ? c.sortOrder : 0) + '"></div>' +
        '<div class="field"><label class="field__label">Status</label>' +
          '<select class="select" name="status">' +
            STATUSES.map((s) => '<option value="' + s + '"' + ((c ? c.status : 'PUBLISHED') === s ? ' selected' : '') + '>' + s + '</option>').join('') +
          '</select></div>' +
        '<div class="field"><label class="field__label">Visibility</label>' +
          '<label class="form-grid__check"><input type="checkbox" name="menuVisible"' + (!c || c.menuVisible ? ' checked' : '') + '> Show in menu</label>' +
          '<label class="form-grid__check"><input type="checkbox" name="homeVisible"' + (c && c.homeVisible ? ' checked' : '') + '> Show on home page</label>' +
        '</div>' +
        '<div class="field form-grid__full"><label class="field__label">Description</label>' +
          '<textarea class="input" name="description" rows="3">' + esc(v('description')) + '</textarea></div>' +
      '</div>' +
      '<div class="modal__actions">' +
        '<button type="button" class="btn btn--ghost" id="category-cancel">Cancel</button>' +
        '<button type="submit" class="btn btn--primary">' + (c ? 'Save changes' : 'Create category') + '</button>' +
      '</div></form>');

    wireCategoryForm(c);
  }

  function wireCategoryForm(c) {
    const form = $('category-form');
    $('category-cancel').addEventListener('click', closeModal);

    if (!c) {
      const nameInput = form.elements.name;
      const slugInput = form.elements.slug;
      nameInput.addEventListener('input', () => {
        if (!slugInput.dataset.touched) slugInput.value = slugify(nameInput.value);
      });
      slugInput.addEventListener('input', () => { slugInput.dataset.touched = '1'; });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: String(fd.get('name') || '').trim(),
        slug: slugify(fd.get('slug')),
        parentId: fd.get('parentId') || null,
        description: String(fd.get('description') || '').trim() || null,
        menuVisible: fd.get('menuVisible') === 'on',
        homeVisible: fd.get('homeVisible') === 'on',
        sortOrder: parseInt(fd.get('sortOrder'), 10) || 0,
        status: fd.get('status')
      };
      if (!payload.name || !payload.slug) {
        toast('Name and slug are required.', 'error');
        return;
      }
      if (c && payload.parentId === c.id) {
        toast('A category cannot be its own parent.', 'error');
        return;
      }
      if (c) {
        const { error } = await client.from('Category').update(payload).eq('id', c.id);
        if (error) return fail(error, 'Could not save category');
        await audit('category.update', 'Category', c.id, { slug: payload.slug });
        toast('Category saved.', 'success');
      } else {
        const { data, error } = await client.from('Category').insert({ id: newId(), updatedAt: new Date().toISOString(), ...payload }).select().single();
        if (error) return fail(error, 'Could not create category');
        await audit('category.create', 'Category', data.id, { slug: payload.slug });
        toast('Category created.', 'success');
      }
      closeModal();
      refreshCategories();
    });
  }

  /* ────────────────────────────────────────────
     COLLECTIONS
     ──────────────────────────────────────────── */

  /* Prisma implicit M:N → join table "_CollectionToProduct" ("A" = Collection, "B" = Product). */
  const JOIN_TABLE = '_CollectionToProduct';
  const colState = { rows: [], counts: {} };

  function loadCollections() {
    const el = $('tab-collections');
    el.innerHTML =
      '<h2 class="admin-tab__title">Collections</h2>' +
      '<div class="admin-toolbar">' +
        '<span class="admin-toolbar__spacer"></span>' +
        '<button type="button" class="btn btn--primary" id="collection-new">+ New collection</button>' +
      '</div>' +
      '<div id="collections-table"><p>Loading…</p></div>';
    $('collection-new').addEventListener('click', () => openCollectionModal(null));
    refreshCollections();
  }

  async function refreshCollections() {
    const [colsRes, linksRes] = await Promise.all([
      client.from('Collection').select('id,slug,name,kind,sortOrder,status').order('sortOrder').order('name'),
      client.from(JOIN_TABLE).select('A,B')
    ]);
    if (colsRes.error) return fail(colsRes.error, 'Could not load collections');
    colState.rows = colsRes.data || [];
    colState.counts = {};
    if (!linksRes.error) {
      (linksRes.data || []).forEach((l) => {
        colState.counts[l.A] = (colState.counts[l.A] || 0) + 1;
      });
    }
    renderCollectionsTable();
  }

  function renderCollectionsTable() {
    const wrap = $('collections-table');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>Name</th><th>Kind</th><th>Products</th><th>Sort</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      (colState.rows.length
        ? colState.rows.map((c) =>
            '<tr>' +
              '<td><strong>' + esc(c.name) + '</strong><br><small style="opacity:0.6;">' + esc(c.slug) + '</small></td>' +
              '<td>' + esc(c.kind || '—') + '</td>' +
              '<td>' + (colState.counts[c.id] || 0) + '</td>' +
              '<td>' + c.sortOrder + '</td>' +
              '<td>' + statusBadge(c.status) + '</td>' +
              '<td><div class="admin-table__actions">' +
                '<button type="button" class="btn btn--ghost btn--sm" data-col-edit="' + esc(c.id) + '">Edit</button>' +
                (c.status === 'ARCHIVED'
                  ? '<button type="button" class="btn btn--green btn--sm" data-col-restore="' + esc(c.id) + '">Restore</button>'
                  : '<button type="button" class="btn btn--accent btn--sm" data-col-archive="' + esc(c.id) + '">Archive</button>') +
              '</div></td>' +
            '</tr>').join('')
        : '<tr><td colspan="6" class="admin-table__empty">No collections yet.</td></tr>') +
      '</tbody></table></div>';

    wrap.querySelectorAll('[data-col-edit]').forEach((b) =>
      b.addEventListener('click', () => openCollectionModal(b.dataset.colEdit)));
    wrap.querySelectorAll('[data-col-archive]').forEach((b) =>
      b.addEventListener('click', () => setCollectionStatus(b.dataset.colArchive, 'ARCHIVED')));
    wrap.querySelectorAll('[data-col-restore]').forEach((b) =>
      b.addEventListener('click', () => setCollectionStatus(b.dataset.colRestore, 'PUBLISHED')));
  }

  /* Collection has no deletedAt — status ARCHIVED is the soft delete. */
  async function setCollectionStatus(id, status) {
    const { error } = await client.from('Collection').update({ status: status }).eq('id', id);
    if (error) return fail(error, 'Could not update collection');
    await audit(status === 'ARCHIVED' ? 'collection.archive' : 'collection.restore', 'Collection', id, { status: status });
    toast(status === 'ARCHIVED' ? 'Collection archived.' : 'Collection restored.', 'success');
    refreshCollections();
  }

  async function openCollectionModal(colId) {
    const c = colId ? colState.rows.find((r) => r.id === colId) : null;
    if (colId && !c) {
      toast('Could not load collection.', 'error');
      return;
    }

    const [productsRes, linksRes] = await Promise.all([
      client.from('Product').select('id,name').is('deletedAt', null).order('name'),
      colId ? client.from(JOIN_TABLE).select('B').eq('A', colId) : Promise.resolve({ data: [] })
    ]);
    if (productsRes.error) return fail(productsRes.error, 'Could not load products');
    const products = productsRes.data || [];
    const memberIds = new Set((linksRes.data || []).map((l) => l.B));

    const v = (key) => (c && c[key] != null ? c[key] : '');
    openModal(
      '<h3 class="modal__title">' + (c ? 'Edit collection' : 'New collection') + '</h3>' +
      '<form id="collection-form"><div class="form-grid">' +
        '<div class="field"><label class="field__label">Name <span class="req">*</span></label>' +
          '<input class="input" name="name" required value="' + esc(v('name')) + '"></div>' +
        '<div class="field"><label class="field__label">Slug <span class="req">*</span></label>' +
          '<input class="input" name="slug" required value="' + esc(v('slug')) + '"' + (c ? '' : ' placeholder="auto-generated-from-name"') + '></div>' +
        '<div class="field"><label class="field__label">Kind</label>' +
          '<input class="input" name="kind" value="' + esc(v('kind')) + '" placeholder="landing | mood | bumi-edit"></div>' +
        '<div class="field"><label class="field__label">Sort order</label>' +
          '<input class="input" name="sortOrder" type="number" step="1" value="' + (c ? c.sortOrder : 0) + '"></div>' +
        '<div class="field"><label class="field__label">Status</label>' +
          '<select class="select" name="status">' +
            STATUSES.map((s) => '<option value="' + s + '"' + ((c ? c.status : 'PUBLISHED') === s ? ' selected' : '') + '>' + s + '</option>').join('') +
          '</select></div>' +
        '<div class="field form-grid__full"><label class="field__label">Description</label>' +
          '<textarea class="input" name="description" rows="3">' + esc(v('description')) + '</textarea></div>' +
        '<div class="field form-grid__full"><label class="field__label">Products in this collection</label>' +
          '<div class="picker">' +
            '<input type="search" class="input picker__search" id="picker-search" placeholder="Search products…">' +
            '<div class="picker__list" id="picker-list">' +
              products.map((p) =>
                '<label class="picker__item" data-name="' + esc(p.name.toLowerCase()) + '">' +
                  '<input type="checkbox" name="member" value="' + esc(p.id) + '"' + (memberIds.has(p.id) ? ' checked' : '') + '> ' +
                  esc(p.name) +
                '</label>').join('') +
            '</div>' +
          '</div>' +
          '<p class="picker__count" id="picker-count"></p>' +
        '</div>' +
      '</div>' +
      '<div class="modal__actions">' +
        '<button type="button" class="btn btn--ghost" id="collection-cancel">Cancel</button>' +
        '<button type="submit" class="btn btn--primary">' + (c ? 'Save changes' : 'Create collection') + '</button>' +
      '</div></form>',
      { wide: true });

    wireCollectionForm(c, memberIds);
  }

  function wireCollectionForm(c, originalMemberIds) {
    const form = $('collection-form');
    $('collection-cancel').addEventListener('click', closeModal);

    const updateCount = () => {
      const n = form.querySelectorAll('input[name="member"]:checked').length;
      $('picker-count').textContent = n + ' product' + (n === 1 ? '' : 's') + ' selected';
    };
    updateCount();

    $('picker-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      form.querySelectorAll('.picker__item').forEach((item) => {
        item.style.display = !q || item.dataset.name.includes(q) ? '' : 'none';
      });
    });
    form.querySelectorAll('input[name="member"]').forEach((cb) =>
      cb.addEventListener('change', updateCount));

    if (!c) {
      const nameInput = form.elements.name;
      const slugInput = form.elements.slug;
      nameInput.addEventListener('input', () => {
        if (!slugInput.dataset.touched) slugInput.value = slugify(nameInput.value);
      });
      slugInput.addEventListener('input', () => { slugInput.dataset.touched = '1'; });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: String(fd.get('name') || '').trim(),
        slug: slugify(fd.get('slug')),
        kind: String(fd.get('kind') || '').trim() || null,
        description: String(fd.get('description') || '').trim() || null,
        sortOrder: parseInt(fd.get('sortOrder'), 10) || 0,
        status: fd.get('status')
      };
      if (!payload.name || !payload.slug) {
        toast('Name and slug are required.', 'error');
        return;
      }
      const selected = Array.from(form.querySelectorAll('input[name="member"]:checked')).map((cb) => cb.value);

      let collectionId = c ? c.id : null;
      if (c) {
        const { error } = await client.from('Collection').update(payload).eq('id', c.id);
        if (error) return fail(error, 'Could not save collection');
        await audit('collection.update', 'Collection', c.id, { slug: payload.slug });
      } else {
        const { data, error } = await client.from('Collection').insert({ id: newId(), updatedAt: new Date().toISOString(), ...payload }).select().single();
        if (error) return fail(error, 'Could not create collection');
        collectionId = data.id;
        await audit('collection.create', 'Collection', collectionId, { slug: payload.slug });
      }

      /* Sync M:N membership — hard-delete removed join rows, insert new ones. */
      const toAdd = selected.filter((id) => !originalMemberIds.has(id));
      const toRemove = Array.from(originalMemberIds).filter((id) => !selected.includes(id));
      if (toRemove.length) {
        const { error } = await client.from(JOIN_TABLE).delete().eq('A', collectionId).in('B', toRemove);
        if (error) return fail(error, 'Could not update collection products');
      }
      if (toAdd.length) {
        const { error } = await client.from(JOIN_TABLE)
          .insert(toAdd.map((pid) => ({ A: collectionId, B: pid })));
        if (error) return fail(error, 'Could not update collection products');
      }
      if (toAdd.length || toRemove.length) {
        await audit('collection.products.update', 'Collection', collectionId, { added: toAdd.length, removed: toRemove.length });
      }

      toast(c ? 'Collection saved.' : 'Collection created.', 'success');
      closeModal();
      refreshCollections();
    });
  }

  /* ────────────────────────────────────────────
     PROMOTIONS
     ──────────────────────────────────────────── */

  const promoState = { rows: [] };

  function loadPromotions() {
    const el = $('tab-promotions');
    el.innerHTML =
      '<h2 class="admin-tab__title">Promotions</h2>' +
      '<div class="admin-toolbar">' +
        '<span class="admin-toolbar__spacer"></span>' +
        '<button type="button" class="btn btn--primary" id="promo-new">+ New promotion</button>' +
      '</div>' +
      '<div id="promotions-table"><p>Loading…</p></div>';
    $('promo-new').addEventListener('click', () => openPromoModal(null));
    refreshPromotions();
  }

  async function refreshPromotions() {
    const { data, error } = await client
      .from('Promotion')
      .select('id,code,label,type,value,startsAt,endsAt,usageLimit,usedCount,isActive')
      .order('createdAt', { ascending: false });
    if (error) return fail(error, 'Could not load promotions');
    promoState.rows = data || [];
    renderPromotionsTable();
  }

  function fmtPromoValue(p) {
    return p.type === 'FIXED_AMOUNT' ? fmtCents(p.value) : Math.round((p.value || 0) * 100) + '%';
  }

  function renderPromotionsTable() {
    const wrap = $('promotions-table');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>Code</th><th>Label</th><th>Type</th><th>Value</th><th>Starts</th><th>Ends</th><th>Used / Limit</th><th>Active</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      (promoState.rows.length
        ? promoState.rows.map((p) =>
            '<tr>' +
              '<td><code><strong>' + esc(p.code) + '</strong></code></td>' +
              '<td>' + esc(p.label) + '</td>' +
              '<td><span class="badge ' + (p.type === 'PERCENTAGE' ? 'badge--blue' : 'badge--pink') + '">' + esc(p.type) + '</span></td>' +
              '<td>' + esc(fmtPromoValue(p)) + '</td>' +
              '<td>' + esc(fmtDateTime(p.startsAt)) + '</td>' +
              '<td>' + esc(fmtDateTime(p.endsAt)) + '</td>' +
              '<td>' + (p.usedCount || 0) + ' / ' + (p.usageLimit != null ? p.usageLimit : '∞') + '</td>' +
              '<td><input type="checkbox" data-promo-active="' + esc(p.id) + '"' + (p.isActive ? ' checked' : '') + '></td>' +
              '<td><div class="admin-table__actions">' +
                '<button type="button" class="btn btn--ghost btn--sm" data-promo-edit="' + esc(p.id) + '">Edit</button>' +
              '</div></td>' +
            '</tr>').join('')
        : '<tr><td colspan="9" class="admin-table__empty">No promotions yet.</td></tr>') +
      '</tbody></table></div>';

    wrap.querySelectorAll('[data-promo-edit]').forEach((b) =>
      b.addEventListener('click', () => openPromoModal(b.dataset.promoEdit)));
    wrap.querySelectorAll('[data-promo-active]').forEach((cb) =>
      cb.addEventListener('change', () => togglePromoActive(cb.dataset.promoActive, cb.checked)));
  }

  async function togglePromoActive(id, isActive) {
    const { error } = await client.from('Promotion').update({ isActive: isActive }).eq('id', id);
    if (error) {
      fail(error, 'Could not update promotion');
      refreshPromotions();
      return;
    }
    await audit(isActive ? 'promotion.activate' : 'promotion.deactivate', 'Promotion', id, { isActive: isActive });
    toast(isActive ? 'Promotion activated.' : 'Promotion deactivated.', 'success');
    refreshPromotions();
  }

  function openPromoModal(promoId) {
    const p = promoId ? promoState.rows.find((r) => r.id === promoId) : null;
    if (promoId && !p) {
      toast('Could not load promotion.', 'error');
      return;
    }
    const type = p ? p.type : 'PERCENTAGE';
    const valueInput = !p ? '' : (p.type === 'FIXED_AMOUNT'
      ? ((p.value || 0) / 100).toFixed(2)
      : String(Math.round((p.value || 0) * 100)));

    openModal(
      '<h3 class="modal__title">' + (p ? 'Edit promotion' : 'New promotion') + '</h3>' +
      '<form id="promo-form"><div class="form-grid">' +
        '<div class="field"><label class="field__label">Code <span class="req">*</span></label>' +
          '<input class="input" name="code" required value="' + esc(p ? p.code : '') + '" placeholder="WELCOME10" style="text-transform:uppercase;">' +
          '<p class="form-grid__hint">Stored uppercase — this is what shoppers type at checkout.</p></div>' +
        '<div class="field"><label class="field__label">Label <span class="req">*</span></label>' +
          '<input class="input" name="label" required value="' + esc(p ? p.label : '') + '" placeholder="10% off your first order"></div>' +
        '<div class="field"><label class="field__label">Type</label>' +
          '<select class="select" name="type" id="promo-type">' +
            '<option value="PERCENTAGE"' + (type === 'PERCENTAGE' ? ' selected' : '') + '>Percentage</option>' +
            '<option value="FIXED_AMOUNT"' + (type === 'FIXED_AMOUNT' ? ' selected' : '') + '>Fixed amount</option>' +
          '</select></div>' +
        '<div class="field"><label class="field__label" id="promo-value-label">' +
          (type === 'FIXED_AMOUNT' ? 'Amount (AUD)' : 'Discount (%)') + ' <span class="req">*</span></label>' +
          '<input class="input" name="value" type="number" min="0" step="0.01" required value="' + esc(valueInput) + '"></div>' +
        '<div class="field"><label class="field__label">Starts at</label>' +
          '<input class="input" name="startsAt" type="datetime-local" value="' + esc(toLocalInput(p && p.startsAt)) + '"></div>' +
        '<div class="field"><label class="field__label">Ends at</label>' +
          '<input class="input" name="endsAt" type="datetime-local" value="' + esc(toLocalInput(p && p.endsAt)) + '"></div>' +
        '<div class="field"><label class="field__label">Usage limit</label>' +
          '<input class="input" name="usageLimit" type="number" min="0" step="1" value="' + (p && p.usageLimit != null ? p.usageLimit : '') + '">' +
          '<p class="form-grid__hint">Leave empty for unlimited uses.</p></div>' +
        '<div class="field"><label class="field__label">Flags</label>' +
          '<label class="form-grid__check"><input type="checkbox" name="isActive"' + (!p || p.isActive ? ' checked' : '') + '> Active</label>' +
        '</div>' +
      '</div>' +
      '<div class="modal__actions">' +
        '<button type="button" class="btn btn--ghost" id="promo-cancel">Cancel</button>' +
        '<button type="submit" class="btn btn--primary">' + (p ? 'Save changes' : 'Create promotion') + '</button>' +
      '</div></form>');

    $('promo-cancel').addEventListener('click', closeModal);
    $('promo-type').addEventListener('change', (e) => {
      $('promo-value-label').innerHTML =
        (e.target.value === 'FIXED_AMOUNT' ? 'Amount (AUD)' : 'Discount (%)') + ' <span class="req">*</span>';
    });

    $('promo-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const promoType = fd.get('type');
      const rawValue = parseFloat(fd.get('value'));
      if (Number.isNaN(rawValue) || rawValue < 0) {
        toast('Enter a valid value.', 'error');
        return;
      }
      /* Schema contract: PERCENTAGE stores a rate (0.10); FIXED_AMOUNT stores cents. */
      const value = promoType === 'FIXED_AMOUNT' ? Math.round(rawValue * 100) : rawValue / 100;
      const payload = {
        code: String(fd.get('code') || '').trim().toUpperCase(),
        label: String(fd.get('label') || '').trim(),
        type: promoType,
        value: value,
        startsAt: fd.get('startsAt') ? new Date(fd.get('startsAt')).toISOString() : null,
        endsAt: fd.get('endsAt') ? new Date(fd.get('endsAt')).toISOString() : null,
        usageLimit: fd.get('usageLimit') ? parseInt(fd.get('usageLimit'), 10) : null,
        isActive: fd.get('isActive') === 'on'
      };
      if (!payload.code || !payload.label) {
        toast('Code and label are required.', 'error');
        return;
      }
      if (payload.startsAt && payload.endsAt && payload.endsAt < payload.startsAt) {
        toast('End date must be after the start date.', 'error');
        return;
      }
      if (p) {
        const { error } = await client.from('Promotion').update(payload).eq('id', p.id);
        if (error) return fail(error, 'Could not save promotion');
        await audit('promotion.update', 'Promotion', p.id, { code: payload.code });
        toast('Promotion saved.', 'success');
      } else {
        const { data, error } = await client.from('Promotion').insert({ id: newId(), updatedAt: new Date().toISOString(), ...payload }).select().single();
        if (error) return fail(error, 'Could not create promotion');
        await audit('promotion.create', 'Promotion', data.id, { code: payload.code });
        toast('Promotion created.', 'success');
      }
      closeModal();
      refreshPromotions();
    });
  }

  /* ────────────────────────────────────────────
     INIT
     ──────────────────────────────────────────── */

  async function init() {
    client = window.bbSupabase.getClient();
    wireAuth();
    wireNav();

    window.bbSupabase.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') showLogin();
    });

    const { data } = await window.bbSupabase.getSession();
    if (data && data.session) {
      const admin = await verifyAdmin(data.session);
      if (admin) {
        showShell(admin);
        return;
      }
      await window.bbSupabase.signOut();
      toast('This account is not authorized for the admin panel.', 'error');
    }
    showLogin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
