/**
 * BUMI / BLOOM — Main Application JavaScript
 * Handles: announcement bar, sticky header, mobile nav, search modal,
 * scroll animations, newsletter, wishlist, accordion, swatches,
 * cart count, collection tab filtering, and enhanced animations.
 */

(function () {
  'use strict';

  // ─── Inject fadeInUp keyframe animation ───────────────────────────────
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(styleSheet);

  // ─── Scroll lock (shared by the mobile drawer + search modal) ─────────
  // A counter avoids one overlay releasing the lock while another is open.
  let scrollLocks = 0;
  function lockScroll() {
    scrollLocks += 1;
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.style.overflow = '';
  }

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusFirst(container) {
    if (!container) return;
    const first = container.querySelector(FOCUSABLE_SELECTOR);
    if (first) first.focus();
  }

  // ─── Announcement Bar ────────────────────────────────────────────────
  // Dismissals are remembered for 30 days so the bar does not pop back on
  // every navigation.
  const ANNOUNCEMENT_KEY = 'bb-announcement-closed';
  const ANNOUNCEMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const announcementBar = document.getElementById('announcement-bar');
  const closeAnnouncement = document.getElementById('close-announcement');

  function announcementDismissed() {
    try {
      const at = Number(localStorage.getItem(ANNOUNCEMENT_KEY) || 0);
      return at > 0 && Date.now() - at < ANNOUNCEMENT_TTL_MS;
    } catch (e) {
      return false;
    }
  }

  if (announcementBar && announcementDismissed()) {
    announcementBar.style.display = 'none';
  }

  if (closeAnnouncement && announcementBar) {
    closeAnnouncement.addEventListener('click', () => {
      announcementBar.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      announcementBar.style.transform = 'translateY(-100%)';
      announcementBar.style.opacity = '0';
      try {
        localStorage.setItem(ANNOUNCEMENT_KEY, String(Date.now()));
      } catch (e) {
        /* storage unavailable — dismiss for this page view only */
      }
      setTimeout(() => {
        announcementBar.style.display = 'none';
      }, 300);
    });
  }

  // ─── Skip to content (keyboard users) ────────────────────────────────
  (function addSkipLink() {
    const main = document.querySelector('main');
    if (!main || document.querySelector('.skip-link')) return;
    if (!main.id) main.id = 'main-content';
    const skip = document.createElement('a');
    skip.className = 'skip-link';
    skip.href = '#' + main.id;
    skip.textContent = 'Skip to content';
    document.body.insertBefore(skip, document.body.firstChild);
  })();

  // ─── Sticky Header (transparent over hero → solid on scroll) ─────────
  const header = document.getElementById('header');
  let ticking = false;

  // Keep the --header-height token in sync with the real header height so the
  // hero overlap stays accurate across breakpoints. CSS provides a 76px fallback.
  function syncHeaderHeight() {
    if (header) {
      document.documentElement.style.setProperty(
        '--header-height',
        header.offsetHeight + 'px'
      );
    }
  }
  window.addEventListener('load', syncHeaderHeight);
  window.addEventListener('resize', syncHeaderHeight);
  syncHeaderHeight();

  function updateHeader() {
    const currentScrollY = window.scrollY;

    if (header) {
      if (currentScrollY > 80) {
        header.classList.add('is-scrolled');
      } else {
        header.classList.remove('is-scrolled');
      }
    }

    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateHeader);
      ticking = true;
    }
  });

  // ─── Mobile Nav ──────────────────────────────────────────────────────
  const menuToggle = document.getElementById('menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  const mobileNavClose = document.getElementById('mobile-nav-close');
  const mobileNavOverlay = document.getElementById('mobile-nav-overlay');
  let mobileNavLocked = false;
  let mobileNavReturnFocus = null;

  if (menuToggle && mobileNav) {
    menuToggle.setAttribute('aria-controls', 'mobile-nav');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-haspopup', 'dialog');
  }
  if (mobileNav) {
    mobileNav.setAttribute('role', 'dialog');
    mobileNav.setAttribute('aria-modal', 'true');
    mobileNav.setAttribute('aria-label', 'Menu');
  }

  function openMobileNav() {
    if (!mobileNav || mobileNav.classList.contains('is-open')) return;
    mobileNavReturnFocus = document.activeElement;
    mobileNav.classList.add('is-open');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
    if (!mobileNavLocked) {
      lockScroll();
      mobileNavLocked = true;
    }
    focusFirst(mobileNav);
  }

  function closeMobileNav() {
    if (!mobileNav || !mobileNav.classList.contains('is-open')) return;
    mobileNav.classList.remove('is-open');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    if (mobileNavLocked) {
      unlockScroll();
      mobileNavLocked = false;
    }
    if (mobileNavReturnFocus && typeof mobileNavReturnFocus.focus === 'function') {
      mobileNavReturnFocus.focus();
    }
    mobileNavReturnFocus = null;
  }

  if (menuToggle) menuToggle.addEventListener('click', openMobileNav);
  if (mobileNavClose) mobileNavClose.addEventListener('click', closeMobileNav);
  if (mobileNavOverlay) mobileNavOverlay.addEventListener('click', closeMobileNav);

  // Escape closes the open overlay; Tab stays inside it while open.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileNav();
      closeSearchModal();
      return;
    }
    if (e.key !== 'Tab') return;

    const openOverlay =
      mobileNav && mobileNav.classList.contains('is-open') ? mobileNav :
      searchModal && searchModal.classList.contains('is-open') ? searchModal :
      null;
    if (!openOverlay) return;

    const items = openOverlay.querySelectorAll(FOCUSABLE_SELECTOR);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // ─── Search Modal ────────────────────────────────────────────────────
  const searchToggle = document.getElementById('search-toggle');
  const searchModal = document.getElementById('search-modal');
  const searchClose = document.getElementById('search-close');
  const searchModalOverlay = document.getElementById('search-modal-overlay');
  const searchInput = document.getElementById('search-input');
  let searchLocked = false;
  let searchReturnFocus = null;

  if (searchToggle && searchModal) {
    searchToggle.setAttribute('aria-controls', 'search-modal');
    searchToggle.setAttribute('aria-expanded', 'false');
    searchToggle.setAttribute('aria-haspopup', 'dialog');
  }
  if (searchModal) {
    searchModal.setAttribute('role', 'dialog');
    searchModal.setAttribute('aria-modal', 'true');
    searchModal.setAttribute('aria-label', 'Search products');
  }

  function openSearchModal() {
    if (!searchModal || searchModal.classList.contains('is-open')) return;
    searchReturnFocus = document.activeElement;
    searchModal.classList.add('is-open');
    if (searchToggle) searchToggle.setAttribute('aria-expanded', 'true');
    if (!searchLocked) {
      lockScroll();
      searchLocked = true;
    }
    setTimeout(() => {
      if (searchInput) searchInput.focus();
    }, 200);
  }

  function closeSearchModal() {
    if (!searchModal || !searchModal.classList.contains('is-open')) return;
    searchModal.classList.remove('is-open');
    if (searchToggle) searchToggle.setAttribute('aria-expanded', 'false');
    if (searchLocked) {
      unlockScroll();
      searchLocked = false;
    }
    if (searchReturnFocus && typeof searchReturnFocus.focus === 'function') {
      searchReturnFocus.focus();
    }
    searchReturnFocus = null;
  }

  if (searchToggle) searchToggle.addEventListener('click', openSearchModal);
  if (searchClose) searchClose.addEventListener('click', closeSearchModal);
  if (searchModalOverlay) searchModalOverlay.addEventListener('click', closeSearchModal);

  // ─── Search Form Submit ──────────────────────────────────────────────
  const searchForm = document.getElementById('search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = searchInput ? searchInput.value.trim() : '';
      if (query) {
        window.location.href = `/products?search=${encodeURIComponent(query)}`;
      }
    });
  }

  // ─── Scroll Animations (IntersectionObserver) ────────────────────────
  const animatedElements = document.querySelectorAll(
    '.section__header, .product-card, .style-card, .why-choose-item, ' +
    '.testimonial-card, .promo-banner, .cta-banner-grid, .newsletter, ' +
    '.hero-playful__inner'
  );

  if ('IntersectionObserver' in window && animatedElements.length > 0) {
    const observerOptions = {
      root: null,
      rootMargin: '0px 0px -60px 0px',
      threshold: 0.1
    };

    const animationObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target;

          // Determine stagger delay for grid items
          let delay = 0;
          const parent = el.parentElement;
          if (parent) {
            const siblings = parent.querySelectorAll(
              ':scope > .product-card, :scope > .style-card, :scope > .why-choose-item, :scope > .testimonial-card'
            );
            if (siblings.length > 1) {
              const index = Array.from(siblings).indexOf(el);
              if (index > -1) {
                delay = index * 0.08;
              }
            }
          }

          el.style.animation = `fadeInUp 0.6s ease ${delay}s both`;
          el.classList.add('is-visible');
          animationObserver.unobserve(el);
        }
      });
    }, observerOptions);

    animatedElements.forEach((el) => {
      el.style.opacity = '0';
      animationObserver.observe(el);
    });
  }

  // ─── Newsletter Form ─────────────────────────────────────────────────
  const newsletterForm = document.getElementById('newsletter-form');

  if (newsletterForm) {
    newsletterForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const emailInput = newsletterForm.querySelector('input[type="email"]');
      const submitBtn = newsletterForm.querySelector('button[type="submit"]');

      if (!emailInput || !emailInput.value.trim()) return;

      const path = window.location.pathname;
      const source = path.indexOf('/brands') === 0 ? 'BRANDS'
        : path.indexOf('/journal') === 0 ? 'JOURNAL'
        : path.indexOf('/busy-book') === 0 ? 'BUSY_BOOK'
        : 'HOMEPAGE';

      let hint = newsletterForm.querySelector('.newsletter__code-hint');
      if (!hint) {
        hint = document.createElement('p');
        hint.className = 'newsletter__code-hint';
        newsletterForm.appendChild(hint);
      }

      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Subscribing…';

      try {
        const adminApi = (window.BumiConfig && BumiConfig.adminApiUrl)
          || (window.__BB_PUBLIC_ENV__ && window.__BB_PUBLIC_ENV__.checkoutApiUrl)
          || 'http://localhost:4001';
        const res = await fetch(adminApi + '/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailInput.value.trim(), source: source }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to subscribe');

        // The code is revealed only after a successful signup.
        const code = String(data.code || '').trim();
        if (!code) throw new Error('No code returned');
        submitBtn.textContent = 'Your code: ' + code + ' ✓';
        emailInput.disabled = true;
        emailInput.value = '';
        hint.textContent = 'Use ' + code + ' at checkout for 10% off your first order.';
        hint.style.display = 'block';
        if (window.BumiWelcomePopup) BumiWelcomePopup.remember(data);
        if (window.BumiTrack) BumiTrack.event('generate_lead', { currency: 'AUD', value: 0 });
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        hint.textContent = 'Something went wrong. Please try again.';
        hint.style.display = 'block';
      }
    });
  }

  // ─── Wishlist Buttons (delegated — works for JS-rendered cards) ──────
  function syncWishlistButton(btn) {
    if (!btn) return;
    const id = btn.dataset.id;
    const svg = btn.querySelector('svg');
    let active;
    if (id && window.BumiWishlist) {
      active = BumiWishlist.isWishlisted(id);
      btn.classList.toggle('is-active', active);
    } else {
      active = btn.classList.contains('is-active');
    }
    if (svg) {
      svg.setAttribute('fill', active ? 'currentColor' : 'none');
      svg.style.color = active ? 'var(--color-coral)' : '';
    }
  }

  document.querySelectorAll('.product-card__wishlist').forEach(syncWishlistButton);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.product-card__wishlist');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = btn.dataset.id;
    if (id && window.BumiWishlist) {
      BumiWishlist.toggle(id); // dispatches wishlist-updated → badge + all hearts re-sync
    } else {
      btn.classList.toggle('is-active');
      syncWishlistButton(btn);
    }
  });

  // ─── Quick add-to-bag from product cards (delegated) ─────────────────
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.product-card__add');
    if (!addBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = addBtn.dataset.id;
    const p = window.BumiData && BumiData.getProduct(id);
    if (!p || !window.BumiCart) return;

    const hasMultipleSizes = p.sizes && p.sizes.length > 1;
    const hasMultipleColors = p.colors && p.colors.length > 1;
    if (hasMultipleSizes || hasMultipleColors) {
      window.location.href = (window.BumiCart && BumiCart.productHref)
        ? BumiCart.productHref(p.id)
        : 'product-detail?id=' + p.id;
      return;
    }

    BumiCart.addItem({
      id: p.id, name: p.name, brand: p.brand, price: p.price,
      size: (p.sizes && p.sizes[0]) || 'One Size',
      color: (p.colors && p.colors[0] && p.colors[0].name) || '—',
      image: p.image
    });
  });

  // Keep every card heart in sync when the wishlist changes elsewhere
  window.addEventListener('wishlist-updated', () => {
    document.querySelectorAll('.product-card__wishlist').forEach(syncWishlistButton);
  });

  // ─── Accordion (FAQ / expandable sections) ───────────────────────────
  const accordionHeaders = document.querySelectorAll('.accordion__header');

  accordionHeaders.forEach((headerEl) => {
    headerEl.addEventListener('click', () => {
      const item = headerEl.parentElement;
      const isOpen = item.classList.contains('is-open');

      // Close all other accordion items
      const allItems = document.querySelectorAll('.accordion__item');
      allItems.forEach((i) => i.classList.remove('is-open'));

      // Toggle current
      if (!isOpen) {
        item.classList.add('is-open');
      }
    });
  });

  // Delegated so it also covers accordions rendered later (product pages).
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('.accordion__trigger');
    if (!trigger) return;
    const item = trigger.closest('.accordion__item');
    if (item) item.classList.toggle('is-active');
  });

  // ─── Product Card Swatch Click ───────────────────────────────────────
  const swatches = document.querySelectorAll('.product-card__swatch');

  swatches.forEach((swatch) => {
    swatch.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const swatchGroup = swatch.parentElement;
      if (swatchGroup) {
        swatchGroup.querySelectorAll('.product-card__swatch').forEach((s) => {
          s.classList.remove('is-active');
        });
      }
      swatch.classList.add('is-active');

      // Update product image if data-image attribute exists
      const newImage = swatch.dataset.image;
      if (newImage) {
        const card = swatch.closest('.product-card');
        if (card) {
          const img = card.querySelector('.product-card__image');
          if (img) {
            img.style.opacity = '0.5';
            setTimeout(() => {
              img.src = newImage;
              img.style.opacity = '1';
            }, 200);
          }
        }
      }
    });
  });

  // ─── Cart Count Update ───────────────────────────────────────────────
  const cartCountEl = document.getElementById('cart-count');

  function updateCartCount() {
    if (!cartCountEl) return;
    const totalItems = window.BumiCart ? BumiCart.getItemCount() : 0;
    cartCountEl.textContent = totalItems;
    cartCountEl.dataset.count = String(totalItems);
    cartCountEl.style.display = totalItems > 0 ? 'flex' : 'none';
  }

  // Update cart count on load
  updateCartCount();

  // Listen for cart updates from other scripts
  window.addEventListener('cart-updated', updateCartCount);
  window.addEventListener('storage', (e) => {
    if (e.key === 'bb-cart') {
      updateCartCount();
    }
  });

  // ─── Collection Tab Filtering ────────────────────────────────────────
  const collectionTabs = document.querySelectorAll('.collection-tab');
  const collectionGrid = document.getElementById('collection-grid');

  if (collectionTabs.length > 0 && collectionGrid) {
    collectionTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        // Remove active from all tabs
        collectionTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');

        const filter = tab.dataset.filter;
        const cards = collectionGrid.querySelectorAll('.product-card');

        cards.forEach((card, index) => {
          if (filter === 'all' || card.dataset.category === filter) {
            card.style.display = '';
            card.style.animation = `fadeInUp 0.4s ease ${index * 0.05}s both`;
          } else {
            card.style.display = 'none';
          }
        });
      });
    });
  }

  // ─── Smooth scroll for anchor links ──────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const targetEl = document.querySelector(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
          closeMobileNav();
        }
      }
    });
  });

  (function () {
    var here = location.pathname + location.search;
    document.querySelectorAll('.header__nav-link, .mobile-nav__link').forEach(function (link) {
      var u;
      try { u = new URL(link.href); } catch (e) { return; }
      var active = u.pathname + u.search === here;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  })();

})();
