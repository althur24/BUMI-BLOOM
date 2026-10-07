/* ============================================
   BUMI / BLOOM — Endless Paper interactions
   Draw-on-scroll for the crayon squiggle dividers.
   Lines are fully visible without JS; the drawing
   effect only engages when JS + IntersectionObserver
   are available and reduced motion is off.
   ============================================ */

(function () {
  'use strict';

  var dividers = document.querySelectorAll('.squiggle-divider');
  if (!dividers.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var paths = [];
  dividers.forEach(function (divider) {
    var path = divider.querySelector('path');
    if (!path) return;
    path.style.strokeDasharray = '1';
    path.style.strokeDashoffset = '1';
    paths.push(path);
  });
  if (!paths.length) return;

  function showAll() {
    paths.forEach(function (path) {
      path.style.strokeDashoffset = '0';
    });
  }

  if (!('IntersectionObserver' in window)) {
    showAll();
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var path = entry.target.querySelector('path');
      if (path) {
        path.style.transition = 'stroke-dashoffset 1.4s ease';
        path.style.strokeDashoffset = '0';
      }
      io.unobserve(entry.target);
    });
  }, { threshold: 0.4 });

  dividers.forEach(function (divider) { io.observe(divider); });
})();
