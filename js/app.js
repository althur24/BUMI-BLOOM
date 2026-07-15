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

  // ─── Announcement Bar ────────────────────────────────────────────────
  const announcementBar = document.getElementById('announcement-bar');
  const closeAnnouncement = document.getElementById('close-announcement');

  if (closeAnnouncement && announcementBar) {
    closeAnnouncement.addEventListener('click', () => {
      announcementBar.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      announcementBar.style.transform = 'translateY(-100%)';
      announcementBar.style.opacity = '0';
      setTimeout(() => {
        announcementBar.style.display = 'none';
        document.body.style.paddingTop = '0';
      }, 300);
    });
  }

  // ─── Sticky Header (hide on scroll down, show on scroll up) ──────────
  const header = document.getElementById('header');
  let lastScrollY = window.scrollY;
  let ticking = false;

  function updateHeader() {
    const currentScrollY = window.scrollY;

    if (header) {
      if (currentScrollY > 80) {
        header.classList.add('is-scrolled');
      } else {
        header.classList.remove('is-scrolled');
      }

      if (currentScrollY > lastScrollY && currentScrollY > 200) {
        header.classList.add('is-hidden');
      } else {
        header.classList.remove('is-hidden');
      }
    }

    lastScrollY = currentScrollY;
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

  function openMobileNav() {
    if (mobileNav) {
      mobileNav.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeMobileNav() {
    if (mobileNav) {
      mobileNav.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  }

  if (menuToggle) menuToggle.addEventListener('click', openMobileNav);
  if (mobileNavClose) mobileNavClose.addEventListener('click', closeMobileNav);
  if (mobileNavOverlay) mobileNavOverlay.addEventListener('click', closeMobileNav);

  // Close mobile nav on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileNav();
      closeSearchModal();
    }
  });

  // ─── Search Modal ────────────────────────────────────────────────────
  const searchToggle = document.getElementById('search-toggle');
  const searchModal = document.getElementById('search-modal');
  const searchClose = document.getElementById('search-close');
  const searchModalOverlay = document.getElementById('search-modal-overlay');
  const searchInput = document.getElementById('search-input');

  function openSearchModal() {
    if (searchModal) {
      searchModal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
        if (searchInput) searchInput.focus();
      }, 200);
    }
  }

  function closeSearchModal() {
    if (searchModal) {
      searchModal.classList.remove('is-open');
      document.body.style.overflow = '';
    }
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
        window.location.href = `products.html?search=${encodeURIComponent(query)}`;
      }
    });
  }

  // ─── Scroll Animations (IntersectionObserver) ────────────────────────
  const animatedElements = document.querySelectorAll(
    '.section__header, .product-card, .style-card, .why-choose-item, ' +
    '.testimonial-card, .promo-banner, .cta-banner-grid, .newsletter, ' +
    '.hero-playful__content, .hero-playful__visual'
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
    newsletterForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const emailInput = newsletterForm.querySelector('input[type="email"]');
      const submitBtn = newsletterForm.querySelector('button[type="submit"]');

      if (emailInput && emailInput.value.trim()) {
        // Lead magnet: reveal the working welcome code
        const code = 'WELCOME10';
        submitBtn.textContent = 'Your code: ' + code + ' ✓';
        submitBtn.disabled = true;
        emailInput.disabled = true;
        emailInput.value = '';
        const hint = newsletterForm.querySelector('.newsletter__code-hint');
        if (hint) {
          hint.textContent = 'Use ' + code + ' at checkout for 10% off your first order.';
          hint.style.display = 'block';
        }
        if (window.BumiTrack) BumiTrack.event('generate_lead', { currency: 'AUD', value: 0 });
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

})();
