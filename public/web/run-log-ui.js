"use strict";

(function initAuraRunLogUi() {
  let eventsReordering = false;
  let aiRowsReordering = false;
  let toolRowsReordering = false;

  function boot() {
    installDiagnosticsExportButton();
    observeNewestFirstRunEvents();
    observeNewestFirstTable("aiLogRows", 0, () => aiRowsReordering, (value) => { aiRowsReordering = value; });
    observeNewestFirstTable("toolLogRows", 3, () => toolRowsReordering, (value) => { toolRowsReordering = value; });
    document.addEventListener("click", (event) => {
      if (event.target.closest?.('[data-tab="runs"]') || event.target.closest?.('[data-dashboard-tab="runs"]')) {
        setTimeout(installDiagnosticsExportButton, 0);
        setTimeout(sortRunEventsNewestFirst, 0);
      }
    }, true);
    window.addEventListener("aura:run-loaded", () => {
      setTimeout(installDiagnosticsExportButton, 0);
      setTimeout(sortRunEventsNewestFirst, 0);
    });
    setTimeout(installDiagnosticsExportButton, 250);
    setTimeout(sortRunEventsNewestFirst, 250);
  }

  function installDiagnosticsExportButton() {
    if (document.getElementById("exportDiagnostics")) return;
    const runActivity = document.getElementById("runActivity");
    const runsPane = runActivity?.closest(".pane") || document.getElementById("tab-runs")?.querySelector(".pane");
    if (!runsPane) return;
    const toolbar = document.createElement("div");
    toolbar.id = "diagnosticsToolbar";
    toolbar.className = "result-view-toolbar diagnostics-toolbar";
    toolbar.innerHTML = `
      <button id="exportDiagnostics" class="primary" type="button" title="Download run events, tool results, stdout/stderr previews, preflight, and artifact index for troubleshooting.">Export Diagnostics JSON</button>
      <span class="muted">Download this file when tools, tech stack, screenshots, or logs look wrong.</span>
    `;
    const activity = document.getElementById("runActivity");
    if (activity) runsPane.insertBefore(toolbar, activity);
    else runsPane.appendChild(toolbar);
    document.getElementById("exportDiagnostics").addEventListener("click", () => {
      const runId = currentRunId();
      const status = document.getElementById("status");
      if (!runId) {
        if (status) status.textContent = "Load a run before exporting diagnostics.";
        return;
      }
      window.location.href = `/api/recon-runs/${encodeURIComponent(runId)}/diagnostics`;
    });
  }

  function observeNewestFirstRunEvents() {
    const target = document.getElementById("events");
    if (!target || target.dataset.newestFirstObserver === "true") return;
    target.dataset.newestFirstObserver = "true";
    const observer = new MutationObserver(() => {
      observer.disconnect();
      sortRunEventsNewestFirst(target);
      observer.observe(target, { childList: true });
    });
    observer.observe(target, { childList: true });
    sortRunEventsNewestFirst(target);
  }

  function sortRunEventsNewestFirst(target) {
    if (!target) target = document.getElementById("events");
    if (!target || eventsReordering) return;
    const nodes = [...target.children].filter((node) => node.classList?.contains("event"));
    if (nodes.length < 2) return;
    eventsReordering = true;
    try {
      nodes
        .sort((left, right) => eventTime(right) - eventTime(left))
        .forEach((node) => target.appendChild(node));
    } finally {
      eventsReordering = false;
    }
  }

  function eventTime(node) {
    const match = String(node.textContent || "").match(/^\[([^\]]+)]/);
    const time = match ? Date.parse(match[1]) : 0;
    return Number.isFinite(time) ? time : 0;
  }

  function observeNewestFirstTable(tbodyId, timeCellIndex, getLock, setLock) {
    const attach = () => {
      const tbody = document.getElementById(tbodyId);
      if (!tbody || tbody.dataset.newestFirstObserver === "true") return;
      tbody.dataset.newestFirstObserver = "true";
      const observer = new MutationObserver(() => {
        observer.disconnect();
        sortTableNewestFirst(tbody, timeCellIndex, getLock, setLock);
        observer.observe(tbody, { childList: true });
      });
      observer.observe(tbody, { childList: true });
      sortTableNewestFirst(tbody, timeCellIndex, getLock, setLock);
    };
    attach();
    setTimeout(attach, 300);
  }

  function sortTableNewestFirst(tbody, timeCellIndex, getLock, setLock) {
    if (!tbody || getLock()) return;
    const rows = [...tbody.querySelectorAll("tr")]
      .filter((row) => !row.classList.contains("group-row") && !row.querySelector(".muted"));
    if (rows.length < 2) return;
    setLock(true);
    try {
      rows
        .sort((left, right) => tableRowTime(right, timeCellIndex) - tableRowTime(left, timeCellIndex))
        .forEach((row) => tbody.appendChild(row));
    } finally {
      setLock(false);
    }
  }

  function tableRowTime(row, index) {
    const text = row.children[index]?.textContent?.trim() || "";
    const time = Date.parse(text);
    return Number.isFinite(time) ? time : 0;
  }

  function currentRunId() {
    const value = document.getElementById("runId")?.textContent?.trim();
    return value && value !== "-" ? value : "";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
