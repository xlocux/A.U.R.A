"use strict";

(function initAuraTopologyFullscreenFix() {
  function boot() {
    injectStyle();
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#topologyFullscreenClose")) return;
      event.preventDefault();
      event.stopPropagation();
      document.body.classList.remove("topology-fullscreen-mode");
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => window.AuraTopology?.render?.(), 50);
    }, true);
  }

  function injectStyle() {
    if (document.getElementById("aura-topology-fullscreen-fix-style")) return;
    const style = document.createElement("style");
    style.id = "aura-topology-fullscreen-fix-style";
    style.textContent = `
      body.topology-fullscreen-mode #topologyFullscreenClose {
        display: inline-flex !important;
        position: fixed !important;
        top: 16px !important;
        right: 16px !important;
        left: auto !important;
        bottom: auto !important;
        z-index: 10050 !important;
        width: auto !important;
        min-width: 88px !important;
        justify-content: center !important;
        align-items: center !important;
        padding: 8px 14px !important;
        border-radius: 999px !important;
        color: #071017 !important;
        background: linear-gradient(135deg, var(--accent), var(--accent-2)) !important;
        box-shadow: 0 12px 30px rgba(0,0,0,.45) !important;
      }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
