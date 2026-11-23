/**
 * BUMI / BLOOM — Crayon Christmas layer
 *
 * Adds two seasonal, non-blocking behaviours to the homepage:
 *  1. Gentle snowfall on a fixed canvas (desktop only, disabled for
 *     prefers-reduced-motion).
 *  2. A live countdown to the AU Christmas delivery cut-off, driven by
 *     `data-xmas-cutoff` on the urgency strip. Hides the strip if the date
 *     has already passed so it never goes stale.
 *
 * No dependencies. Safe to load on any page — every piece is guarded by the
 * presence of its element.
 */
(function () {
  'use strict';
  if (window.BumiChristmas) return;

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- Snow */
  function initSnow() {
    if (reduceMotion) return;
    var canvas = document.getElementById('snow-canvas');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var W = 0;
    var H = 0;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var flakes = [];
    var running = true;
    var FLAKE_COUNT = 70;

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function makeFlake() {
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        r: 1.4 + Math.random() * 2.6,
        speed: 0.35 + Math.random() * 0.9,
        drift: (Math.random() - 0.5) * 0.6,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.35 + Math.random() * 0.45,
      };
    }

    function seed() {
      flakes = [];
      var count = W < 900 ? Math.round(FLAKE_COUNT * 0.6) : FLAKE_COUNT;
      for (var i = 0; i < count; i += 1) flakes.push(makeFlake());
    }

    var t = 0;
    function frame() {
      if (!running) return;
      t += 0.016;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#00408C';
      for (var i = 0; i < flakes.length; i += 1) {
        var f = flakes[i];
        f.y += f.speed;
        f.x += f.drift + Math.sin(t + f.phase) * 0.4;
        if (f.y > H + 6) {
          f.y = -6;
          f.x = Math.random() * W;
        }
        if (f.x > W + 6) f.x = -6;
        if (f.x < -6) f.x = W + 6;
        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }

    resize();
    seed();
    requestAnimationFrame(frame);

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resize();
        seed();
      }, 200);
    });

    // Pause when the tab is hidden to save battery.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        running = false;
      } else if (!running) {
        running = true;
        requestAnimationFrame(frame);
      }
    });
  }

  /* ----------------------------------------------------------- Countdown */
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function initCountdown() {
    var strip = document.querySelector('[data-xmas-cutoff]');
    if (!strip) return;

    var out = strip.querySelector('[data-xmas-countdown]');
    var cutoff = new Date(strip.getAttribute('data-xmas-cutoff') + 'T23:59:59');

    function tick() {
      var diff = cutoff.getTime() - Date.now();
      if (diff <= 0) {
        // Cut-off passed — hide the urgency message rather than show zeros.
        strip.style.display = 'none';
        clearInterval(timer);
        return;
      }
      if (!out) return;
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      out.textContent = d + 'd ' + pad(h) + 'h ' + pad(m) + 'm';
    }

    tick();
    var timer = setInterval(tick, 60000);
  }

  function init() {
    initSnow();
    initCountdown();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.BumiChristmas = { init: init };
})();
