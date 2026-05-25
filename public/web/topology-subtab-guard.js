"use strict";

(function initAuraTopologySubtabGuard() {
  let restoring = false;

  function boot() {
    const attach = () => {
      const panel = document.getElementById("topologyDashboard");
      if (!panel || panel.dataset.auraSubtabGuard === "ready") return;
      panel.dataset.auraSubtabGuard = "ready";
      const observer = new MutationObserver(() => restoreIfLegacyRefresh(panel));
      observer.observe(panel, { childList: true, subtree: true });
    };
    attach();
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-tab="topology"], [data-topology-view]')) setTimeout(attach, 80);
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
