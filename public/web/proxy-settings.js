"use strict";

(function initAuraProxySettings() {
  const STORAGE_KEY = "aura.proxySettings";
  const DEFAULT_MAX_LATENCY_MS = 2500;
  const $ = (id) => document.getElementById(id);

  injectStylesheet("/proxy-dashboard.css", "aura-proxy-dashboard-css");
  injectScript("/projects-view.js", "aura-projects-view-js");
  injectScript("/aura-modern.js", "aura-modern-js");
  injectScript("/proxifly-import.js", "aura-proxifly-import-js");

  function injectStylesheet(href, id) {
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function injectScript(src, id) {
    if (document.getElementById(id)) return;
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  }

  function getSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...settings, proxies: Array.isArray(settings.proxies) ? settings.proxies : [] };
    } catch {
      return { proxies: [] };
    }
  }

  function activeProxyUrl() {
    const settings = getSettings();
    return settings.enabled ? settings.url : "";
  }

  function bind() {
    if (!$("proxyEnabled")) return;
    upgradeLayout();
    bindAction("saveProxySettings", saveSettings);
    bindAction("proxyRefresh", refreshDashboard);
    bindAction("proxyUseBest", useBestServerProxy);
    bindAction("proxyImportServer", openProxyImportModal);
    bindAction("proxyStepPreflight", preflightServerProxies);
    bindAction("proxyStepBest", useBestServerProxy);
    bindAction("proxyStepEnable", enableSelectedProxy);
    $("proxySavedList")?.addEventListener("change", selectSavedProxy);
    $("proxyFilter")?.addEventListener("input", refreshDashboard);
    $("proxyStatusFilter")?.addEventListener("change", refreshDashboard);
    render();
    refreshDashboard().catch(() => {});
  }

  function bindAction(id, handler) {
    const button = $(id);
    if (!button || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        button.disabled = true;
        await handler();
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function upgradeLayout() {
    const panel = $("settings-proxy");
    if (!panel || $("proxyDashboard")) return;
    panel.classList.add("proxy-console");
    const h2 = panel.querySelector("h2");
    if (h2) h2.textContent = "Proxy Control";
    const form = panel.querySelector(".form-body");
    if (!form) return;

    removeLegacyImportControls(form);

    form.insertAdjacentHTML("afterbegin", `
      <div class="proxy-hero">
        <div>
          <span class="eyebrow">Authorized proxy flow</span>
          <strong>Import authorized proxies into the pool, run protocol preflight, then keep only healthy low-latency routes.</strong>
          <p>Use only proxies you are authorized to operate. The top <code>Import to Pool</code> action opens a modal for one proxy per line; failed and high-latency entries are removed after preflight.</p>
        </div>
        <div class="proxy-hero-actions">
          <button id="proxyImportServer" type="button">Import to Pool</button>
          <button id="proxyRefresh" type="button">Refresh</button>
        </div>
      </div>
      <div class="proxy-steps" aria-label="Proxy setup workflow">
        <div class="proxy-step"><span>1</span><strong>Import</strong><small>Use the top Import to Pool button to paste authorized proxies into the server-side pool.</small></div>
        <div class="proxy-step"><span>2</span><strong>Preflight + clean</strong><small>Protocol-aware checks remove failed routes and entries above the latency ceiling.</small><button id="proxyStepPreflight" type="button">Run Cleanup Preflight</button></div>
        <div class="proxy-step"><span>3</span><strong>Pick</strong><small>Select the fastest healthy authorized proxy from the cleaned preflight results.</small><button id="proxyStepBest" type="button">Use Best</button></div>
        <div class="proxy-step"><span>4</span><strong>Enable</strong><small>Save the selected proxy for recon tools without changing target scope.</small><button id="proxyStepEnable" type="button">Enable for Runs</button></div>
      </div>
      <div id="proxyDashboard" class="proxy-dashboard">
        <div class="proxy-card"><span>Total</span><strong id="proxyMetricTotal">0</strong></div>
        <div class="proxy-card"><span>Active</span><strong id="proxyMetricActive">0</strong></div>
        <div class="proxy-card"><span>Avg latency</span><strong id="proxyMetricLatency">-</strong></div>
        <div class="proxy-card"><span>Success</span><strong id="proxyMetricSuccess">-</strong></div>
      </div>
      <div id="proxyActivity" class="proxy-activity idle">
        <div class="proxy-activity-rail"><span></span></div>
        <strong id="proxyActivityTitle">Proxy workflow idle</strong>
        <small id="proxyActivityDetail">Import authorized proxies from the top action, preflight and clean the pool, then pick the best active route.</small>
      </div>
    `);

    const oldNotice = form.querySelector(".compact-notice");
    if (oldNotice) {
      oldNotice.textContent = "Use this only for authorized interception or lab egress. Proxy routing changes transport only; it does not expand authorized recon scope.";
    }

    const statusNode = $("proxySettingsStatus");
    const poolSection = `
      <section id="proxyPoolSection" class="proxy-pool-section" aria-label="Proxy pool and preflight results">
        <div class="proxy-pool-header">
          <div>
            <span class="eyebrow">Pool results</span>
            <strong>Imported proxy pool and preflight status</strong>
            <p>Review the cleaned server-side pool. Use Best reads this table and writes the selected route back to Proxy URL above.</p>
          </div>
        </div>
        <div class="proxy-toolbar">
          <input id="proxyFilter" type="search" placeholder="Filter by host, type, region">
          <select id="proxyStatusFilter"><option value="all">All</option><option value="active">Active</option><option value="unknown">Unknown</option><option value="failed">Failed</option></select>
          <button id="proxyUseBest" type="button">Use Best</button>
        </div>
        <div class="proxy-table-wrap scroll">
          <table class="proxy-table">
            <thead><tr><th>Proxy</th><th>Type</th><th>Region</th><th>Status</th><th>Latency</th><th>Success</th></tr></thead>
            <tbody id="proxyRows"><tr><td colspan="6" class="muted">Import authorized proxies from the top action to start preflight.</td></tr></tbody>
          </table>
        </div>
      </section>
    `;
    if (statusNode) statusNode.insertAdjacentHTML("afterend", poolSection);
    else form.insertAdjacentHTML("beforeend", poolSection);
  }

  function removeLegacyImportControls(form) {
    const importLabel = form.querySelector('label[for="proxyImportList"]');
    const importArea = $("proxyImportList");
    const importButton = $("importProxyList");
    const clearButton = $("clearProxyList");
    const legacyRow = importButton?.closest(".row");

    importLabel?.remove();
    importArea?.remove();
    if (legacyRow && (legacyRow.contains(importButton) || legacyRow.contains(clearButton))) {
      legacyRow.remove();
    } else {
      importButton?.remove();
      clearButton?.remove();
    }
  }

  function render() {
    const settings = getSettings();
    const proxyEnabled = $("proxyEnabled");
    const proxyUrl = $("proxyUrl");
    const proxyMode = $("proxyMode");
    const proxyPurpose = $("proxyPurpose");
    if (!proxyEnabled || !proxyUrl || !proxyMode || !proxyPurpose) return;
    proxyEnabled.checked = Boolean(settings.enabled);
    proxyUrl.value = settings.url || "";
    proxyMode.value = settings.mode || inferProxyMode(settings.url);
    proxyPurpose.value = settings.purpose || "interception";
    renderSavedList(settings);
  }

  function readForm() {
    const mode = $("proxyMode")?.value || "http";
    return { enabled: $("proxyEnabled")?.checked || false, url: normalizeProxyInput($("proxyUrl")?.value?.trim() || "", mode), mode, purpose: $("proxyPurpose")?.value || "interception", proxies: getSettings().proxies || [] };
  }

  async function saveSettings() {
    const settings = readForm();
    if (settings.enabled) validateProxyUrl(settings.url);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setStatus(settings.enabled ? `Proxy enabled: ${redactProxyUrl(settings.url)}` : "Proxy disabled.", "ok");
    await refreshDashboard();
  }

  async function enableSelectedProxy() {
    if (!$("proxyUrl").value.trim()) await useBestServerProxy();
    $("proxyEnabled").checked = true;
    await saveSettings();
  }

  function renderSavedList(settings = getSettings()) {
    if (!$("proxySavedList")) return;
    const proxies = settings.proxies || [];
    $("proxySavedList").innerHTML = [`<option value="">Manual entry</option>`, ...proxies.map((proxy) => `<option value="${escapeHtml(proxy.url)}">${escapeHtml(redactProxyUrl(proxy.url))}</option>`)].join("");
    $("proxySavedList").value = proxies.some((proxy) => proxy.url === settings.url) ? settings.url : "";
  }

  function selectSavedProxy() {
    const selected = $("proxySavedList").value;
    if (!selected) return;
    $("proxyUrl").value = selected;
    $("proxyMode").value = inferProxyMode(selected);
  }

  function openProxyImportModal() {
    const modal = ensureProxyImportModal();
    modal.classList.remove("hidden");
    modal.querySelector("#proxyPoolImportContent")?.focus();
  }

  function closeProxyImportModal() {
    $("proxyImportModal")?.classList.add("hidden");
  }

  function ensureProxyImportModal() {
    let modal = $("proxyImportModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "proxyImportModal";
    modal.className = "proxy-import-modal hidden";
    modal.innerHTML = `
      <div class="proxy-import-dialog" role="dialog" aria-modal="true" aria-labelledby="proxyImportModalTitle" aria-describedby="proxyImportModalHelp">
        <div class="proxy-import-head">
          <div>
            <span class="eyebrow">Pool import</span>
            <h3 id="proxyImportModalTitle">Import authorized proxies</h3>
            <p id="proxyImportModalHelp">Paste one authorized proxy per line. The pool import immediately runs protocol preflight and removes failed or high-latency entries.</p>
          </div>
          <button class="proxy-import-close" type="button" aria-label="Close proxy import">&times;</button>
        </div>
        <label for="proxyPoolImportContent">Proxy list</label>
        <textarea id="proxyPoolImportContent" spellcheck="false" placeholder="host:port&#10;http://host:port&#10;socks5://host:port"></textarea>
        <div class="proxy-import-grid">
          <div>
            <label for="proxyImportLatencyLimit">Max latency to keep</label>
            <input id="proxyImportLatencyLimit" type="number" min="250" max="30000" step="250" value="${DEFAULT_MAX_LATENCY_MS}">
          </div>
          <div>
            <label for="proxyImportTimeout">Preflight timeout</label>
            <input id="proxyImportTimeout" type="number" min="1000" max="30000" step="500" value="3500">
          </div>
        </div>
        <div class="proxy-import-note">Failed protocol checks are deleted from the pool. Successful proxies slower than the latency ceiling are deleted too.</div>
        <div class="proxy-import-actions">
          <button id="proxyImportCancel" type="button" class="secondary-button">Cancel</button>
          <button id="proxyImportSubmit" type="button">Import and Preflight</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest(".proxy-import-close") || event.target.closest("#proxyImportCancel")) closeProxyImportModal();
      if (event.target.closest("#proxyImportSubmit")) submitProxyImportModal();
    });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeProxyImportModal();
    });
    return modal;
  }

  async function submitProxyImportModal() {
    const modal = ensureProxyImportModal();
    const submit = modal.querySelector("#proxyImportSubmit");
    const content = modal.querySelector("#proxyPoolImportContent")?.value || "";
    const maxLatencyMs = clampInteger(modal.querySelector("#proxyImportLatencyLimit")?.value, DEFAULT_MAX_LATENCY_MS, 250, 30000);
    const timeout = clampInteger(modal.querySelector("#proxyImportTimeout")?.value, 3500, 1000, 30000);
    try {
      submit.disabled = true;
      await importAndPreflightPool(content, { maxLatencyMs, timeout });
      closeProxyImportModal();
    } catch (error) {
      setActivity("failed", "Import failed", error.message);
      setStatus(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  }

  async function importAndPreflightPool(content, { maxLatencyMs = DEFAULT_MAX_LATENCY_MS, timeout = 3500 } = {}) {
    const lines = String(content || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      setActivity("failed", "Import blocked", "Paste one or more authorized proxies in the import modal.");
      throw new Error("Paste one or more authorized proxies before importing.");
    }

    setActivity("running", "Importing and preflighting proxy pool", `Testing ${lines.length} submitted proxies and removing failed or slow entries.`);
    setStatus("Import to Pool running: parsing, preflighting, and cleaning the server-side pool...", "muted");
    const result = await apiFetch("/api/proxies/import-preflight", {
      method: "POST",
      body: JSON.stringify({
        source: "txt",
        content: lines.join("\n"),
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
    const healthy = Number(summary.successful || 0) - Number(cleanup.highLatencyRemoved || 0);
    const removed = Number(cleanup.removed || 0);
    setActivity(healthy > 0 ? "ok" : "failed", "Import and preflight complete", `${Math.max(healthy, 0)}/${summary.total || 0} proxies kept. Removed ${removed} failed or high-latency entries.`);
    setStatus(`Import to Pool complete: ${Math.max(healthy, 0)} kept, ${removed} removed, ${result.invalid || 0} invalid skipped.`, healthy > 0 ? "ok" : "warn");
    await refreshDashboard();
  }

  async function refreshDashboard() {
    if (!$("proxyRows")) return;
    const status = $("proxyStatusFilter")?.value || "all";
    const [list, stats] = await Promise.all([apiFetch(`/api/proxies?status=${encodeURIComponent(status)}&limit=100`), apiFetch("/api/proxies/stats")]);
    renderMetrics(list.proxies || [], stats);
    renderProxyRows(list.proxies || []);
  }

  async function preflightServerProxies() {
    setActivity("running", "Cleaning proxy pool", "Running protocol preflight and deleting failed or high-latency routes.");
    setStatus("Cleanup preflight running: testing imported proxies and pruning unhealthy entries...", "muted");
    try {
      const result = await apiFetch("/api/proxies/preflight", {
        method: "POST",
        body: JSON.stringify({
          status: "preflight",
          options: {
            concurrency: 5,
            timeout: 3500,
            maxLatencyMs: DEFAULT_MAX_LATENCY_MS,
            purgeFailed: true,
            purgeHighLatency: true
          }
        })
      });
      const cleanup = result.cleanup || {};
      const kept = Math.max(Number(result.summary?.successful || 0) - Number(cleanup.highLatencyRemoved || 0), 0);
      setActivity(kept ? "ok" : "failed", "Cleanup preflight complete", `${kept}/${result.summary.total} healthy proxies kept. Removed ${cleanup.removed || 0} unhealthy entries.`);
      setStatus(`Cleanup preflight complete: ${kept} kept, ${cleanup.removed || 0} removed.`, kept ? "ok" : "warn");
      await refreshDashboard();
    } catch (error) {
      setActivity("failed", "Proxy preflight failed", error.message);
      throw error;
    }
  }

  async function useBestServerProxy() {
    setActivity("running", "Selecting best proxy", "Reading active proxy metrics and choosing the fastest healthy route.");
    const data = await apiFetch("/api/proxies?status=all&best=true&limit=1");
    const best = data.proxies?.[0];
    if (!best) {
      setActivity("failed", "No active proxy", "Run the guided preflight before selecting a proxy.");
      setStatus("Step 3 blocked: no active proxy available. Run Import to Pool or Cleanup Preflight first.", "warn");
      return;
    }
    const url = proxyRecordUrl(best);
    $("proxyUrl").value = url;
    $("proxyMode").value = best.type === "socks5" ? "socks5" : best.type === "socks4" ? "socks4" : best.type === "https" ? "https" : "http";
    $("proxyEnabled").checked = true;
    await saveSettings();
    setActivity("ok", "Proxy selected", `${redactProxyUrl(url)} is enabled for recon runs.`);
    setStatus(`Selected best proxy ${redactProxyUrl(url)}. It is enabled for runs.`, "ok");
  }

  function renderMetrics(proxies, stats) {
    const counts = stats.counts || {};
    $("proxyMetricTotal").textContent = String(Object.values(counts).reduce((a, b) => a + Number(b || 0), 0) || proxies.length || 0);
    $("proxyMetricActive").textContent = String(counts.active || proxies.filter((proxy) => proxy.status === "active").length || 0);
    $("proxyMetricLatency").textContent = stats.averages?.latencyMs ? `${Math.round(stats.averages.latencyMs)} ms` : "-";
    $("proxyMetricSuccess").textContent = stats.averages?.successRate ? `${Math.round(stats.averages.successRate * 100)}%` : "-";
  }

  function renderProxyRows(proxies) {
    const query = String($("proxyFilter")?.value || "").toLowerCase();
    const filtered = proxies.filter((proxy) => [proxy.address, proxy.type, proxy.country, proxy.status].join(" ").toLowerCase().includes(query));
    $("proxyRows").innerHTML = filtered.length ? filtered.map((proxy) => `
      <tr>
        <td><strong>${escapeHtml(proxy.address)}:${escapeHtml(proxy.port)}</strong></td>
        <td><span class="pill">${escapeHtml(proxy.type)}</span></td>
        <td>${escapeHtml(proxy.country || "-")}</td>
        <td>${statusBadge(proxy.status || "unknown")}</td>
        <td>${proxy.latency_ms ? `${escapeHtml(Math.round(proxy.latency_ms))} ms` : "-"}</td>
        <td>${Number.isFinite(Number(proxy.success_rate)) ? `${Math.round(Number(proxy.success_rate) * 100)}%` : "-"}</td>
      </tr>`).join("") : `<tr><td colspan="6" class="muted">No proxies match this view.</td></tr>`;
  }

  function statusBadge(status, options = {}) {
    return window.AuraStatusBadges?.badge(status, options) || `<span class="status-pill ${escapeHtml(status || "unknown")}">${escapeHtml(status || "unknown")}</span>`;
  }

  function validateProxyUrl(value) {
    let parsed;
    try { parsed = new URL(String(value || "").trim()); } catch { throw new Error("Proxy URL must include a scheme and host."); }
    if (!["http:", "https:", "socks4:", "socks5:"].includes(parsed.protocol)) throw new Error("Proxy URL must use http, https, socks4, or socks5.");
    if (!parsed.hostname) throw new Error("Proxy URL must include a host.");
    return parsed.toString();
  }

  function normalizeProxyInput(value, mode) {
    const text = String(value || "").trim();
    if (!text || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
    const inferred = inferSchemeFromProxyText(text, mode);
    return `${inferred}://${text}`;
  }

  function inferSchemeFromProxyText(value, mode) {
    const explicitMode = mode === "socks5" || mode === "socks4" || mode === "https" ? mode : null;
    const port = extractPort(value);
    if (port === 1080 || port === 1081 || port === 1085 || port === 1088 || port === 4145 || port === 9050 || port === 9150) return "socks5";
    if (port === 443 || port === 8443) return "https";
    if (port === 8080 || port === 8000 || port === 3128 || port === 8888 || port === 8118 || port === 80) return "http";
    return explicitMode || "http";
  }

  function extractPort(value) {
    const match = String(value || "").match(/:(\d+)(?:\D*)$/);
    return match ? Number(match[1]) : null;
  }

  function proxyRecordUrl(proxy) {
    const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || "")}@` : "";
    return `${proxy.type || "http"}://${auth}${proxy.address}:${proxy.port}`;
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

  function setActivity(state, title, detail) {
    const box = $("proxyActivity");
    if (box) box.className = `proxy-activity ${state}`;
    if ($("proxyActivityTitle")) $("proxyActivityTitle").textContent = title;
    if ($("proxyActivityDetail")) $("proxyActivityDetail").textContent = detail;
  }

  function setStatus(message, kind = "muted") {
    const node = $("proxySettingsStatus");
    if (!node) return;
    node.textContent = message;
    node.className = `notice ${kind}`;
  }

  async function apiFetch(path, options = {}) {
    if (window.auraApi) return window.auraApi(path, options);
    const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function clampInteger(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isInteger(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  window.AuraProxySettings = { activeProxyUrl };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
