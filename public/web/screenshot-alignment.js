"use strict";

(function initAuraScreenshotAlignment() {
  function boot() {
    if (!window.auraApi || window.__auraScreenshotAlignmentPatched) return;
    window.__auraScreenshotAlignmentPatched = true;
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
