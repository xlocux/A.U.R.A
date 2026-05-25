"use strict";

(function initAuraTopologyFullscreenFix() {
  function boot() {
    injectStyles();
    ensureControls();
    bindControls();
    observeResultTables();
    enhanceResultTables();
  }

  function ensureControls() {
    const topology = document.getElementById("tab-topology");
    const main = topology?.querySelector(".topology-main");
    const actions = topology?.querySelector(".topology-actions");
    if (!topology || !main) return false;
    if (!document.getElementById("topologyFullscreen")) {
      const openButton = document.createElement("button");
      openButton.id = "topologyFullscreen";
      openButton.type = "button";
      openButton.textContent = "Fullscreen";
      actions?.appendChild(openButton);
    }
    if (!document.getElementById("topologyFullscreenClose")) {
      const closeButton = document.createElement("button");
      closeButton.id = "topologyFullscreenClose";
      closeButton.type = "button";
      closeButton.className = "topology-fullscreen-close";
      closeButton.textContent = "Close";
      main.appendChild(closeButton);
    }
    return true;
  }

  function bindControls() {
    document.addEventListener("click", (event) => {
      if (event.target.closest("#topologyFullscreen")) {
        event.preventDefault();
        event.stopPropagation();
        openFullscreen();
        return;
      }
      if (event.target.closest("#topologyFullscreenClose")) {
        event.preventDefault();
        event.stopPropagation();
        closeFullscreen();
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeFullscreen();
    });
  }

  function openFullscreen() {
    ensureControls();
    document.body.classList.add("topology-fullscreen-mode");
    rerenderTopology();
  }

  function closeFullscreen() {
    document.body.classList.remove("topology-fullscreen-mode");
    rerenderTopology();
  }

  function rerenderTopology() {
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.AuraTopology?.render?.(), 80);
  }

  function observeResultTables() {
    const observer = new MutationObserver(() => enhanceResultTables());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function enhanceResultTables() {
    enhanceLeadScores();
    enhanceToolStatuses();
  }

  function enhanceLeadScores() {
    document.querySelectorAll("#leadRows tr").forEach((row) => {
      const cell = row.children[3];
      if (!cell || cell.dataset.auraScoreEnhanced === "true") return;
      const score = Number(cell.textContent.trim());
      if (!Number.isFinite(score)) return;
      cell.dataset.auraScoreEnhanced = "true";
      const level = score >= 80 ? "high" : score >= 50 ? "medium" : "low";
      cell.innerHTML = `<div class="lead-score ${level}" title="Score ${score}"><span>${score}</span><b><i style="width:${Math.max(0, Math.min(100, score))}%"></i></b></div>`;
    });
  }

  function enhanceToolStatuses() {
    document.querySelectorAll("#toolLogRows tr").forEach((row) => {
      const cell = row.children[1];
      if (!cell || cell.dataset.auraStatusEnhanced === "true") return;
      const rawStatus = cell.textContent.trim();
      if (!rawStatus || row.children.length < 5) return;
      const normalized = normalizeStatus(rawStatus);
      cell.dataset.auraStatusEnhanced = "true";
      cell.innerHTML = `<span class="tool-status-badge ${normalized.className}"><i>${normalized.icon}</i>${escapeHtml(normalized.label)}</span>`;
    });
  }

  function normalizeStatus(value) {
    const status = String(value || "").trim().toLowerCase();
    if (status === "completed") return { className: "ready", icon: "✓", label: "Completed" };
    if (status === "running") return { className: "building", icon: "↻", label: "Running" };
    if (status === "queued") return { className: "queued", icon: "○", label: "Queued" };
    if (status === "timeout") return { className: "warning", icon: "!", label: "Timeout" };
    if (status === "failed") return { className: "failed", icon: "!", label: "Failed" };
    if (status === "-") return { className: "muted", icon: "○", label: "Not run" };
    return { className: "muted", icon: "○", label: value };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function injectStyles() {
    if (document.getElementById("aura-topology-fullscreen-fix-style")) return;
    const style = document.createElement("style");
    style.id = "aura-topology-fullscreen-fix-style";
    style.textContent = `
      body.topology-fullscreen-mode { overflow: hidden !important; }
      body.topology-fullscreen-mode header,
      body.topology-fullscreen-mode #workspaceNav,
      body.topology-fullscreen-mode .topology-side,
      body.topology-fullscreen-mode .topology-view-tabs { display: none !important; }
      body.topology-fullscreen-mode .workspace,
      body.topology-fullscreen-mode .workspace-main,
      body.topology-fullscreen-mode #tab-topology,
      body.topology-fullscreen-mode .topology-shell { position: static !important; width: 100vw !important; max-width: none !important; height: 100dvh !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
      body.topology-fullscreen-mode .topology-main { position: fixed !important; inset: 0 !important; z-index: 9998 !important; display: grid !important; grid-template-rows: auto minmax(0, 1fr) !important; width: 100vw !important; height: 100dvh !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 12px !important; border-radius: 0 !important; background: rgba(5, 7, 11, .99) !important; border: 0 !important; box-shadow: none !important; overflow: hidden !important; }
      body.topology-fullscreen-mode .topology-head { min-height: 48px !important; padding-right: 112px !important; }
      body.topology-fullscreen-mode #topologyCanvas { display: block !important; width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; max-width: 100% !important; max-height: calc(100dvh - 72px) !important; }
      .topology-fullscreen-close { display: none; }
      body.topology-fullscreen-mode #topologyFullscreenClose { display: inline-flex !important; position: fixed !important; top: 14px !important; right: 14px !important; left: auto !important; bottom: auto !important; z-index: 10060 !important; width: auto !important; min-width: 86px !important; min-height: 36px !important; align-items: center !important; justify-content: center !important; margin: 0 !important; padding: 0 14px !important; border: 1px solid var(--vercel-line-strong, var(--line)) !important; border-radius: 8px !important; color: #ffffff !important; background: #18181b !important; box-shadow: 0 12px 30px rgba(0,0,0,.45) !important; }
      .lead-score { display: grid; grid-template-columns: 36px minmax(74px, 1fr); gap: 8px; align-items: center; min-width: 120px; }
      .lead-score span { font-variant-numeric: tabular-nums; color: var(--vercel-text, var(--ink)); font-weight: 800; }
      .lead-score b { display: block; height: 8px; overflow: hidden; border: 1px solid var(--vercel-line, var(--line)); border-radius: 999px; background: rgba(255,255,255,.045); }
      .lead-score i { display: block; height: 100%; border-radius: inherit; }
      .lead-score.low i { background: linear-gradient(90deg, rgba(239,68,68,.75), rgba(245,158,11,.86)); }
      .lead-score.medium i { background: linear-gradient(90deg, rgba(245,158,11,.82), rgba(234,179,8,.92)); }
      .lead-score.high i { background: linear-gradient(90deg, rgba(34,197,94,.82), rgba(56,189,248,.92)); }
      .tool-status-badge { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 2px 9px; border: 1px solid var(--vercel-line, var(--line)); border-radius: 8px; font-size: 12px; font-weight: 800; line-height: 1; white-space: nowrap; }
      .tool-status-badge i { display: inline-grid; width: 14px; height: 14px; place-items: center; border-radius: 999px; font-style: normal; font-size: 10px; }
      .tool-status-badge.ready { color: #bbf7d0; border-color: rgba(34,197,94,.45); background: rgba(34,197,94,.09); }
      .tool-status-badge.building { color: #7dd3fc; border-color: rgba(56,189,248,.45); background: rgba(56,189,248,.09); }
      .tool-status-badge.queued { color: #c4b5fd; border-color: rgba(167,139,250,.45); background: rgba(167,139,250,.09); }
      .tool-status-badge.warning { color: #fde68a; border-color: rgba(245,158,11,.50); background: rgba(245,158,11,.10); }
      .tool-status-badge.failed { color: #fecaca; border-color: rgba(239,68,68,.50); background: rgba(239,68,68,.10); }
      .tool-status-badge.muted { color: var(--vercel-muted, var(--muted)); background: rgba(255,255,255,.035); }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
