"use strict";

(function initAuraReconStatusBar() {
  const ACTIVE_STATUSES = new Set(["queued", "running", "paused"]);
  const STATUS_LABEL = { queued: "Queued", running: "Running", paused: "Paused", completed: "Completed", failed: "Failed", cancelled: "Cancelled", idle: "Idle" };
  const STATUS_CLASS = { queued: "sb-queued", running: "sb-running", paused: "sb-paused", completed: "sb-done", failed: "sb-failed", cancelled: "sb-cancelled" };

  let bar = null;
  let ticker = null;

  function boot() {
    injectStyles();
    bar = buildBar();
    const headerbar = document.querySelector(".headerbar");
    if (headerbar) headerbar.insertBefore(bar, headerbar.querySelector(".top-command") || null);
    tick();
    ticker = setInterval(tick, 1500);
  }

  function buildBar() {
    const el = document.createElement("div");
    el.id = "reconStatusBar";
    el.className = "recon-status-bar recon-status-bar--idle";
    el.innerHTML = `
      <span class="rsb-pulse" aria-hidden="true"></span>
      <span class="rsb-run"></span>
      <span class="rsb-sep" aria-hidden="true">·</span>
      <span class="rsb-status"></span>
      <span class="rsb-sep" aria-hidden="true">·</span>
      <span class="rsb-phase"></span>
      <span class="rsb-sep rsb-sep-activity" aria-hidden="true">·</span>
      <span class="rsb-activity"></span>
      <span class="rsb-counts"></span>
    `;
    el.addEventListener("click", () => {
      document.querySelector('[data-tab="results"]')?.click();
      document.querySelector('[data-results-view="activity"]')?.click();
    });
    el.title = "Click to open Logs";
    return el;
  }

  function tick() {
    if (!bar) return;

    const runId = document.getElementById("runId")?.textContent?.trim();
    const status = document.getElementById("runStatus")?.textContent?.trim() || "idle";
    const activityRaw = document.getElementById("runActivity")?.textContent?.trim() || "";

    // Parse phase and latest activity from the multiline runActivity text
    let phase = "-";
    let activity = "";
    const lines = activityRaw.split("\n");
    for (const line of lines) {
      const phaseMatch = line.match(/^Phase:\s*(.+)/);
      if (phaseMatch) phase = phaseMatch[1].trim();
      const actMatch = line.match(/^Latest activity:\s*(.+)/);
      if (actMatch) activity = actMatch[1].trim();
    }
    if (!activity) {
      // Fall back to error or seed info
      for (const line of lines) {
        if (line.startsWith("Error:") || line.startsWith("Seeds:")) { activity = line; break; }
      }
    }

    const isActive = ACTIVE_STATUSES.has(status);
    const hasRun = runId && runId !== "-";

    // Update classes
    bar.className = `recon-status-bar ${STATUS_CLASS[status] || "recon-status-bar--idle"}`;
    if (!hasRun) bar.className = "recon-status-bar recon-status-bar--idle";

    // Pulse indicator
    const pulse = bar.querySelector(".rsb-pulse");
    if (pulse) pulse.className = `rsb-pulse ${isActive ? "rsb-pulse--active" : "rsb-pulse--inactive"}`;

    // Run ID
    const runEl = bar.querySelector(".rsb-run");
    if (runEl) runEl.textContent = hasRun ? `Run ${runId}` : "No run";

    // Status
    const statusEl = bar.querySelector(".rsb-status");
    if (statusEl) statusEl.textContent = STATUS_LABEL[status] || status;

    // Phase
    const phaseEl = bar.querySelector(".rsb-phase");
    if (phaseEl) phaseEl.textContent = hasRun ? phase : "-";

    // Activity (truncated)
    const actEl = bar.querySelector(".rsb-activity");
    const sepAct = bar.querySelector(".rsb-sep-activity");
    if (actEl) {
      const truncated = activity.length > 60 ? activity.slice(0, 57) + "…" : activity;
      actEl.textContent = truncated;
      actEl.title = activity;
    }
    if (sepAct) sepAct.style.display = activity ? "" : "none";
    if (actEl) actEl.style.display = activity ? "" : "none";

    // Counts (domains / services) when active or completed
    const countsEl = bar.querySelector(".rsb-counts");
    if (countsEl) {
      const domains = document.getElementById("domainCount")?.textContent?.trim();
      const services = document.getElementById("serviceCount")?.textContent?.trim();
      if (hasRun && domains && domains !== "0") {
        countsEl.textContent = `${domains}d ${services || 0}s`;
        countsEl.style.display = "";
      } else {
        countsEl.style.display = "none";
      }
    }
  }

  function injectStyles() {
    if (document.getElementById("recon-status-bar-style")) return;
    const style = document.createElement("style");
    style.id = "recon-status-bar-style";
    style.textContent = `
      #reconStatusBar {
        display: flex; align-items: center; gap: 7px;
        padding: 5px 12px; border-radius: 999px;
        font-size: 12px; white-space: nowrap; cursor: pointer;
        border: 1px solid var(--line); background: rgba(10,14,20,.55);
        max-width: 480px; overflow: hidden;
        transition: border-color .2s, background .2s;
        flex-shrink: 1; min-width: 0;
        grid-column: 2; grid-row: 1;
        justify-self: center; align-self: center;
      }
      #reconStatusBar:hover { border-color: var(--accent); background: rgba(10,14,20,.8); }

      /* Status colour variants */
      #reconStatusBar.sb-running { border-color: rgba(111,244,238,.45); }
      #reconStatusBar.sb-queued  { border-color: rgba(232,207,116,.4); }
      #reconStatusBar.sb-paused  { border-color: rgba(180,140,60,.4); }
      #reconStatusBar.sb-done    { border-color: rgba(60,200,100,.4); }
      #reconStatusBar.sb-failed  { border-color: rgba(220,60,60,.4); }

      /* Pulse dot */
      .rsb-pulse {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        background: var(--muted); transition: background .3s;
      }
      .rsb-pulse--active {
        background: #6ff4ee;
        box-shadow: 0 0 0 0 rgba(111,244,238,.6);
        animation: rsb-ping 1.4s ease-in-out infinite;
      }
      .rsb-pulse--inactive { background: rgba(255,255,255,.18); animation: none; }
      @keyframes rsb-ping {
        0%   { box-shadow: 0 0 0 0 rgba(111,244,238,.6); }
        70%  { box-shadow: 0 0 0 6px rgba(111,244,238,0); }
        100% { box-shadow: 0 0 0 0 rgba(111,244,238,0); }
      }

      .sb-failed .rsb-pulse--inactive { background: rgba(220,60,60,.7); }
      .sb-done   .rsb-pulse--inactive { background: rgba(60,200,100,.7); }

      /* Text segments */
      .rsb-run    { font-weight: 600; color: var(--accent); flex-shrink: 0; }
      .rsb-status { font-weight: 600; flex-shrink: 0; }
      .sb-running .rsb-status { color: #6ff4ee; }
      .sb-queued  .rsb-status { color: #e8cf74; }
      .sb-paused  .rsb-status { color: #b48c3c; }
      .sb-done    .rsb-status { color: #3cc864; }
      .sb-failed  .rsb-status { color: #dc3c3c; }

      .rsb-phase    { color: var(--muted); flex-shrink: 0; }
      .rsb-sep      { color: rgba(255,255,255,.2); flex-shrink: 0; }
      .rsb-activity { color: var(--muted); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
      .rsb-counts   { margin-left: 4px; padding: 1px 7px; border-radius: 999px; background: rgba(47,141,245,.18); color: #2f8df5; font-size: 11px; font-weight: 600; flex-shrink: 0; }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
