"use strict";

(function initAuraResultStatusBadges() {
  let observer = null;
  let scheduled = false;

  function boot() {
    injectStyles();
    enhanceSoon();
    watchToolRows();
  }

  function watchToolRows() {
    if (observer) observer.disconnect();
    const root = document.getElementById("toolLogRows");
    if (!root) {
      setTimeout(watchToolRows, 500);
      return;
    }
    observer = new MutationObserver(() => enhanceSoon());
    observer.observe(root, { childList: true, subtree: true });
  }

  function enhanceSoon() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  function enhance() {
    document.querySelectorAll("#toolLogRows tr").forEach((row) => {
      const cell = row.children[1];
      if (!cell || row.children.length < 5) return;
      const raw = normalizeRawStatus(cell.dataset.rawStatus || cell.textContent || "");
      if (!raw || raw === "status") return;
      const badge = statusBadge(raw);
      if (cell.dataset.rawStatus === raw && cell.querySelector(".tool-status-badge")) return;
      cell.dataset.rawStatus = raw;
      cell.innerHTML = `<span class="tool-status-badge ${badge.className}" title="${escapeHtml(badge.label)}"><span class="status-dot" aria-hidden="true">${badge.icon}</span><span>${escapeHtml(badge.label)}</span></span>`;
    });
  }

  function normalizeRawStatus(value) {
    return String(value || "")
      .replace(/[✓✔⊙○!⚠↻⟳]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function statusBadge(status) {
    if (status === "completed" || status === "ready" || status === "ok") return { className: "ready", icon: "⊙", label: "Completed" };
    if (status === "running" || status === "building") return { className: "building", icon: "↻", label: "Running" };
    if (status === "queued" || status === "pending") return { className: "queued", icon: "○", label: "Queued" };
    if (status === "timeout" || status === "timed out") return { className: "warning", icon: "!", label: "Timeout" };
    if (status === "failed" || status === "error") return { className: "failed", icon: "!", label: status === "error" ? "Error" : "Failed" };
    if (status === "-" || status === "not run" || status === "not-run") return { className: "muted", icon: "○", label: "Not run" };
    return { className: "muted", icon: "○", label: status };
  }

  function injectStyles() {
    if (document.getElementById("aura-result-status-badges-style")) return;
    const style = document.createElement("style");
    style.id = "aura-result-status-badges-style";
    style.textContent = `
      #toolLogRows .tool-status-badge,
      .tool-status-badge {
        display: inline-flex !important;
        align-items: center !important;
        gap: 7px !important;
        min-height: 26px !important;
        padding: 3px 10px !important;
        border: 1px solid var(--line) !important;
        border-radius: 7px !important;
        background: rgba(255,255,255,.035) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.035) !important;
        font-size: 12px !important;
        font-weight: 800 !important;
        line-height: 1 !important;
        white-space: nowrap !important;
      }
      #toolLogRows .tool-status-badge .status-dot,
      .tool-status-badge .status-dot {
        display: inline-grid !important;
        width: 14px !important;
        height: 14px !important;
        place-items: center !important;
        border-radius: 999px !important;
        font-size: 10px !important;
        font-weight: 900 !important;
        line-height: 1 !important;
      }
      #toolLogRows .tool-status-badge.ready,
      .tool-status-badge.ready { color: #bbf7d0 !important; border-color: rgba(34,197,94,.46) !important; background: rgba(34,197,94,.10) !important; }
      #toolLogRows .tool-status-badge.ready .status-dot,
      .tool-status-badge.ready .status-dot { color: #bbf7d0 !important; border: 1px solid rgba(34,197,94,.65) !important; }
      #toolLogRows .tool-status-badge.building,
      .tool-status-badge.building { color: #7dd3fc !important; border-color: rgba(56,189,248,.46) !important; background: rgba(56,189,248,.10) !important; }
      #toolLogRows .tool-status-badge.queued,
      .tool-status-badge.queued { color: #c4b5fd !important; border-color: rgba(167,139,250,.46) !important; background: rgba(167,139,250,.10) !important; }
      #toolLogRows .tool-status-badge.warning,
      .tool-status-badge.warning { color: #fde68a !important; border-color: rgba(245,158,11,.56) !important; background: rgba(245,158,11,.12) !important; }
      #toolLogRows .tool-status-badge.failed,
      .tool-status-badge.failed { color: #fecaca !important; border-color: rgba(239,68,68,.56) !important; background: rgba(239,68,68,.12) !important; }
      #toolLogRows .tool-status-badge.muted,
      .tool-status-badge.muted { color: var(--muted) !important; border-color: var(--line) !important; background: rgba(255,255,255,.035) !important; }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
