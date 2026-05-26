"use strict";

(function initAuraStatusBadges() {
  const STATUS_TYPES = {
    active: "success",
    completed: "success",
    done: "success",
    installed: "success",
    ok: "success",
    ready: "success",
    success: "success",
    succeeded: "success",
    healthy: "success",
    running: "primary",
    checking: "primary",
    dispatched: "primary",
    installing: "primary",
    pending: "primary",
    queued: "primary",
    testing: "primary",
    preflight: "primary",
    warn: "warning",
    warning: "warning",
    exhausted: "warning",
    timed_out: "warning",
    timeout: "warning",
    skipped: "warning",
    cancelled: "danger",
    disabled: "muted",
    error: "danger",
    failed: "danger",
    failure: "danger",
    inactive: "muted",
    info: "muted",
    idle: "muted",
    unknown: "muted"
  };

  const SVG = {
    spinner: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-refresh-cw animate-spin" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>`,
    alert: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-alert" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>`,
    circle: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle></svg>`
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function normalize(value) {
    return String(value || "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function typeFor(value, options = {}) {
    const normalized = normalize(value);
    if (options.kind === "severity") {
      if (["ok", "success", "completed"].includes(normalized)) return "success";
      if (["warn", "warning"].includes(normalized)) return "warning";
      if (["error", "fail", "failed", "danger"].includes(normalized)) return "danger";
      if (["info", "debug", "notice"].includes(normalized)) return "muted";
    }
    return STATUS_TYPES[normalized] || "muted";
  }

  function iconFor(type) {
    if (type === "primary") return SVG.spinner;
    if (type === "success") return SVG.check;
    if (type === "danger" || type === "warning") return SVG.alert;
    return SVG.circle;
  }

  function labelFor(value, options = {}) {
    const label = options.label ?? value ?? "unknown";
    return String(label).replace(/_/g, " ");
  }

  function badge(value, options = {}) {
    const type = typeFor(value, options);
    const normalized = normalize(value);
    const className = ["aura-status-badge", `is-${type}`, options.className].filter(Boolean).join(" ");
    return `<span class="${className}" data-status="${escapeHtml(normalized)}">${iconFor(type)}<span>${escapeHtml(labelFor(value, options))}</span></span>`;
  }

  function applyToElement(element, value, options = {}) {
    if (!element) return;
    element.className = ["aura-status-badge", `is-${typeFor(value, options)}`, options.className].filter(Boolean).join(" ");
    element.dataset.status = normalize(value);
    element.innerHTML = `${iconFor(typeFor(value, options))}<span>${escapeHtml(labelFor(value, options))}</span>`;
  }

  window.AuraStatusBadges = { badge, applyToElement, escapeHtml, normalize, typeFor };
})();
