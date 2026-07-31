/**
 * Continuous partner logo marquee — seamless, always moving.
 */
(function () {
  'use strict';

  var viewport = document.querySelector('[data-partners-carousel]');
  if (!viewport) return;

  var track = viewport.querySelector('[data-partners-track]');
  if (!track) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    viewport.classList.add('is-static');
    return;
  }

  // Duplicate the original set so we can loop -50% seamlessly
  var original = Array.prototype.slice.call(track.children);
  original.forEach(function (node) {
    var clone = node.cloneNode(true);
    clone.setAttribute('tabindex', '-1');
    clone.setAttribute('aria-hidden', 'true');
    var imgs = clone.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) imgs[i].alt = '';
    track.appendChild(clone);
  });

  var pos = 0;
  var speed = 0.45; // px per frame @ ~60fps ≈ 27px/s
  var half = 0;
  var hovering = false;

  function measure() {
    // Width of one full set (first half of children)
    var kids = track.children;
    var n = kids.length / 2;
    var w = 0;
    for (var i = 0; i < n; i++) {
      w += kids[i].getBoundingClientRect().width;
    }
    // include gaps from computed style
    var styles = window.getComputedStyle(track);
    var gap = parseFloat(styles.columnGap || styles.gap) || 0;
    half = w + gap * Math.max(0, n - 1);
  }

  measure();
  window.addEventListener('resize', function () {
    measure();
    if (half > 0 && Math.abs(pos) >= half) pos = pos % half;
  });

  // Keep moving even on hover of the strip; only ease speed down slightly
  viewport.addEventListener('mouseenter', function () { hovering = true; });
  viewport.addEventListener('mouseleave', function () { hovering = false; });

  function frame() {
    var s = hovering ? speed * 0.35 : speed;
    pos -= s;
    if (half > 0 && -pos >= half) pos += half;
    track.style.transform = 'translate3d(' + pos + 'px,0,0)';
    window.requestAnimationFrame(frame);
  }

  // Wait for images so widths are correct
  var imgs = track.querySelectorAll('img');
  var pending = 0;
  function maybeStart() {
    if (pending > 0) return;
    measure();
    window.requestAnimationFrame(frame);
  }
  for (var i = 0; i < imgs.length; i++) {
    if (!imgs[i].complete) {
      pending++;
      imgs[i].addEventListener('load', function () { pending--; maybeStart(); });
      imgs[i].addEventListener('error', function () { pending--; maybeStart(); });
    }
  }
  maybeStart();
})();
