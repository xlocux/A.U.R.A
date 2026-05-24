"use strict";

(function initAuraProxySettings() {
  const STORAGE_KEY = "aura.proxySettings";
  const $ = (id) => document.getElementById(id);

  function getSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        ...settings,
        proxies: Array.isArray(settings.proxies) ? settings.proxies : []
      };
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
    $("saveProxySettings")?.addEventListener("click", saveSettings);
    $("importProxyList")?.addEventListener("click", importProxyList);
    $("clearProxyList")?.addEventListener("click", clearProxyList);
    $("proxySavedList")?.addEventListener("change", selectSavedProxy);
    render();
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
    return {
      enabled: $("proxyEnabled")?.checked || false,
      url: normalizeFormUrl($("proxyUrl")?.value?.trim() || "", mode),
      mode,
      purpose: $("proxyPurpose")?.value || "interception",
      proxies: getSettings().proxies || []
    };
  }

  function saveSettings() {
    const settings = readForm();
    try {
      if (settings.enabled) validateProxyUrl(settings.url);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setStatus(settings.enabled ? `Proxy enabled: ${redactProxyUrl(settings.url)}` : "Proxy disabled.", "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  function renderSavedList(settings = getSettings()) {
    if (!$("proxySavedList")) return;
    const proxies = settings.proxies || [];
    $("proxySavedList").innerHTML = [
      `<option value="">Manual entry</option>`,
      ...proxies.map((proxy) => `<option value="${escapeHtml(proxy.url)}">${escapeHtml(redactProxyUrl(proxy.url))}</option>`)
    ].join("");
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
    const lines = $("proxyImportList").value.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    let imported = 0;
    let skipped = 0;
    for (const line of lines) {
      try {
        const normalized = validateProxyUrl(normalizeFormUrl(line, $("proxyMode").value));
        if (!existing.has(normalized)) {
          existing.set(normalized, {
            url: normalized,
            mode: inferProxyMode(normalized),
            addedAt: new Date().toISOString()
          });
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
    setStatus(`Imported ${imported} proxies. Skipped ${skipped} invalid entries. Saved proxies: ${proxies.length}.`, skipped ? "warn" : "ok");
  }

  function clearProxyList() {
    const current = getSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, proxies: [] }));
    render();
    setStatus("Saved proxy list cleared.", "ok");
  }

  function validateProxyUrl(value) {
    let parsed;
    try {
      parsed = new URL(String(value || "").trim());
    } catch {
      throw new Error("Proxy URL must include a scheme and host.");
    }
    if (!["http:", "https:", "socks4:", "socks5:"].includes(parsed.protocol)) {
      throw new Error("Proxy URL must use http, https, socks4, or socks5.");
    }
    if (!parsed.hostname) throw new Error("Proxy URL must include a host.");
    return parsed.toString();
  }

  function normalizeFormUrl(value, mode) {
    if (!value || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    const scheme = mode === "socks5" ? "socks5" : mode === "socks4" ? "socks4" : "http";
    return `${scheme}://${value}`;
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
    return "http";
  }

  function setStatus(message, statusClass) {
    $("proxySettingsStatus").textContent = message;
    $("proxySettingsStatus").className = `notice ${statusClass}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  window.AuraProxySettings = {
    activeProxyUrl,
    bind
  };
})();
