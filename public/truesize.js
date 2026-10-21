// True size (Will, 21 Oct: "image corruption" on Wander: a 2,400-pixel export stretched across a 5K screen shows every
// artifact at twice its size; the file is sound, the stretch is the damage). The rule of the house: a picture is never
// shown larger than its own pixels allow, as a small print hangs small. `WMTrue.cap(img)` sets the largest box an image
// may fill: its pixels divided by the screen's density, with a quarter's grace (UP = 1.25); the rooms centre it in the
// dark. Nothing is laid into the picture; nothing changes for a master that has the pixels.
(function () {
  'use strict';
  var UP = 1.25;
  function box(img) { var w = img.naturalWidth || +img.getAttribute('width') || 0, h = img.naturalHeight || +img.getAttribute('height') || 0; if (!w || !h) return null; var d = Math.max(1, devicePixelRatio || 1); return { w: w * UP / d, h: h * UP / d }; }
  // For an absolutely positioned, inset:0 image with margin:auto: the box becomes max-width/max-height.
  function cap(img) { var b = box(img); if (!b) return false; img.style.maxWidth = Math.round(b.w) + 'px'; img.style.maxHeight = Math.round(b.h) + 'px'; img.style.margin = 'auto'; img.setAttribute('data-true', '1'); return true; }
  // For a scale-driven viewer: the largest scale (CSS px per image px) allowed.
  function maxScale() { return UP / Math.max(1, devicePixelRatio || 1); }
  function watch(root, sel) { function all() { (root || document).querySelectorAll(sel).forEach(function (im) { if (im.complete && im.naturalWidth) cap(im); else im.addEventListener('load', function () { cap(im); }, { once: true }); }); } all(); addEventListener('resize', all); return all; }
  window.WMTrue = { cap: cap, maxScale: maxScale, watch: watch, UP: UP };
})();
