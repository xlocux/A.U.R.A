"use strict";

(function initAuraTopologySubtabGuard() {
  let restoring = false;

  function boot() {
    installDashboardGuard();
    installFullscreenCloseFix();
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-tab="topology"], [data-topology-view]')) setTimeout(installDashboardGuard, 80);
    }, true);
  }

  function installDashboardGuard() {
    const panel = document.getElementById("topologyDashboard");
    if (!panel || panel.dataset.auraSubtabGuard === "ready") return;
    panel.dataset.auraSubtabGuard = "ready";
    const observer = new MutationObserver(() => restoreIfLegacyRefresh(panel));
    observer.observe(panel, { childList: true, subtree: true });
  }

  function installFullscreenCloseFix() {
    if (!document.getElementById("aura-topology-close-style")) {
      const style = document.createElement("style");
      style.id = "aura-topology-close-style";
      style.textContent = `
        body.topology-fullscreen-mode #topologyFullscreenClose {
          display: inline-flex !important;
          position: fixed !important;
          top: 16px !important;
          right: 16px !important;
          left: auto !important;
          z-index: 10050 !important;
          width: auto !important;
          min-width: 88px !important;
          justify-content: center !important;
          padding: 8px 14px !important;
          border-radius: 999px !important;
          color: #071017 !important;
          background: linear-gradient(135deg, var(--accent), var(--accent-2)) !important;
          box-shadow: 0 12px 30px rgba(0,0,0,.45) !important;
        }
      `;
      document.head.appendChild(style);
    }
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#topologyFullscreenClose")) return;
      event.preventDefault();
      event.stopPropagation();
      document.body.classList.remove("topology-fullscreen-mode");
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => window.AuraTopology?.render?.(), 50);
    }, true);
  }

  function restoreIfLegacyRefresh(panel) {
    if (restoring || panel.classList.contains("hidden")) return;
    const active = document.querySelector("[data-topology-view].active");
    const view = active?.dataset.topologyView || "graph";
    if (!active || view === "graph") return;
    const text = panel.textContent || "";
    const hasUsefulContent = panel.querySelector(".topology-chart, .topology-metrics");
    const looksCleared = /No run data loaded|Load a run from Results|No data available for this view/i.test(text);
    if (hasUsefulContent && !looksCleared) return;
    restoring = true;
    setTimeout(() => {
      restoring = false;
      if (!panel.classList.contains("hidden") && document.querySelector("[data-topology-view].active") === active) active.click();
    }, 30);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
