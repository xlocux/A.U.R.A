"use strict";

(function initAuraCompactDensity() {
  function boot() {
    if (document.getElementById("aura-compact-density-style")) return;
    const style = document.createElement("style");
    style.id = "aura-compact-density-style";
    style.textContent = `
      :root { --compact-gap: 7px; }
      body { line-height: 1.32; }
      header { padding: 8px 12px; }
      .headerbar { gap: 8px; }
      .headerbar h1 { margin: 0; font-size: clamp(17px, 1.65vw, 24px); }
      .tabs { gap: 3px; padding: 5px 9px; }
      .tab { padding: 6px 9px; min-height: 0; }
      .workspace { padding: 7px 9px; }
      .workspace-main { gap: var(--compact-gap); }
      .pane { padding: 8px; border-radius: 9px; }
      .pane h2 { margin: 0 0 6px; padding: 0 0 6px; font-size: 13px; letter-spacing: .06em; }
      .form-body { gap: 6px; padding: 7px; }
      label { margin: 3px 0 2px; font-size: 10.5px; letter-spacing: .04em; }
      input, select, textarea, button { min-height: 0; }
      input, select { padding: 6px 8px; }
      textarea { padding: 6px 8px; min-height: 62px; }
      button { padding: 6px 9px; margin-top: 7px; }
      .split, .target-grid, .row, .row3, .tool-grid { gap: var(--compact-gap); }
      .split { margin-bottom: var(--compact-gap); }
      .notice { padding: 7px 8px; margin: 3px 0; }
      .compact-notice { padding: 6px 7px; }
      .check { gap: 6px; min-height: 20px; margin-top: 7px; }
      .tool-grid { column-gap: 12px; row-gap: 3px; }
      .tool-grid .check { padding: 1px 0; }

      .scroll { max-height: calc(100vh - 220px); overflow: auto; }
      table { border-collapse: collapse; font-size: 12px; line-height: 1.25; width: 100%; }
      th, td { padding: 4px 7px; vertical-align: top; }
      th { font-size: 10.5px; line-height: 1.15; white-space: nowrap; }
      td { overflow-wrap: anywhere; }
      tbody tr { min-height: 0; }
      .row-actions { gap: 4px; align-items: center; }
      .row-actions button, td button, .tool-log-button { width: auto; margin: 0; padding: 4px 7px; min-height: 0; line-height: 1.15; font-size: 11px; }
      .api-status-badge, .delta-badge { min-width: 54px; padding: 2px 6px; font-size: 10px; }

      .metrics, .mini-metrics, .detail-metrics { gap: 6px; }
      .metric, .mini-metric, .detail-metrics div { padding: 7px; }
      .metric strong { font-size: 18px; }
      .result-controls, .result-toolbar, .settings-tabs { gap: 5px; }
      .result-subtab, .settings-tab { padding: 5px 7px; }
      .event { padding: 5px 7px; margin-bottom: 4px; }
      .screenshot-grid { gap: 5px; }
      .screenshot-thumb { width: 72px; height: 50px; padding: 0; }
      .artifact-path { margin-top: 3px; font-size: 10px; }

      #settings-credentials.settings-panel.active { overflow: hidden; }
      #settings-credentials .split.embedded { grid-template-columns: minmax(340px, 410px) minmax(820px, 1fr); gap: 10px; height: calc(100vh - 145px); min-height: 0; }
      #settings-credentials .split.embedded > div, #settings-credentials .scroll { min-width: 0; min-height: 0; }
      #settings-credentials .scroll { max-height: none; height: 100%; overflow: auto; }
      #settings-credentials .form-body .row3 { grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr) 112px; }
      #settings-credentials #keyProvider { min-width: 0; width: 100%; font-size: 12px; text-overflow: clip; }
      #settings-credentials #keyProvider option { font-size: 13px; }
      #settings-credentials .scroll table { min-width: 1040px; table-layout: fixed; }
      #settings-credentials th:nth-child(1), #settings-credentials td:nth-child(1) { width: 185px; }
      #settings-credentials th:nth-child(2), #settings-credentials td:nth-child(2) { width: 150px; }
      #settings-credentials th:nth-child(3), #settings-credentials td:nth-child(3) { width: 180px; }
      #settings-credentials th:nth-child(4), #settings-credentials td:nth-child(4) { width: 105px; }
      #settings-credentials th:nth-child(5), #settings-credentials td:nth-child(5) { width: 140px; }
      #settings-credentials th:nth-child(6), #settings-credentials td:nth-child(6) { width: 190px; }
      #settings-credentials td:nth-child(1), #settings-credentials td:nth-child(2) { white-space: normal; word-break: normal; overflow-wrap: break-word; font-weight: 650; }
      #settings-credentials td:nth-child(3) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #settings-credentials .table-sort { white-space: nowrap; overflow: visible; }
      .api-key-actions-cell { display: flex; gap: 4px; align-items: center; white-space: nowrap; flex-wrap: nowrap; }
      .api-key-row-button, .api-key-test, .api-key-delete { width: auto; margin: 0; padding: 4px 7px; font-size: 11px; line-height: 1.1; }

      #tab-wordlists .split { grid-template-columns: minmax(360px, 1fr) minmax(360px, 1fr); align-items: start; }
      #tab-wordlists .split > .pane:nth-child(3) { grid-column: 1 / -1; }
      #tab-wordlists .scroll { max-height: calc(100vh - 315px); }
      #tab-wordlists table { table-layout: fixed; min-width: 880px; }
      #tab-wordlists th:nth-child(1), #tab-wordlists td:nth-child(1) { width: 160px; }
      #tab-wordlists th:nth-child(2), #tab-wordlists td:nth-child(2) { width: 110px; }
      #tab-wordlists th:nth-child(3), #tab-wordlists td:nth-child(3) { width: 84px; }
      #tab-wordlists th:nth-child(4), #tab-wordlists td:nth-child(4) { width: auto; }
      #tab-wordlists th:nth-child(5), #tab-wordlists td:nth-child(5) { width: 170px; }
      #tab-wordlists td:nth-child(1), #tab-wordlists td:nth-child(4) { white-space: normal; overflow-wrap: anywhere; }
      #tab-wordlists td:nth-child(5) { white-space: nowrap; }
      #tab-wordlists td:nth-child(5) button { margin-right: 4px; margin-bottom: 4px; }

      #tab-projects .pane, #tab-project .pane, .projects-panel .pane { padding: 8px; }
      #tab-projects .result-filter-bar, #tab-project .result-filter-bar, .projects-panel .result-filter-bar,
      #tab-projects .project-filter-bar, #tab-project .project-filter-bar, .projects-panel .project-filter-bar {
        gap: 5px;
        padding: 6px;
        margin-bottom: 6px;
      }
      #tab-projects .scroll, #tab-project .scroll, .projects-panel .scroll { max-height: calc(100vh - 155px); }
      #tab-projects table, #tab-project table, .projects-panel table {
        table-layout: fixed;
        min-width: 980px;
        font-size: 11.5px;
        line-height: 1.18;
      }
      #tab-projects th, #tab-projects td,
      #tab-project th, #tab-project td,
      .projects-panel th, .projects-panel td {
        padding: 3px 6px;
        vertical-align: top;
      }
      #tab-projects tbody tr, #tab-project tbody tr, .projects-panel tbody tr { height: auto; }
      #tab-projects td:nth-child(1), #tab-project td:nth-child(1), .projects-panel td:nth-child(1) { width: 64px; }
      #tab-projects td:nth-child(2), #tab-project td:nth-child(2), .projects-panel td:nth-child(2) { white-space: normal; overflow-wrap: anywhere; }
      #tab-projects td:last-child, #tab-project td:last-child, .projects-panel td:last-child { white-space: normal; overflow-wrap: anywhere; }
      #tab-projects .badge, #tab-project .badge, .projects-panel .badge,
      #tab-projects .type-badge, #tab-project .type-badge, .projects-panel .type-badge {
        display: inline-flex;
        min-width: 38px;
        max-width: 54px;
        justify-content: center;
        padding: 2px 6px;
        font-size: 10px;
        line-height: 1.1;
        border-radius: 999px;
        white-space: normal;
      }

      .guide-hero, .guide-section, .guide-card, .guide-deep-section { padding: 10px !important; margin-bottom: 7px !important; }
      .guide-grid, .guide-tool-grid, .guide-deep-grid, .guide-correlation-grid { gap: 7px !important; }
      .guide-detail-card, .guide-correlation-card, .guide-deep-card { padding: 8px !important; }

      @media (max-width: 1200px) {
        #settings-credentials .split.embedded { grid-template-columns: 1fr; height: auto; }
        #settings-credentials .scroll { max-height: calc(100vh - 260px); }
      }
      @media (max-width: 900px) {
        .workspace { padding: 6px; }
        .pane { padding: 7px; }
        #tab-wordlists .split { grid-template-columns: 1fr; }
        #settings-credentials .form-body .row3 { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
