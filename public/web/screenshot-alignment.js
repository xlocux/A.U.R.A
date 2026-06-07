"use strict";

(function initAuraScreenshotAlignment() {
  function boot() {
    if (!window.auraApi || window.__auraScreenshotAlignmentPatched) return;
    window.__auraScreenshotAlignmentPatched = true;
    installResultTreeScreenshotAlignment();
    installDiagnosticsExportButton();
  }

  function installResultTreeScreenshotAlignment() {
    const originalApi = window.auraApi;
    window.auraApi = async function alignedAuraApi(path, options = {}) {
      const data = await originalApi(path, options);
      const match = String(path || "").match(/^\/api\/recon-runs\/(\d+)\/result-tree$/);
      if (!match || !data?.tree) return data;
      try {
        const screenshotData = await originalApi(`/api/recon-runs/${match[1]}/screenshots`);
        const screenshots = screenshotData.screenshots || [];
        data.tree.screenshots = screenshots;
        data.tree.summary = {
          ...(data.tree.summary || {}),
          screenshotRuns: screenshots.length,
          screenshotCount: screenshots.reduce((sum, shot) => sum + ((shot.images || []).length || Number(shot.metadata?.screenshotCount || 0)), 0)
        };
      } catch {
        // Keep the original result tree if screenshot enrichment is unavailable.
      }
      return data;
    };
  }

  function installDiagnosticsExportButton() {
    if (document.getElementById("exportDiagnostics")) return;
    const runActivity = document.getElementById("runActivity");
    const runsPane = runActivity?.closest(".pane") || document.getElementById("results-activity")?.querySelector(".pane");
    if (!runsPane) return;
    const header = runsPane.querySelector("h2") || runsPane.firstElementChild;
    const toolbar = document.createElement("div");
    toolbar.className = "result-view-toolbar diagnostics-toolbar";
    toolbar.innerHTML = `
      <button id="exportDiagnostics" class="primary" type="button" title="Download run events, tool results, stdout/stderr previews, preflight, and artifact index for troubleshooting.">Export Diagnostics JSON</button>
      <span class="muted">Attach this file when A.U.R.A tools, tech stack, or screenshots misbehave.</span>
    `;
    if (header?.nextSibling) runsPane.insertBefore(toolbar, header.nextSibling);
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

  function currentRunId() {
    const value = document.getElementById("runId")?.textContent?.trim();
    return value && value !== "-" ? value : "";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
