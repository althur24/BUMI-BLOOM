// Bumi & Bloom - Admin App Utilities

// ProductType enum options (single source of truth — Product.category is an enum,
// NOT the Category table, which is a separate M:N nav tree).
const PRODUCT_TYPES = [
  { value: 'TSHIRTS',     label: 'T-Shirts' },
  { value: 'SHORTS',      label: 'Shorts' },
  { value: 'DRESSES',     label: 'Dresses' },
  { value: 'OUTERWEAR',   label: 'Outerwear' },
  { value: 'ACCESSORIES', label: 'Accessories' },
  { value: 'BABY',        label: 'Baby' },
];

// Single source of truth for the admin sidebar nav.
const ADMIN_NAV_ITEMS = [
  {
    label: 'Dashboard', href: 'index.html',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
  },
  {
    label: 'Products', href: 'products.html',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>',
  },
  {
    label: 'Brands', href: 'brands.html',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
  },
  {
    label: 'Categories', href: 'categories.html',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
  },
  {
    label: 'Collections', href: 'collections.html',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
  },
  {
    label: 'Promotions', href: 'promotions.html',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>',
  },
  {
    label: 'Admin Users', href: 'users.html', superAdminOnly: true,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
  },
];

const LOGOUT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>';
const MENU_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>';

// Build the identical sidebar into <aside data-admin-shell> on every admin page.
function injectAdminSidebar() {
  const shell = document.querySelector('[data-admin-shell]');
  if (!shell) return; // e.g. login page has no sidebar

  // Robust current-page detection (handles /admin/ and /admin/index.html).
  const page = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();

  const navHtml = ADMIN_NAV_ITEMS.map((item) => {
    const isActive = item.href.toLowerCase() === page;
    const superAdminAttrs = item.superAdminOnly ? ' id="nav-users" style="display:none;"' : '';
    return `
      <li class="admin-nav-item">
        <a href="${item.href}" class="admin-nav-link${isActive ? ' active' : ''}"${superAdminAttrs}>
          ${item.icon}
          ${item.label}
        </a>
      </li>`;
  }).join('');

  shell.innerHTML = `
    <div class="admin-sidebar__header">
      <a href="index.html" class="admin-sidebar__logo">BUMI / BLOOM</a>
    </div>
    <nav class="admin-sidebar__nav">
      <ul class="admin-nav-list">${navHtml}</ul>
    </nav>
    <div class="admin-sidebar__footer">
      <div class="admin-user-avatar">
        <span class="admin-user-initial">A</span>
      </div>
      <div class="admin-user-info">
        <span class="admin-user-name">Loading...</span>
        <span class="admin-user-role" style="font-size: 0.75rem; color: var(--text-muted);">Admin</span>
      </div>
      <button id="admin-logout-btn" title="Sign Out" aria-label="Sign Out">
        ${LOGOUT_ICON}
      </button>
    </div>`;

  // Wire logout (now present on every admin page).
  const logoutBtn = document.getElementById('admin-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.bbAdminAuth) window.bbAdminAuth.handleLogout();
    });
  }

  injectMobileToggle(shell);
}

// Hamburger button (mobile) + clickable backdrop.
function injectMobileToggle(shell) {
  const header = document.querySelector('.admin-header');
  if (!header || document.querySelector('.admin-menu-toggle')) return;

  const toggle = document.createElement('button');
  toggle.className = 'admin-menu-toggle';
  toggle.setAttribute('aria-label', 'Toggle navigation');
  toggle.innerHTML = MENU_ICON;
  header.prepend(toggle);

  const backdrop = document.createElement('div');
  backdrop.className = 'admin-sidebar-backdrop';
  document.body.appendChild(backdrop);

  const closeSidebar = () => {
    shell.classList.remove('open');
    backdrop.classList.remove('show');
  };

  toggle.addEventListener('click', () => {
    shell.classList.toggle('open');
    backdrop.classList.toggle('show');
  });
  backdrop.addEventListener('click', closeSidebar);
  shell.querySelectorAll('.admin-nav-link').forEach((link) => {
    link.addEventListener('click', closeSidebar);
  });
}

// Populate user info across the (injected) sidebar; reveal Admin Users for SUPER_ADMIN.
function populateAdminUserInfo(user) {
  if (!user) return;
  const name = user.name || user.email || 'Admin';

  document.querySelectorAll('.admin-user-initial').forEach((el) => {
    el.textContent = (name.charAt(0) || 'A').toUpperCase();
  });
  document.querySelectorAll('.admin-user-name').forEach((el) => { el.textContent = name; });
  document.querySelectorAll('.admin-user-role').forEach((el) => {
    el.textContent = (user.role || 'ADMIN').replace('_', ' ');
  });

  const navUsers = document.getElementById('nav-users');
  if (navUsers && user.role === 'SUPER_ADMIN') {
    navUsers.style.display = 'flex';
  }
}

window.bbAdminApp = {
  PRODUCT_TYPES,

  injectAdminSidebar,
  populateAdminUserInfo,

  // Populate a <select> with the ProductType options.
  populateProductTypes(selectEl, selectedValue) {
    if (!selectEl) return;
    selectEl.innerHTML = PRODUCT_TYPES.map((t) =>
      `<option value="${t.value}"${t.value === selectedValue ? ' selected' : ''}>${t.label}</option>`
    ).join('');
  },

  // Toast notifications
  showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `admin-toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 3 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // Modal handlers
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      // Optional: reset form inside
      const form = modal.querySelector('form');
      if (form) form.reset();
    }
  },

  // Confirmation dialog
  confirmAction(message) {
    return new Promise((resolve) => {
      // For simplicity, using native confirm, but could be a custom modal
      const confirmed = window.confirm(message);
      resolve(confirmed);
    });
  },

  // Format price
  formatPrice(cents) {
    if (!cents) return '-';
    return '$' + (cents / 100).toFixed(2);
  },

  // Generate CUID-like ID for inserts (since we bypassed Prisma Client)
  generateId() {
    return 'c' + Math.random().toString(36).substring(2, 11) + Math.random().toString(36).substring(2, 11);
  }
};

// Initialize common UI elements
document.addEventListener('DOMContentLoaded', () => {
  // Inject the shared sidebar (builds nav + footer, sets active link, wires logout + mobile toggle).
  injectAdminSidebar();

  // Setup modal close buttons
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const overlay = btn.closest('.admin-modal-overlay');
      if (overlay) window.bbAdminApp.closeModal(overlay.id);
    });
  });
});
