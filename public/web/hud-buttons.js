"use strict";

// Adds the .hud-btn class to every action button (styled in cyber-ui.css). Tabs, chips, icon-only and other
// controls that already have a dedicated look are skipped. Also covers buttons created later.
(function initHudButtons() {
  const SKIP = [
    ".tab", ".nav-subitem", ".sidebar-toggle", ".flow-ctl", ".screenshot-thumb", ".tool-tile", ".model-card",
    ".reveal-btn", ".ai-restore", ".fx-corner", ".av-away"
  ].join(",");

  function enhance(root) {
    root.querySelectorAll("button:not(.hud-btn)").forEach((button) => {
      if (button.matches(SKIP)) return;
      button.classList.add("hud-btn");
      // Dense contexts (tables, tab strips, chips, icon buttons) get the compact variant.
      if (button.closest("td, th, .result-subtabs, .assets-subnav, .risk-bucket-bar, .logs-subtabs, .topology-view-tabs, .settings-tabs, .tools-modes, .tool-quick-actions") || button.matches(".icon-btn, .icon-button, .ai-attach-btn, [class*=close], .copy-value, .row-action, .tool-log-button, .risk-chip")) button.classList.add("hud-sm");
    });
  }

  let queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; enhance(document); });
  }

  function boot() {
    enhance(document);
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
