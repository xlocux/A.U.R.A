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
    const exportPane = document.getElementById("results-export") || document.querySelector(".export-actions");
    const actions = exportPane?.querySelector(".export-actions") || exportPane;
    if (!actions || document.getElementById("exportDiagnostics")) return;
    const button = document.createElement("button");
    button.id = "exportDiagnostics";
    button.type = "button";
    button.textContent = "Diagnostics JSON";
    button.title = "Download run events, tool results, stdout/stderr previews, preflight, and artifact index for troubleshooting.";
    button.addEventListener("click", () => {
      const runId = currentRunId();
      const status = document.getElementById("status");
      if (!runId) {
        if (status) status.textContent = "Load a run before exporting diagnostics.";
        return;
      }
      window.location.href = `/api/recon-runs/${encodeURIComponent(runId)}/diagnostics`;
    });
    actions.appendChild(button);
  }

  function currentRunId() {
    const value = document.getElementById("runId")?.textContent?.trim();
    return value && value !== "-" ? value : "";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
