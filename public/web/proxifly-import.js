"use strict";

(function initProxiflyImportPatch() {
  const PROXIFLY_LABEL = "Import from Proxifly";
  const PROXIFLY_RAW_URL = "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt";
  const DEFAULT_MAX_LATENCY_MS = 2500;
  const STORAGE_KEY = "aura.proxySettings";
  const sortState = { key: "latency", direction: "asc" };

  function boot() {
    safePatch("initial proxy UI", patchProxyWorkflow);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("change", handleDocumentChange, true);
    document.addEventListener("input", handleDocumentInput, true);
    scheduleDashboardPatch();
  }

  function safePatch(label, fn) {
    try {
      fn();
    } catch (error) {
      console.warn(`[A.U.R.A] Non-blocking proxy UI patch failed: ${label}`, error);
      setProxyStatus(`Proxy UI patch warning: ${error.message}`, "warn");
    }
  }

  function patchProxyWorkflow() {
    const heroText = document.querySelector(".proxy-hero p");
    if (heroText) {
      heroText.textContent = "Proxy pool automation imports and tests routes. Upstream proxy routing controls whether recon tools use the selected top route. Import and Preflight handles setup automatically.";
    }

    const steps = document.querySelector(".proxy-steps");
    if (steps && steps.dataset.automationPatched !== "true") {
      steps.dataset.automationPatched = "true";
      steps.innerHTML = `
        <div class="proxy-step"><span>1</span><strong>Proxy pool automation</strong><small>Open Import to Pool, paste proxies or load Proxifly, then click Import and Preflight.</small></div>
        <div class="proxy-step"><span>2</span><strong>Automatic setup</strong><small>A.U.R.A imports, preflights, cleans, ranks the best pool, enables the top route, and keeps the ranked pool for rotation.</small></div>
        <div class="proxy-step"><span>3</span><strong>Upstream routing</strong><small>The selected top route appears in Proxy URL. The enable switch controls whether recon tools route through it.</small></div>
      `;
    }

    const poolHeader = document.querySelector("#proxyPoolSection .proxy-pool-header p");
    if (poolHeader) {
      poolHeader.textContent = "This table is the cleaned proxy pool. Click table headers to sort by status, latency, success, type, or host.";
    }
  }

  function scheduleModalPatch() {
    const delays = [0, 25, 100, 250];
    for (const delay of delays) {
      setTimeout(() => safePatch(`proxy import modal after ${delay}ms`, patchModal), delay);
    }
  }

  function scheduleDashboardPatch() {
    const delays = [0, 150, 500];
    for (const delay of delays) {
      setTimeout(() => enhanceProxyDashboard().catch(() => {}), delay);
    }
  }

  function patchModal() {
    const modal = document.getElementById("proxyImportModal");
    if (!modal) return;
    const actions = modal.querySelector(".proxy-import-actions");
    if (!actions) return;
    if (!document.getElementById("proxyImportProxifly")) {
      const button = document.createElement("button");
      button.id = "proxyImportProxifly";
      button.type = "button";
      button.className = "secondary-button";
      button.textContent = PROXIFLY_LABEL;
      button.title = "Load the Proxifly free proxy list into the textarea for review before running Import and Preflight.";
      actions.insertBefore(button, actions.querySelector("#proxyImportSubmit"));
    }
    modal.dataset.proxiflyPatched = "true";
    const help = modal.querySelector("#proxyImportModalHelp");
    if (help) help.textContent = "Paste proxies manually or load Proxifly into the textarea. Review/edit the list, then click Import and Preflight. A.U.R.A will import, test, clean, rank the best pool, select the top route, and enable routing automatically.";
    const note = modal.querySelector(".proxy-import-note");
    if (note) note.textContent = "Accepted formats: host:port, http://host:port, socks4://host:port, socks5://host:port. Import and Preflight closes this modal and runs one automated setup pipeline.";
  }

  function handleDocumentClick(event) {
    safePatch("click proxy workflow", patchProxyWorkflow);
    const importPoolButton = event.target.closest?.("#proxyImportServer");
    if (importPoolButton) {
      scheduleModalPatch();
      return;
    }

    const sortButton = event.target.closest?.("[data-proxy-sort]");
    if (sortButton) {
      event.preventDefault();
      const key = sortButton.dataset.proxySort;
      sortState.direction = sortState.key === key && sortState.direction === "asc" ? "desc" : "asc";
      sortState.key = key;
      enhanceProxyDashboard().catch(() => {});
      return;
    }

    safePatch("click proxy modal", patchModal);

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
      return;
    }

    if (event.target.closest?.("#proxyRefresh")) scheduleDashboardPatch();
  }

  function handleDocumentChange(event) {
    if (event.target?.id === "proxyStatusFilter") scheduleDashboardPatch();
  }

  function handleDocumentInput(event) {
    if (event.target?.id === "proxyFilter") window.clearTimeout(window.__auraProxyTableTimer);
    if (event.target?.id === "proxyFilter") window.__auraProxyTableTimer = window.setTimeout(() => enhanceProxyDashboard().catch(() => {}), 120);
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
    const normalizedContent = normalizeProxyText(content);
    const candidates = normalizedContent.split(/\r?\n/).filter(Boolean);
    const stopTicker = startPreflightTicker(candidates);
    closeModal();
    setProxyActivity("running", `Testing ${label}`, "Importing candidates, preflighting routes in parallel, cleaning unhealthy entries, ranking the best pool, and enabling the top route.");
    setProxyStatus(`Testing ${candidates.length} proxy candidates in parallel...`, "muted");
    try {
      const result = await apiFetch("/api/proxies/import-preflight", {
        method: "POST",
        body: JSON.stringify({
          source: "txt",
          content: normalizedContent,
          options: {
            timeout,
            tcpTimeout: Math.min(timeout, 1200),
            maxLatencyMs,
            purgeFailed: true,
            purgeHighLatency: true
          }
        })
      });
      stopTicker();
      const summary = result.summary || {};
      const cleanup = result.cleanup || {};
      const tested = Number(summary.total || result.imported || candidates.length || 0);
      const kept = Math.max(Number(summary.successful || 0) - Number(cleanup.highLatencyRemoved || 0), 0);
      const removed = Number(cleanup.removed || 0);
      const invalid = Number(result.invalid || 0);
      const concurrency = result.concurrency || "auto";
      setProxyActivity(kept > 0 ? "running" : "failed", "Preflight complete", `Tested ${tested} proxies with ${concurrency} parallel workers. Kept ${kept}, removed ${removed}, invalid skipped ${invalid}. Ranking best pool...`);
      setProxyStatus(`Preflight complete: tested ${tested}, kept ${kept}, removed ${removed}, invalid skipped ${invalid}.`, kept > 0 ? "ok" : "warn");
      if (kept > 0) await selectBestPoolAndEnable();
      document.getElementById("proxyRefresh")?.click();
      scheduleDashboardPatch();
    } catch (error) {
      stopTicker();
      setProxyActivity("failed", "Proxy import failed", error.message);
      setProxyStatus(error.message, "error");
    }
  }

  function startPreflightTicker(candidates) {
    const list = candidates.slice(0, 500);
    let index = 0;
    if (!list.length) return () => {};
    const tick = () => {
      const candidate = list[index % list.length];
      setProxyActivity("running", "Parallel preflight in progress", `Testing proxy candidates in parallel. Sample ${index + 1}/${list.length}: ${redactProxyLine(candidate)}`);
      index += 1;
    };
    tick();
    const timer = setInterval(tick, 850);
    return () => clearInterval(timer);
  }

  async function selectBestPoolAndEnable() {
    const data = await apiFetch("/api/proxies?status=all&best=true&limit=10");
    const pool = data.proxies || [];
    const best = pool[0];
    if (!best) {
      setProxyActivity("failed", "No healthy proxy", "Preflight finished, but no active proxy survived cleanup.");
      setProxyStatus("No active proxy survived preflight cleanup.", "warn");
      return;
    }
    const url = proxyRecordUrl(best);
    const mode = best.type === "socks5" ? "socks5" : best.type === "socks4" ? "socks4" : best.type === "https" ? "https" : "http";
    const current = readStoredSettings();
    const bestPool = pool.map((proxy) => ({ url: proxyRecordUrl(proxy), type: proxy.type, latencyMs: proxy.latency_ms || null, successRate: proxy.success_rate || null }));
    const next = { ...current, enabled: true, url, mode, purpose: current.purpose || "lab-egress", bestPool, proxies: Array.isArray(current.proxies) ? current.proxies : [] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    const enabled = document.getElementById("proxyEnabled");
    const input = document.getElementById("proxyUrl");
    const modeSelect = document.getElementById("proxyMode");
    if (enabled) enabled.checked = true;
    if (input) input.value = url;
    if (modeSelect) modeSelect.value = mode;
    setProxyActivity("ok", "Proxy pool ready", `${redactProxyUrl(url)} selected as top route and enabled. ${pool.length} best healthy route(s) are retained for runtime rotation.`);
    setProxyStatus(`Proxy pool ready: ${redactProxyUrl(url)} enabled; ${pool.length} ranked route(s) available for rotation.`, "ok");
  }

  async function enhanceProxyDashboard() {
    const rows = document.getElementById("proxyRows");
    if (!rows) return;
    const status = document.getElementById("proxyStatusFilter")?.value || "all";
    const query = String(document.getElementById("proxyFilter")?.value || "").toLowerCase();
    const data = await apiFetch(`/api/proxies?status=${encodeURIComponent(status)}&limit=500`);
    const proxies = (data.proxies || []).filter((proxy) => [proxy.address, proxy.type, proxy.country, proxy.status].join(" ").toLowerCase().includes(query));
    const sorted = sortProxies(proxies);
    patchMetricCards(sorted, data.total || sorted.length);
    patchTableHeader();
    rows.innerHTML = sorted.length ? sorted.map(renderProxyRow).join("") : `<tr><td colspan="6" class="muted">No proxies match this view.</td></tr>`;
  }

  function patchMetricCards(proxies, total) {
    const enabled = Boolean(document.getElementById("proxyEnabled")?.checked);
    const active = proxies.filter((proxy) => proxy.status === "active").length;
    const bestPool = Math.min(active, 10);
    setMetric("proxyMetricTotal", "Pool view", total || proxies.length || 0);
    setMetric("proxyMetricActive", "Healthy", active);
    setMetric("proxyMetricLatency", "Best pool", bestPool ? `${bestPool} routes` : "-");
    setMetric("proxyMetricSuccess", "Routing", enabled ? "enabled" : "off");
  }

  function setMetric(id, label, value) {
    const strong = document.getElementById(id);
    if (!strong) return;
    const card = strong.closest(".proxy-card");
    const span = card?.querySelector("span");
    if (span) span.textContent = label;
    strong.textContent = String(value);
  }

  function patchTableHeader() {
    const table = document.querySelector(".proxy-table");
    const head = table?.querySelector("thead");
    if (!head || head.dataset.sortable === "true") return;
    head.dataset.sortable = "true";
    head.innerHTML = `<tr>
      <th><button type="button" data-proxy-sort="host">Proxy ${sortIndicator("host")}</button></th>
      <th><button type="button" data-proxy-sort="type">Type ${sortIndicator("type")}</button></th>
      <th><button type="button" data-proxy-sort="country">Region ${sortIndicator("country")}</button></th>
      <th><button type="button" data-proxy-sort="status">Status ${sortIndicator("status")}</button></th>
      <th><button type="button" data-proxy-sort="latency">MS ${sortIndicator("latency")}</button></th>
      <th><button type="button" data-proxy-sort="success">Success ${sortIndicator("success")}</button></th>
    </tr>`;
  }

  function sortIndicator(key) {
    return sortState.key === key ? (sortState.direction === "asc" ? "▲" : "▼") : "";
  }

  function sortProxies(proxies) {
    const direction = sortState.direction === "asc" ? 1 : -1;
    return [...proxies].sort((left, right) => compareProxy(left, right, sortState.key) * direction);
  }

  function compareProxy(left, right, key) {
    if (key === "latency") return numberValue(left.latency_ms, Number.MAX_SAFE_INTEGER) - numberValue(right.latency_ms, Number.MAX_SAFE_INTEGER);
    if (key === "success") return numberValue(left.success_rate, -1) - numberValue(right.success_rate, -1);
    if (key === "status") return statusRank(left.status) - statusRank(right.status);
    if (key === "type") return textValue(left.type).localeCompare(textValue(right.type));
    if (key === "country") return textValue(left.country).localeCompare(textValue(right.country));
    return textValue(`${left.address}:${left.port}`).localeCompare(textValue(`${right.address}:${right.port}`));
  }

  function renderProxyRow(proxy) {
    return `<tr>
      <td><strong>${escapeHtml(proxy.address)}:${escapeHtml(proxy.port)}</strong></td>
      <td><span class="pill">${escapeHtml(proxy.type || "-")}</span></td>
      <td>${escapeHtml(proxy.country || "-")}</td>
      <td>${statusBadge(proxy.status || "unknown")}</td>
      <td>${Number.isFinite(Number(proxy.latency_ms)) ? `${escapeHtml(Math.round(Number(proxy.latency_ms)))} ms` : "-"}</td>
      <td>${Number.isFinite(Number(proxy.success_rate)) ? `${Math.round(Number(proxy.success_rate) * 100)}%` : "-"}</td>
    </tr>`;
  }

  function statusRank(status) {
    const value = String(status || "unknown").toLowerCase();
    if (value === "active") return 0;
    if (value === "testing") return 1;
    if (value === "unknown") return 2;
    if (value === "failed") return 3;
    return 4;
  }

  function numberValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function textValue(value) {
    return String(value || "").toLowerCase();
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

  function proxyRecordUrl(proxy) {
    const auth = proxy.username && proxy.username !== "****" ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || "")}@` : "";
    return `${proxy.type || "http"}://${auth}${proxy.address}:${proxy.port}`;
  }

  function redactProxyLine(value) {
    try {
      const text = String(value || "").trim();
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `proxy://${text}`;
      const parsed = new URL(withScheme);
      if (parsed.username) parsed.username = "****";
      if (parsed.password) parsed.password = "****";
      return withScheme.startsWith("proxy://") ? `${parsed.hostname}:${parsed.port}` : parsed.toString();
    } catch {
      return String(value || "").replace(/^[^:@]+:[^:@]+@/, "****:****@");
    }
  }

  function redactProxyUrl(value) {
    try {
      const parsed = new URL(value);
      if (parsed.username) parsed.username = "****";
      if (parsed.password) parsed.password = "****";
      return parsed.toString();
    } catch {
      return value || "";
    }
  }

  function readStoredSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function statusBadge(status, options = {}) {
    return window.AuraStatusBadges?.badge(status, options) || `<span class="status-pill ${escapeHtml(status || "unknown")}">${escapeHtml(status || "unknown")}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
