"use strict";

(function initAuraProxySettings() {
  const STORAGE_KEY = "aura.proxySettings";
  const $ = (id) => document.getElementById(id);

  injectStylesheet("/proxy-dashboard.css", "aura-proxy-dashboard-css");
  injectScript("/projects-view.js", "aura-projects-view-js");

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
    $("saveProxySettings")?.addEventListener("click", saveSettings);
    $("importProxyList")?.addEventListener("click", importProxyList);
    $("clearProxyList")?.addEventListener("click", clearProxyList);
    $("proxySavedList")?.addEventListener("change", selectSavedProxy);
    $("proxyRefresh")?.addEventListener("click", refreshDashboard);
    $("proxyPreflight")?.addEventListener("click", preflightServerProxies);
    $("proxyUseBest")?.addEventListener("click", useBestServerProxy);
    $("proxyImportServer")?.addEventListener("click", importServerProxies);
    $("proxyFilter")?.addEventListener("input", refreshDashboard);
    $("proxyStatusFilter")?.addEventListener("change", refreshDashboard);
    render();
    refreshDashboard().catch(() => {});
  }

  function upgradeLayout() {
    const panel = $("settings-proxy");
    if (!panel || $("proxyDashboard")) return;
    panel.classList.add("proxy-console");
    const h2 = panel.querySelector("h2");
    if (h2) h2.textContent = "Proxy Control";
    const form = panel.querySelector(".form-body");
    if (!form) return;
    form.insertAdjacentHTML("afterbegin", `
      <div class="proxy-hero">
        <div>
          <span class="eyebrow">Automatic rotation</span>
          <strong>Preflight picks the fastest healthy proxy before WSL runs.</strong>
          <p>Paste proxies as host:port or with a scheme. Port 1080 is inferred as SOCKS5; common web proxy ports are inferred as HTTP/HTTPS.</p>
        </div>
        <div class="proxy-hero-actions">
          <button id="proxyRefresh" type="button">Refresh</button>
          <button id="proxyPreflight" type="button">Preflight</button>
        </div>
      </div>
      <div id="proxyDashboard" class="proxy-dashboard">
        <div class="proxy-card"><span>Total</span><strong id="proxyMetricTotal">0</strong></div>
        <div class="proxy-card"><span>Active</span><strong id="proxyMetricActive">0</strong></div>
        <div class="proxy-card"><span>Avg latency</span><strong id="proxyMetricLatency">-</strong></div>
        <div class="proxy-card"><span>Success</span><strong id="proxyMetricSuccess">-</strong></div>
      </div>
      <div class="proxy-toolbar">
        <input id="proxyFilter" type="search" placeholder="Filter by host, type, region">
        <select id="proxyStatusFilter"><option value="all">All</option><option value="active">Active</option><option value="unknown">Unknown</option><option value="failed">Failed</option></select>
        <button id="proxyUseBest" type="button">Use Best</button>
        <button id="proxyImportServer" type="button">Import to Pool</button>
      </div>
      <div class="proxy-table-wrap scroll">
        <table class="proxy-table">
          <thead><tr><th>Proxy</th><th>Type</th><th>Region</th><th>Status</th><th>Latency</th><th>Success</th></tr></thead>
          <tbody id="proxyRows"><tr><td colspan="6" class="muted">No proxy data loaded.</td></tr></tbody>
        </table>
      </div>
    `);
    const oldNotice = form.querySelector(".compact-notice");
    if (oldNotice) oldNotice.textContent = "You can paste host:port lists, full proxy URLs, user:pass@host:port, or host:port:socks5. Run Preflight before recon.";
  }

  function render() {
    const settings = getSettings();
    $("proxyEnabled").checked = Boolean(settings.enabled);
    $("proxyUrl").value = settings.url || "";
    $("proxyMode").value = settings.mode || inferProxyMode(settings.url);
    $("proxyPurpose").value = settings.purpose || "interception";
    renderSavedList(settings);
  }

  function readForm() {
    const mode = $("proxyMode")?.value || "http";
    return { enabled: $("proxyEnabled")?.checked || false, url: normalizeProxyInput($("proxyUrl")?.value?.trim() || "", mode), mode, purpose: $("proxyPurpose")?.value || "interception", proxies: getSettings().proxies || [] };
  }

  function saveSettings() {
    const settings = readForm();
    try {
      if (settings.enabled) validateProxyUrl(settings.url);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setStatus(settings.enabled ? `Proxy enabled: ${redactProxyUrl(settings.url)}` : "Proxy disabled.", "ok");
      refreshDashboard().catch(() => {});
    } catch (error) {
      setStatus(error.message, "error");
    }
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

  function importProxyList() {
    const current = getSettings();
    const existing = new Map((current.proxies || []).map((proxy) => [proxy.url, proxy]));
    const lines = $("proxyImportList").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let imported = 0;
    let skipped = 0;
    for (const line of lines) {
      try {
        const normalized = validateProxyUrl(normalizeProxyInput(line, $("proxyMode").value));
        if (!existing.has(normalized)) {
          existing.set(normalized, { url: normalized, mode: inferProxyMode(normalized), addedAt: new Date().toISOString() });
          imported += 1;
        }
      } catch {
        skipped += 1;
      }
    }
    const proxies = [...existing.values()].sort((left, right) => left.url.localeCompare(right.url));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, proxies }));
    $("proxyImportList").value = "";
    render();
    setStatus(`Imported ${imported}. Skipped ${skipped}. Saved locally: ${proxies.length}.`, skipped ? "warn" : "ok");
  }

  async function importServerProxies() {
    const lines = $("proxyImportList").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return setStatus("Paste one or more proxies before importing to the rotation pool.", "warn");
    try {
      const result = await apiFetch("/api/proxies/sources/txt", { method: "POST", body: JSON.stringify({ params: { content: lines.join("\n") } }) });
      setStatus(`Added ${result.added} proxies to the server rotation pool.`, "ok");
      await refreshDashboard();
    } catch (error) { setStatus(error.message, "error"); }
  }

  function clearProxyList() {
    const current = getSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, proxies: [] }));
    render();
    setStatus("Local saved proxy list cleared. Server-side rotation pool is unchanged.", "ok");
  }

  async function refreshDashboard() {
    if (!$("proxyRows")) return;
    try {
      const status = $("proxyStatusFilter")?.value || "all";
      const [list, stats] = await Promise.all([apiFetch(`/api/proxies?status=${encodeURIComponent(status)}&limit=100`), apiFetch("/api/proxies/stats")]);
      renderMetrics(list.proxies || [], stats);
      renderProxyRows(list.proxies || []);
    } catch (error) {
      $("proxyRows").innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function preflightServerProxies() {
    try {
      setStatus("Running proxy preflight...", "muted");
      const result = await apiFetch("/api/proxies/preflight", { method: "POST", body: JSON.stringify({ options: { concurrency: 5, timeout: 3500 } }) });
      setStatus(`Preflight done: ${result.summary.successful}/${result.summary.total} healthy.`, result.summary.successful ? "ok" : "warn");
      await refreshDashboard();
    } catch (error) { setStatus(error.message, "error"); }
  }

  async function useBestServerProxy() {
    try {
      const data = await apiFetch("/api/proxies?status=active&limit=1");
      const best = data.proxies?.[0];
      if (!best) return setStatus("No active server-side proxy available. Run Preflight first.", "warn");
      $("proxyUrl").value = proxyRecordUrl(best);
      $("proxyMode").value = best.type === "socks5" ? "socks5" : best.type === "socks4" ? "socks4" : "http";
      $("proxyEnabled").checked = true;
      saveSettings();
    } catch (error) { setStatus(error.message, "error"); }
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
        <td><span class="status-pill ${escapeHtml(proxy.status || "unknown")}">${escapeHtml(proxy.status || "unknown")}</span></td>
        <td>${proxy.latency_ms ? `${escapeHtml(Math.round(proxy.latency_ms))} ms` : "-"}</td>
        <td>${Number.isFinite(Number(proxy.success_rate)) ? `${Math.round(Number(proxy.success_rate) * 100)}%` : "-"}</td>
      </tr>`).join("") : `<tr><td colspan="6" class="muted">No proxies match this view.</td></tr>`;
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
    if (port === 1080 || port === 1081 || port === 1085 || port === 9050 || port === 9150) return "socks5";
    if (port === 443 || port === 8443) return "https";
    if (port === 8080 || port === 8000 || port === 3128 || port === 8888 || port === 8118 || port === 80) return "http";
    return explicitMode || "http";
  }

  function extractPort(value) {
    const text = String(value || "").trim();
    const withoutType = text.replace(/:(http|https|socks4|socks5)$/i, "");
    const match = withoutType.match(/:(\d{1,5})$/);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  function redactProxyUrl(value) {
    const parsed = new URL(validateProxyUrl(value));
    if (parsed.username) parsed.username = "****";
    if (parsed.password) parsed.password = "****";
    return parsed.toString();
  }

  function inferProxyMode(value) {
    const text = String(value || "");
    if (text.startsWith("socks5:")) return "socks5";
    if (text.startsWith("socks4:")) return "socks4";
    if (text.startsWith("https:")) return "https";
    return "http";
  }

  function proxyRecordUrl(proxy) {
    return `${proxy.type}://${proxy.username ? `${encodeURIComponent(proxy.username)}${proxy.password && proxy.password !== "****" ? `:${encodeURIComponent(proxy.password)}` : ""}@` : ""}${proxy.address}:${proxy.port}`;
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function setStatus(message, statusClass) {
    $("proxySettingsStatus").textContent = message;
    $("proxySettingsStatus").className = `notice ${statusClass}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  window.AuraProxySettings = { activeProxyUrl, bind, refreshDashboard };
})();
