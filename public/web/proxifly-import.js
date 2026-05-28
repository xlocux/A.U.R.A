"use strict";

(function initProxiflyImportPatch() {
  const PROXIFLY_LABEL = "Import Proxifly + Preflight";
  const DEFAULT_MAX_LATENCY_MS = 2500;

  function boot() {
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("click", () => setTimeout(patchModal, 0));
    const observer = new MutationObserver(() => patchModal());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function patchModal() {
    const modal = document.getElementById("proxyImportModal");
    if (!modal || modal.dataset.proxiflyPatched === "true") return;
    modal.dataset.proxiflyPatched = "true";
    const actions = modal.querySelector(".proxy-import-actions");
    if (!actions) return;
    const button = document.createElement("button");
    button.id = "proxyImportProxifly";
    button.type = "button";
    button.className = "secondary-button";
    button.textContent = PROXIFLY_LABEL;
    button.title = "Fetch https://github.com/proxifly/free-proxy-list/blob/main/proxies/all/data.txt, import it, run preflight once, and clean failed/slow proxies.";
    actions.insertBefore(button, actions.querySelector("#proxyImportSubmit"));

    const note = modal.querySelector(".proxy-import-note");
    if (note) {
      note.textContent = "Accepted formats: host:port, http://host:port, socks4://host:port, socks5://host:port. Import and Preflight closes this modal and runs one import → preflight → cleanup pipeline.";
    }
  }

  function handleDocumentClick(event) {
    const proxiflyButton = event.target.closest?.("#proxyImportProxifly");
    if (proxiflyButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runImportPipeline({ source: "proxifly", label: "Proxifly" });
      return;
    }

    const submitButton = event.target.closest?.("#proxyImportSubmit");
    if (submitButton) {
      const modal = document.getElementById("proxyImportModal");
      if (!modal) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const content = modal.querySelector("#proxyPoolImportContent")?.value || "";
      if (!content.trim()) {
        setProxyStatus("Paste one or more proxies, or use Import Proxifly + Preflight.", "error");
        setProxyActivity("failed", "Import blocked", "No proxy candidates were supplied.");
        return;
      }
      runImportPipeline({ source: "txt", content, label: "manual list" });
    }
  }

  async function runImportPipeline({ source, content = "", label }) {
    const modal = document.getElementById("proxyImportModal");
    const maxLatencyMs = clampInteger(modal?.querySelector("#proxyImportLatencyLimit")?.value, DEFAULT_MAX_LATENCY_MS, 250, 30000);
    const timeout = clampInteger(modal?.querySelector("#proxyImportTimeout")?.value, 3500, 1000, 30000);
    closeModal();
    setProxyActivity("running", `Importing ${label}`, "Running one server-side import → preflight → cleanup pipeline. The modal is closed so the preflight is not triggered twice.");
    setProxyStatus(`Importing ${label}, running preflight, and cleaning unhealthy proxies...`, "muted");
    try {
      const payload = {
        source,
        options: {
          concurrency: 5,
          timeout,
          maxLatencyMs,
          purgeFailed: true,
          purgeHighLatency: true
        }
      };
      if (source === "txt") payload.content = normalizeProxyText(content);
      const result = await apiFetch("/api/proxies/import-preflight", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const summary = result.summary || {};
      const cleanup = result.cleanup || {};
      const kept = Math.max(Number(summary.successful || 0) - Number(cleanup.highLatencyRemoved || 0), 0);
      const removed = Number(cleanup.removed || 0);
      const invalid = Number(result.invalid || 0);
      setProxyActivity(kept > 0 ? "ok" : "failed", `${label} import complete`, `${kept}/${summary.total || 0} proxies kept. Removed ${removed}; invalid skipped ${invalid}.`);
      setProxyStatus(`${label} import complete: ${kept} kept, ${removed} removed, ${invalid} invalid skipped.`, kept > 0 ? "ok" : "warn");
      document.getElementById("proxyRefresh")?.click();
    } catch (error) {
      setProxyActivity("failed", `${label} import failed`, error.message);
      setProxyStatus(error.message, "error");
    }
  }

  function normalizeProxyText(content) {
    return String(content || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  async function apiFetch(path, options = {}) {
    if (window.auraApi) return window.auraApi(path, options);
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function closeModal() {
    document.getElementById("proxyImportModal")?.classList.add("hidden");
  }

  function setProxyStatus(message, kind = "muted") {
    const node = document.getElementById("proxySettingsStatus") || document.getElementById("status");
    if (!node) return;
    node.textContent = message;
    node.className = `notice ${kind}`;
  }

  function setProxyActivity(state, title, detail) {
    const box = document.getElementById("proxyActivity");
    if (box) box.className = `proxy-activity ${state}`;
    const titleNode = document.getElementById("proxyActivityTitle");
    const detailNode = document.getElementById("proxyActivityDetail");
    if (titleNode) titleNode.textContent = title;
    if (detailNode) detailNode.textContent = detail;
  }

  function clampInteger(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isInteger(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
