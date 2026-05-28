"use strict";

(function initProxiflyImportPatch() {
  const PROXIFLY_LABEL = "Import from Proxifly";
  const PROXIFLY_RAW_URL = "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt";
  const DEFAULT_MAX_LATENCY_MS = 2500;
  const STORAGE_KEY = "aura.proxySettings";

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
    const form = document.querySelector("#settings-proxy .form-body");
    if (!form) return;
    form.classList.add("proxy-separated-flow");
    splitUpstreamRoutingSection(form);
    const steps = document.querySelector(".proxy-steps");
    if (steps) steps.replaceWith(statusCard());
    const heroText = document.querySelector(".proxy-hero p");
    if (heroText) {
      heroText.textContent = "Proxy pool automation imports and tests a pool of routes. Upstream proxy routing below controls whether recon tools actually use the selected pool route.";
    }
  }

  function splitUpstreamRoutingSection(form) {
    if (document.getElementById("proxyUpstreamRoutingSection")) return;
    const enabled = document.getElementById("proxyEnabled");
    const url = document.getElementById("proxyUrl");
    const saved = document.getElementById("proxySavedList");
    const mode = document.getElementById("proxyMode");
    const purpose = document.getElementById("proxyPurpose");
    const save = document.getElementById("saveProxySettings");
    if (!enabled || !url || !mode || !purpose || !save) return;

    const section = document.createElement("section");
    section.id = "proxyUpstreamRoutingSection";
    section.className = "proxy-pool-section upstream-routing-section";
    section.innerHTML = `
      <div class="proxy-pool-header">
        <div>
          <span class="eyebrow">Upstream proxy routing</span>
          <strong>Route recon tools through the selected proxy route</strong>
          <p>This is separate from pool automation. The pool finds and ranks healthy proxies; this switch decides whether A.U.R.A sends recon tools through the selected best route.</p>
        </div>
      </div>
      <div class="upstream-routing-body form-body"></div>
    `;
    const body = section.querySelector(".upstream-routing-body");
    moveControlWithLabel(body, enabled);
    moveControlWithLabel(body, url);
    if (saved) moveControlWithLabel(body, saved);
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(wrapControlWithLabel(mode));
    row.appendChild(wrapControlWithLabel(purpose));
    body.appendChild(row);
    body.appendChild(save);

    const poolSection = document.getElementById("proxyPoolSection");
    if (poolSection) form.insertBefore(section, poolSection);
    else form.appendChild(section);
  }

  function statusCard() {
    const card = document.createElement("div");
    card.id = "proxyAutoWorkflow";
    card.className = "proxy-activity idle";
    card.innerHTML = `
      <div class="proxy-activity-rail"><span></span></div>
      <strong>Automated proxy pool setup</strong>
      <small>Import list → preflight → cleanup → rank best pool → enable top route for runs. The full ranked pool remains available for rotation.</small>
    `;
    return card;
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
    if (help) help.textContent = "Paste proxies manually or load Proxifly into the textarea. Review/edit the list, then click Import and Preflight. A.U.R.A will import, test, clean, rank the best pool, select the top route, and enable routing automatically.";
    const note = modal.querySelector(".proxy-import-note");
    if (note) note.textContent = "Accepted formats: host:port, http://host:port, socks4://host:port, socks5://host:port. Import and Preflight closes this modal and runs one automated pipeline.";
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
    const normalizedContent = normalizeProxyText(content);
    const candidates = normalizedContent.split(/\r?\n/).filter(Boolean);
    const stopTicker = startPreflightTicker(candidates);
    closeModal();
    setProxyActivity("running", `Testing ${label}`, "Importing candidates, preflighting routes, cleaning unhealthy entries, ranking the best pool, and enabling the top route.");
    setProxyStatus(`Testing ${candidates.length} proxy candidates...`, "muted");
    try {
      const result = await apiFetch("/api/proxies/import-preflight", {
        method: "POST",
        body: JSON.stringify({
          source: "txt",
          content: normalizedContent,
          options: {
            concurrency: 5,
            timeout,
            maxLatencyMs,
            purgeFailed: true,
            purgeHighLatency: true
          }
        })
      });
      stopTicker();
      const summary = result.summary || {};
      const cleanup = result.cleanup || {};
      const kept = Math.max(Number(summary.successful || 0) - Number(cleanup.highLatencyRemoved || 0), 0);
      const removed = Number(cleanup.removed || 0);
      const invalid = Number(result.invalid || 0);
      setProxyActivity(kept > 0 ? "running" : "failed", "Preflight complete", `${kept}/${summary.total || 0} proxies kept. Removed ${removed}; invalid skipped ${invalid}. Ranking best pool...`);
      setProxyStatus(`Preflight complete: ${kept} kept, ${removed} removed, ${invalid} invalid skipped. Ranking best pool...`, kept > 0 ? "ok" : "warn");
      if (kept > 0) await selectBestPoolAndEnable();
      document.getElementById("proxyRefresh")?.click();
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
      setProxyActivity("running", "Preflight in progress", `Testing proxy candidate ${index + 1}/${list.length}: ${redactProxyLine(candidate)}`);
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

  function moveControlWithLabel(target, control) {
    target.appendChild(wrapControlWithLabel(control));
  }

  function wrapControlWithLabel(control) {
    const wrapper = document.createElement("div");
    const label = document.querySelector(`label[for="${control.id}"]`);
    if (label) wrapper.appendChild(label);
    wrapper.appendChild(control);
    return wrapper;
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
    const autoBox = document.getElementById("proxyAutoWorkflow");
    if (autoBox) autoBox.className = `proxy-activity ${state}`;
    const titleNode = document.getElementById("proxyActivityTitle");
    const detailNode = document.getElementById("proxyActivityDetail");
    if (titleNode) titleNode.textContent = title;
    if (detailNode) detailNode.textContent = detail;
    if (autoBox) {
      const strong = autoBox.querySelector("strong");
      const small = autoBox.querySelector("small");
      if (strong) strong.textContent = title;
      if (small) small.textContent = detail;
    }
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
