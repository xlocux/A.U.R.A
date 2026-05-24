"use strict";

(function initAuraCompactDensity() {
  function boot() {
    if (document.getElementById("aura-compact-density-style")) return;
    const style = document.createElement("style");
    style.id = "aura-compact-density-style";
    style.textContent = `
      :root { --compact-gap: 8px; }
      body { line-height: 1.35; }
      header { padding: 10px 14px; }
      .headerbar { gap: 8px; }
      .headerbar h1 { margin: 0; font-size: clamp(18px, 1.8vw, 26px); }
      .tabs { gap: 4px; padding: 6px 10px; }
      .tab { padding: 7px 10px; min-height: 0; }
      .workspace { padding: 8px 10px; }
      .workspace-main { gap: var(--compact-gap); }
      .pane { padding: 10px; border-radius: 10px; }
      .pane h2 { margin: 0 0 8px; padding-bottom: 6px; font-size: 14px; }
      .form-body { gap: 7px; padding: 8px; }
      label { margin: 4px 0 2px; font-size: 11px; }
      input, select, textarea, button { min-height: 0; }
      input, select { padding: 7px 8px; }
      textarea { padding: 7px 8px; min-height: 70px; }
      button { padding: 7px 10px; }
      .split, .target-grid, .row, .row3, .tool-grid { gap: var(--compact-gap); }
      .notice { padding: 8px 9px; margin: 4px 0; }
      .compact-notice { padding: 7px 8px; }
      .check { gap: 7px; min-height: 22px; }
      .tool-grid .check { padding: 2px 0; }
      table { font-size: 12px; }
      th, td { padding: 6px 8px; }
      .scroll { max-height: calc(100vh - 230px); }
      .metrics, .mini-metrics, .detail-metrics { gap: 7px; }
      .metric, .mini-metric, .detail-metrics div { padding: 8px; }
      .result-controls, .result-toolbar, .settings-tabs { gap: 6px; }
      .result-subtab, .settings-tab { padding: 6px 8px; }
      .event { padding: 6px 8px; margin-bottom: 5px; }
      .screenshot-grid { gap: 5px; }
      .screenshot-thumb { width: 72px; height: 50px; padding: 0; }
      .artifact-path { margin-top: 4px; font-size: 10px; }
      .guide-hero, .guide-section, .guide-card, .guide-deep-section { padding: 11px !important; margin-bottom: 8px !important; }
      .guide-grid, .guide-tool-grid, .guide-deep-grid, .guide-correlation-grid { gap: 8px !important; }
      .guide-detail-card, .guide-correlation-card, .guide-deep-card { padding: 9px !important; }
      @media (max-width: 900px) {
        .workspace { padding: 6px; }
        .pane { padding: 8px; }
      }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
