"use strict";

(function initAuraResultStatusBadges() {
  let observer = null;
  let scheduled = false;

  function boot() {
    injectStyles();
    enhanceSoon();
    watchToolRows();
    setInterval(enhanceSoon, 1500);
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
      cell.innerHTML = `<span class="tool-status-badge ${badge.className}" style="${badgeStyle(badge.className)}" title="${escapeHtml(badge.label)}"><span class="status-dot" style="${dotStyle(badge.className)}" aria-hidden="true">${badge.icon}</span><span>${escapeHtml(badge.label)}</span></span>`;
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

  function badgeStyle(className) {
    const colors = {
      ready: ["#bbf7d0", "rgba(34,197,94,.46)", "rgba(34,197,94,.10)"],
      building: ["#7dd3fc", "rgba(56,189,248,.46)", "rgba(56,189,248,.10)"],
      queued: ["#c4b5fd", "rgba(167,139,250,.46)", "rgba(167,139,250,.10)"],
      warning: ["#fde68a", "rgba(245,158,11,.56)", "rgba(245,158,11,.12)"],
      failed: ["#fecaca", "rgba(239,68,68,.56)", "rgba(239,68,68,.12)"],
      muted: ["var(--muted)", "var(--line)", "rgba(255,255,255,.035)"]
    }[className] || ["var(--muted)", "var(--line)", "rgba(255,255,255,.035)"];
    return `display:inline-flex;align-items:center;gap:7px;min-height:26px;padding:3px 10px;border:1px solid ${colors[1]};border-radius:7px;background:${colors[2]};color:${colors[0]};box-shadow:inset 0 1px 0 rgba(255,255,255,.035);font-size:12px;font-weight:800;line-height:1;white-space:nowrap;`;
  }

  function dotStyle(className) {
    const color = className === "failed" ? "#fecaca" : className === "warning" ? "#fde68a" : className === "building" ? "#7dd3fc" : className === "queued" ? "#c4b5fd" : className === "ready" ? "#bbf7d0" : "var(--muted)";
    return `display:inline-grid;width:14px;height:14px;place-items:center;border-radius:999px;border:1px solid currentColor;color:${color};font-size:10px;font-weight:900;line-height:1;`;
  }

  function injectStyles() {
    if (document.getElementById("aura-result-status-badges-style")) return;
    const style = document.createElement("style");
    style.id = "aura-result-status-badges-style";
    style.textContent = `.tool-status-badge{display:inline-flex!important;align-items:center!important}`;
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
