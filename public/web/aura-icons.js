"use strict";

// Small shared SVG icons for icon-only controls (so no control shows "Fullscreen" / "Expand" / "Close" text).
(function initAuraIcons() {
  const svg = (inner) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
  window.AuraIcons = {
    expand: svg('<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>'),
    collapse: svg('<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>')
  };
})();
