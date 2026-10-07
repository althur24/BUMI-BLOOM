  (function () {
    'use strict';
    const KEY = 'bb-account';
    const view = document.getElementById('account-view');
    let mode = 'login'; // 'login' | 'register'

    function getAccount() {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
    }
    function saveAccount(data) { localStorage.setItem(KEY, JSON.stringify(data)); }
    function signOut() { localStorage.removeItem(KEY); render(); }

    function render() {
      const acc = getAccount();
      view.innerHTML = acc ? dashboardHTML(acc) : authHTML();
      if (acc) wireDashboard(); else wireAuth();
    }

    /* ---- Auth ---- */
    function authHTML() {
      const isRegister = mode === 'register';
      return '<div class="auth-card">' +
        '<h1 class="auth-card__title">' + (isRegister ? 'Create Account' : 'Welcome Back') + '</h1>' +
        '<p class="auth-card__subtitle">' + (isRegister ? 'Join the BUMI / BLOOM family.' : 'Sign in to your account.') + '</p>' +
        '<form id="auth-form">' +
          (isRegister ? '<div class="field"><label class="field__label">Full name</label><input class="input" name="name" type="text" placeholder="Your name" required></div>' : '') +
          '<div class="field"><label class="field__label">Email <span class="req">*</span></label><input class="input" name="email" type="email" placeholder="you@email.com" required></div>' +
          '<div class="field"><label class="field__label">Password <span class="req">*</span></label><input class="input" name="password" type="password" placeholder="••••••••" required></div>' +
          '<button class="btn btn--primary btn--full" type="submit">' + (isRegister ? 'Create Account' : 'Sign In') + '</button>' +
        '</form>' +
        '<p class="auth-card__toggle">' + (isRegister ? 'Already have an account? ' : 'New here? ') +
          '<a href="#" id="auth-toggle">' + (isRegister ? 'Sign in' : 'Create an account') + '</a></p>' +
        '<p style="font-size:var(--text-xs);text-align:center;opacity:0.5;margin-top:var(--space-4);">Demo only — no real account is created.</p>' +
      '</div>';
    }

    function wireAuth() {
      const form = document.getElementById('auth-form');
      const toggle = document.getElementById('auth-toggle');
      if (toggle) toggle.addEventListener('click', (e) => { e.preventDefault(); mode = (mode === 'login' ? 'register' : 'login'); render(); });
      if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = new FormData(form);
        saveAccount({
          name: (data.get('name') || data.get('email').split('@')[0] || 'Friend'),
          email: data.get('email')
        });
        render();
      });
    }

    /* ---- Dashboard ---- */
    function dashboardHTML(acc) {
      const initial = (acc.name || 'B').charAt(0).toUpperCase();
      const tabs = [
        ['overview', 'Overview'],
        ['orders', 'Orders'],
        ['addresses', 'Addresses'],
        ['wishlist', 'Wishlist'],
        ['settings', 'Settings']
      ];
      return '<div class="account-layout">' +
        '<aside class="account-sidebar">' +
          '<div class="account-sidebar__header"><div class="account-sidebar__avatar">' + initial + '</div><div><strong>' + esc(acc.name) + '</strong><br><small style="opacity:0.6;">' + esc(acc.email) + '</small></div></div>' +
          '<nav class="account-tabs">' +
            tabs.map((t, i) => '<button class="account-tab' + (i === 0 ? ' is-active' : '') + '" data-tab="' + t[0] + '" type="button">' + t[1] + '</button>').join('') +
            '<button class="account-tab" data-action="signout" type="button">Sign Out</button>' +
          '</nav>' +
        '</aside>' +
        '<div>' +
          panel('overview', true, overviewPanel(acc)) +
          panel('orders', false, ordersPanel()) +
          panel('addresses', false, addressesPanel()) +
          panel('wishlist', false, wishlistPanel()) +
          panel('settings', false, settingsPanel(acc)) +
        '</div>' +
      '</div>';
    }

    function panel(id, active, content) {
      return '<div class="account-panel' + (active ? ' is-active' : '') + '" data-panel="' + id + '">' + content + '</div>';
    }

    function overviewPanel(acc) {
      const wishCount = BumiWishlist.getItemCount();
      const cartCount = BumiCart.getItemCount();
      return '<h2 class="account-panel__title">Hi, ' + esc(acc.name.split(' ')[0]) + '! 👋</h2>' +
        '<div class="grid grid--3" style="gap:var(--space-4);">' +
          stat('orders', '2', 'Total orders') +
          stat('wishlist', wishCount, 'Saved pieces') +
          stat('cart', cartCount, 'In your bag') +
        '</div>' +
        '<p style="margin-top:var(--space-6);"><a href="/products" class="btn btn--primary">Continue Shopping</a></p>';
    }
    function stat(icon, value, label) {
      const icons = { orders: '📦', wishlist: '❤️', cart: '🛍️' };
      return '<div class="why-choose-item" style="display:block;text-align:center;"><div class="why-choose-item__icon" style="margin:0 auto var(--space-2);">' + (icons[icon] || '•') + '</div><div style="font-family:var(--font-heading);font-size:var(--text-2xl);font-weight:var(--fw-bold);">' + value + '</div><div style="font-size:var(--text-sm);opacity:0.7;">' + label + '</div></div>';
    }

    function ordersPanel() {
      const orders = [
        { id: 'BB-2026-0148', date: '10 July 2026', status: 'Delivered', total: 78 },
        { id: 'BB-2026-0131', date: '28 June 2026', status: 'In Transit', total: 64 }
      ];
      return '<h2 class="account-panel__title">Order History</h2>' +
        orders.map(o =>
          '<div class="order-card"><div class="order-card__head"><span class="order-card__id">' + o.id + '</span><span class="order-card__status">' + o.status + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:var(--text-sm);"><span>Placed ' + o.date + '</span><strong>' + BumiData.formatPrice(o.total) + '</strong></div></div>'
        ).join('');
    }

    function addressesPanel() {
      return '<h2 class="account-panel__title">Saved Addresses</h2>' +
        '<div class="order-card"><strong>Home</strong><p style="margin-top:var(--space-2);">12 Watt Street<br>Newtown, NSW 2042<br>Australia</p><p style="margin-top:var(--space-2);font-size:var(--text-sm);opacity:0.7;">+61 412 345 678</p></div>' +
        '<button class="btn btn--secondary btn--sm" type="button" style="margin-top:var(--space-3);">+ Add New Address</button>';
    }

    function wishlistPanel() {
      const count = BumiWishlist.getItemCount();
      return '<h2 class="account-panel__title">Your Wishlist</h2>' +
        '<p>You have <strong>' + count + '</strong> saved piece' + (count === 1 ? '' : 's') + '.</p>' +
        '<p style="margin-top:var(--space-4);"><a href="/wishlist" class="btn btn--primary">View Wishlist</a></p>';
    }

    function settingsPanel(acc) {
      return '<h2 class="account-panel__title">Account Settings</h2>' +
        '<form id="settings-form" style="max-width:420px;">' +
          '<div class="field"><label class="field__label">Full name</label><input class="input" name="name" type="text" value="' + esc(acc.name) + '"></div>' +
          '<div class="field"><label class="field__label">Email</label><input class="input" name="email" type="email" value="' + esc(acc.email) + '"></div>' +
          '<div class="field"><label class="field__label">New password</label><input class="input" name="password" type="password" placeholder="Leave blank to keep current"></div>' +
          '<button class="btn btn--primary" type="submit">Save Changes</button>' +
          '<span id="settings-saved" style="display:none;margin-left:var(--space-3);color:var(--color-green-dark);font-weight:var(--fw-bold);">Saved!</span>' +
        '</form>';
    }

    function wireDashboard() {
      view.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          view.querySelectorAll('.account-tab').forEach(t => t.classList.remove('is-active'));
          btn.classList.add('is-active');
          view.querySelectorAll('.account-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === btn.dataset.tab));
        });
      });
      const signoutBtn = view.querySelector('[data-action="signout"]');
      if (signoutBtn) signoutBtn.addEventListener('click', signOut);
      const settingsForm = document.getElementById('settings-form');
      if (settingsForm) settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = new FormData(settingsForm);
        const acc = getAccount() || {};
        acc.name = data.get('name') || acc.name;
        acc.email = data.get('email') || acc.email;
        saveAccount(acc);
        const saved = document.getElementById('settings-saved');
        if (saved) { saved.style.display = 'inline'; setTimeout(() => saved.style.display = 'none', 2000); }
      });
    }

    function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    // Order history shows prices — refresh just that panel on currency change
    window.addEventListener('currency-updated', () => {
      const ordersEl = view.querySelector('[data-panel="orders"]');
      if (ordersEl) ordersEl.innerHTML = ordersPanel();
    });

    render();
  })();
