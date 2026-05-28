"use strict";

(function initProxiflyImportPatch() {
  const PROXIFLY_LABEL = "Import from Proxifly";
  const PROXIFLY_RAW_URL = "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt";
  const DEFAULT_MAX_LATENCY_MS = 2500;

  function boot() {
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("click", () => setTimeout(() => {
      patchProxyWorkflow();
      patchModal();
    }, 0));
    const observer = new MutationObserver(() => {
      patchProxyWorkflow();
      patchModal();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    patchProxyWorkflow();
  }

  function patchProxyWorkflow() {
    const cleanupButton = document.getElementById("proxyStepPreflight");
    const cleanupStep = cleanupButton?.closest(".proxy-step");
    if (cleanupStep) cleanupStep.remove();
    const importStep = document.querySelector(".proxy-step strong");
    const importStepBox = importStep?.closest(".proxy-step");
    const importSmall = importStepBox?.querySelector("small");
    if (importSmall) importSmall.textContent = "Paste proxies manually or load Proxifly into the modal, then Import and Preflight runs import, preflight, and cleanup once.";
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
    button.title = "Load the Proxifly free proxy list into the textarea for review before running Import and Preflight.";
    actions.insertBefore(button, actions.querySelector("#proxyImportSubmit"));

    const help = modal.querySelector("#proxyImportModalHelp");
    if (help) help.textContent = "Paste proxies manually or load Proxifly into the textarea. Review/edit the list, then click Import and Preflight to run import, preflight, and cleanup once.";
    const note = modal.querySelector(".proxy-import-note");
    if (note) note.textContent = "Accepted formats: host:port, http://host:port, socks4://host:port, socks5://host:port. Import and Preflight closes this modal and runs one import → preflight → cleanup pipeline.";
  }

  function handleDocumentClick(event) {
    const proxiflyButton = event.target.closest?.("#proxyImportProxifly");
    if (proxiflyButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      loadProxiflyIntoTextarea(proxiflyButton);
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
        setProxyStatus("Paste proxies or click Import from Proxifly before running Import and Preflight.", "error");
        setProxyActivity("failed", "Import blocked", "No proxy candidates were supplied.");
        return;
      }
      runImportPipeline({ content, label: "proxy list" });
    }
  }

  async function loadProxiflyIntoTextarea(button) {
    const modal = document.getElementById("proxyImportModal");
    const textarea = modal?.querySelector("#proxyPoolImportContent");
    if (!textarea) return;
    const previousLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Loading Proxifly...";
    setProxyStatus("Loading Proxifly proxy list into the import textarea...", "muted");
    try {
      const response = await fetch(PROXIFLY_RAW_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`Proxifly fetch failed: HTTP ${response.status}`);
      const text = await response.text();
      const normalized = normalizeProxyText(text);
      textarea.value = normalized;
      const count = normalized ? normalized.split(/\r?\n/).length : 0;
      setProxyActivity("ok", "Proxifly loaded", `${count} proxy candidates loaded into the textarea. Review them, then click Import and Preflight.`);
      setProxyStatus(`Loaded ${count} Proxifly proxy candidates into the textarea.`, "ok");
      textarea.focus();
    } catch (error) {
      setProxyActivity("failed", "Proxifly load failed", error.message);
      setProxyStatus(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }

  async function runImportPipeline({ content = "", label }) {
    const modal = document.getElementById("proxyImportModal");
    const maxLatencyMs = clampInteger(modal?.querySelector("#proxyImportLatencyLimit")?.value, DEFAULT_MAX_LATENCY_MS, 250, 30000);
    const timeout = clampInteger(modal?.querySelector("#proxyImportTimeout")?.value, 3500, 1000, 30000);
    closeModal();
    setProxyActivity("running", `Importing ${label}`, "Running one server-side import → preflight → cleanup pipeline. The modal is closed so preflight cannot be triggered twice.");
    setProxyStatus(`Importing ${label}, running preflight, and cleaning unhealthy proxies...`, "muted");
    try {
      const result = await apiFetch("/api/proxies/import-preflight", {
        method: "POST",
        body: JSON.stringify({
          source: "txt",
          content: normalizeProxyText(content),
          options: {
            concurrency: 5,
            timeout,
            maxLatencyMs,
            purgeFailed: true,
            purgeHighLatency: true
          }
        })
      });
      const summary = result.summary || {};
      const cleanup = result.cleanup || {};
      const kept = Math.max(Number(summary.successful || 0) - Number(cleanup.highLatencyRemoved || 0), 0);
      const removed = Number(cleanup.removed || 0);
      const invalid = Number(result.invalid || 0);
      setProxyActivity(kept > 0 ? "ok" : "failed", "Proxy import complete", `${kept}/${summary.total || 0} proxies kept. Removed ${removed}; invalid skipped ${invalid}.`);
      setProxyStatus(`Proxy import complete: ${kept} kept, ${removed} removed, ${invalid} invalid skipped.`, kept > 0 ? "ok" : "warn");
      document.getElementById("proxyRefresh")?.click();
    } catch (error) {
      setProxyActivity("failed", "Proxy import failed", error.message);
      setProxyStatus(error.message, "error");
    }
  }

  function normalizeProxyText(content) {
    return String(content || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
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
