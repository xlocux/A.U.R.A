"use strict";

(function initAuraDashboardV2() {
  const state = {
    targets: [],
    runs: [],
    apiKeys: [],
    providers: [],
    selectedRunId: null,
    selectedRunData: null,
    metricWindow: "run",
    search: ""
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const arr = (value) => Array.isArray(value) ? value : [];

  function boot() {
    bindNavigation();
    bindControls();
    refreshAll();
    setInterval(refreshAll, 15000);
  }

  function bindNavigation() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-section]");
      const jump = event.target.closest("[data-section-jump]");
      const section = nav?.dataset.section || jump?.dataset.sectionJump;
      if (!section) return;
      event.preventDefault();
      document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.section === section));
      document.querySelectorAll(".dashboard-section").forEach((node) => node.classList.toggle("active", node.id === `section-${section}`));
    });
  }

  function bindControls() {
    $("refreshDashboard")?.addEventListener("click", refreshAll);
    $("runSelect")?.addEventListener("change", (event) => selectRun(event.target.value));
    $("logsRunSelect")?.addEventListener("change", (event) => selectRun(event.target.value));
    $("globalSearch")?.addEventListener("input", (event) => {
      state.search = String(event.target.value || "").trim().toLowerCase();
      renderAll();
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-metric-window]");
      if (!button) return;
      state.metricWindow = button.dataset.metricWindow;
      document.querySelectorAll("[data-metric-window]").forEach((node) => node.classList.toggle("active", node === button));
      renderMetrics();
    });
  }

  async function refreshAll() {
    try {
      setBanner("Loading live dashboard data...", "loading");
      const [targetsPayload, runsPayload, keysPayload, aiPayload] = await Promise.all([
        getJson("/api/targets"),
        getJson("/api/recon-runs"),
        getJson("/api/api-keys"),
        getJson("/api/ai-settings").catch(() => null)
      ]);
      state.targets = arr(targetsPayload?.targets);
      state.runs = arr(runsPayload?.runs).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
      state.apiKeys = arr(keysPayload?.apiKeys);
      state.providers = arr(keysPayload?.providers);
      state.ai = aiPayload?.settings || null;
      if (!state.selectedRunId && state.runs[0]) state.selectedRunId = String(state.runs[0].id);
      await loadSelectedRun();
      renderAll();
      setBanner("", "hidden");
    } catch (error) {
      setBanner(`Dashboard data failed to load: ${error.message}`, "error");
    }
  }

  async function selectRun(runId) {
    state.selectedRunId = String(runId || "");
    await loadSelectedRun();
    renderAll();
  }

  async function loadSelectedRun() {
    const id = state.selectedRunId;
    if (!id) {
      state.selectedRunData = emptyRunData();
      return;
    }
    const [runPayload, countsPayload, eventsPayload, toolsPayload, domainsPayload, servicesPayload, urlsPayload, techPayload, screenshotsPayload] = await Promise.all([
      getJson(`/api/recon-runs/${encodeURIComponent(id)}`).catch(() => null),
      getJson(`/api/recon-runs/${encodeURIComponent(id)}/counts`).catch(() => null),
      getJson(`/api/recon-runs/${encodeURIComponent(id)}/events`).catch(() => null),
      getJson(`/api/recon-runs/${encodeURIComponent(id)}/tool-results`).catch(() => null),
      getJson(`/api/recon-runs/${encodeURIComponent(id)}/domains`).catch(() => null),
      getJson(`/api/recon-runs/${encodeURIComponent(id)}/http-services`).catch(() => null),
      getJson(`/api/recon-runs/${encodeURIComponent(id)}/urls`).catch(() => null),
      getJson(`/api/recon-runs/${encodeURIComponent(id)}/technologies`).catch(() => null),
      getJson(`/api/recon-runs/${encodeURIComponent(id)}/screenshots`).catch(() => null)
    ]);
    state.selectedRunData = {
      run: runPayload?.run || state.runs.find((run) => String(run.id) === String(id)) || null,
      counts: countsPayload?.counts || null,
      events: arr(eventsPayload?.events),
      tools: arr(toolsPayload?.toolResults),
      domains: arr(domainsPayload?.domains),
      services: arr(servicesPayload?.services),
      urls: arr(urlsPayload?.urls),
      technologies: arr(techPayload?.technologies),
      screenshots: arr(screenshotsPayload?.screenshots)
    };
  }

  async function getJson(url) {
    const response = await fetch(url);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
    return data;
  }

  function renderAll() {
    renderRunSelectors();
    renderHero();
    renderApplications();
    renderRuns();
    renderMetrics();
    renderLogs();
    renderProviders();
    renderAnalytics();
    renderSettings();
  }

  function renderRunSelectors() {
    const options = state.runs.map((run) => `<option value="${esc(run.id)}">#${esc(run.id)} · ${esc(run.target_name || "target")} · ${esc(run.status || "unknown")}</option>`).join("");
    for (const id of ["runSelect", "logsRunSelect"]) {
      const select = $(id);
      if (!select) continue;
      select.innerHTML = options || `<option value="">No runs</option>`;
      select.value = state.selectedRunId || "";
    }
  }

  function renderHero() {
    const run = state.selectedRunData?.run;
    const activeRuns = state.runs.filter((item) => ["running", "queued", "paused"].includes(item.status)).length;
    $("overviewSubtitle").textContent = `${state.targets.length} target${state.targets.length === 1 ? "" : "s"}, ${state.runs.length} run${state.runs.length === 1 ? "" : "s"}, ${activeRuns} active. ${run ? `Viewing run #${run.id} for ${run.target_name}.` : "No run selected."}`;
    $("applicationsMeta").textContent = `${state.targets.length} targets · ${activeRuns} active runs · ${activeKeys().length} active providers`;
  }

  function renderApplications() {
    const modules = [
      { title: "Targets", icon: "T", detail: `${state.targets.length} saved applications`, status: state.targets.length ? "ok" : "warn", footer: "Scope configs" },
      { title: "Recon Runs", icon: "R", detail: `${state.runs.length} deployment records`, status: state.runs.some((run) => run.status === "running") ? "running" : "ok", footer: "Execution history" },
      { title: "Providers", icon: "P", detail: `${activeKeys().length}/${state.apiKeys.length} active keys`, status: activeKeys().length ? "ok" : "warn", footer: "API readiness" },
      { title: "AI Agent", icon: "AI", detail: state.ai ? `${state.ai.provider || "opencode"} assistant` : "runtime not loaded", status: state.ai ? "ok" : "warn", footer: "Context helper" }
    ];
    $("applicationCards").innerHTML = modules.map(appCard).join("");
    $("targetCards").innerHTML = filteredTargets().map((target) => appCard({
      title: target.target_name || target.name,
      icon: initials(target.target_name || target.name),
      detail: `${arr(target.root_domains).length} root domain${arr(target.root_domains).length === 1 ? "" : "s"}`,
      status: "ok",
      footer: target.program_url || target.config_path || "target config"
    })).join("") || empty("No targets match the current filter.");
  }

  function appCard(item) {
    return `<article class="app-card"><div class="app-card-top"><div class="app-icon">${esc(item.icon)}</div><span class="badge ${esc(item.status || "")}">${esc(item.status || "ready")}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p><div class="app-card-footer"><span>${esc(item.footer || "")}</span><span>→</span></div></article>`;
  }

  function renderRuns() {
    const rows = filteredRuns().slice(0, 8).map(runRow).join("");
    $("recentRunsRows").innerHTML = rows || rowEmpty(5, "No runs found.");
    $("allRunsRows").innerHTML = filteredRuns().map((run) => `<tr><td class="mono">#${esc(run.id)}</td><td>${statusBadge(run.status)}</td><td>${esc(run.active_phase || "-")}</td><td>${esc(run.mode || "-")}</td><td>${esc(run.provider_profile || "-")}</td><td>${esc(run.target_name || "-")}</td><td>${esc(formatDate(run.started_at || run.created_at))}</td><td>${esc(formatDate(run.finished_at))}</td></tr>`).join("") || rowEmpty(8, "No runs match the current filter.");
  }

  function runRow(run) {
    return `<tr><td class="mono">#${esc(run.id)}</td><td>${statusBadge(run.status)}</td><td>${esc(run.mode || run.run_type || "-")}</td><td>${esc(run.target_name || "-")}</td><td>${esc(formatDate(run.started_at || run.created_at))}</td></tr>`;
  }

  function renderMetrics() {
    const data = metricData();
    const values = [
      ["Domains", data.domains, "Authorized and discovered names"],
      ["Services", data.services, "HTTP probes and live apps"],
      ["URLs", data.urls, "Archived and observed URLs"],
      ["Tech", data.technologies, "Detected stack entries"],
      ["Screens", data.screenshots, "Visual triage artifacts"],
      ["Events", data.events, "Run timeline messages"]
    ];
    $("metricCards").innerHTML = values.slice(0, 6).map(([label, value, hint]) => `<div class="metric-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><em>${esc(hint)}</em></div>`).join("");
    $("chartTotal").textContent = values.reduce((sum, item) => sum + Number(item[1] || 0), 0);
    $("observationChart").innerHTML = bars(values);
    $("metricsWindowLabel").textContent = state.metricWindow === "run" ? "Selected run" : state.metricWindow === "target" ? "Selected target" : "All loaded data";
  }

  function metricData() {
    const runData = state.selectedRunData || emptyRunData();
    if (state.metricWindow === "run") return countsFromRunData(runData);
    if (state.metricWindow === "target") {
      const target = runData.run?.target_name;
      const runIds = new Set(state.runs.filter((run) => run.target_name === target).map((run) => String(run.id)));
      return countsFromRunCollection(runIds);
    }
    return countsFromRunCollection(new Set(state.runs.map((run) => String(run.id))));
  }

  function countsFromRunData(data) {
    const counts = data.counts || {};
    return {
      domains: counts.domains ?? data.domains.length,
      services: counts.httpServices ?? counts.services ?? data.services.length,
      urls: counts.urls ?? data.urls.length,
      technologies: counts.technologies ?? data.technologies.length,
      screenshots: counts.screenshots ?? data.screenshots.length,
      events: counts.events ?? data.events.length
    };
  }

  function countsFromRunCollection(runIds) {
    const selected = state.selectedRunData || emptyRunData();
    if (runIds.has(String(selected.run?.id))) return countsFromRunData(selected);
    return { domains: 0, services: 0, urls: 0, technologies: 0, screenshots: 0, events: 0 };
  }

  function renderLogs() {
    const data = state.selectedRunData || emptyRunData();
    const logs = data.events.slice(-12).reverse();
    const html = logs.map(logItem).join("") || empty("No events for the selected run.");
    $("liveLogs").innerHTML = html;
    $("eventsLogStream").innerHTML = html;
    $("toolResultsRows").innerHTML = data.tools.map((tool) => `<tr><td>${esc(tool.toolName || tool.tool_name || "-")}</td><td>${statusBadge(tool.status)}</td><td>${esc(tool.exitCode ?? tool.exit_code ?? "-")}</td><td>${esc(formatDate(tool.startedAt || tool.started_at))}</td></tr>`).join("") || rowEmpty(4, "No tool results for the selected run.");
  }

  function logItem(event) {
    return `<div class="log-item"><div class="log-time">${esc(shortTime(event.created_at || event.createdAt || event.time))}</div><div><strong>${esc(event.source || event.phase || "system")} · ${esc(event.severity || "info")}</strong><p>${esc(event.message || JSON.stringify(event))}</p></div></div>`;
  }

  function renderProviders() {
    const providerRows = filteredApiKeys().map((key) => `<tr><td>${esc(key.provider)}</td><td>${statusBadge(key.status)}</td><td>${esc(key.usage_count || 0)}${key.monthly_limit ? `/${esc(key.monthly_limit)}` : ""}</td><td><a class="text-button" href="/#settings">Manage</a></td></tr>`).join("") || rowEmpty(4, "No API keys configured.");
    $("providerRows").innerHTML = providerRows;
  }

  function renderAnalytics() {
    const data = state.selectedRunData || emptyRunData();
    const techValues = data.technologies.map((item) => [item.name || item.technology || "unknown", Number(item.count || item.serviceCount || 1)]).slice(0, 12);
    $("techBars").innerHTML = bars(techValues.length ? techValues : [["No technologies", 0]]);
    const statusCounts = count(data.services, (item) => item.statusCode || item.status_code || "none");
    $("statusBars").innerHTML = bars([...statusCounts.entries()].slice(0, 12));
    $("serviceSurfaceRows").innerHTML = data.services.slice(0, 30).map((service) => `<tr><td>${esc(service.url || service.baseUrl || "-")}</td><td>${esc(service.statusCode || service.status_code || "-")}</td><td>${esc(service.title || "-")}</td><td>${esc(arr(service.technologies).join(", ") || service.tech || "-")}</td></tr>`).join("") || rowEmpty(4, "No HTTP services for the selected run.");
  }

  function renderSettings() {
    $("settingsProviderRows").innerHTML = filteredApiKeys().map((key) => `<tr><td>${esc(key.provider)}</td><td>${esc(key.label || "-")}</td><td>${statusBadge(key.status)}</td><td>${esc(key.usage_count || 0)}${key.monthly_limit ? `/${esc(key.monthly_limit)}` : ""}</td><td>${esc(key.notes || "-")}</td></tr>`).join("") || rowEmpty(5, "No provider keys configured.");
    $("aiRuntimeCard").innerHTML = state.ai ? [
      runtimeRow("Provider", state.ai.provider || "opencode"),
      runtimeRow("Planning model", state.ai.planning_model || state.ai.planningModel || "default"),
      runtimeRow("Execution model", state.ai.execution_model || state.ai.executionModel || "default"),
      runtimeRow("Autonomy", `Level ${state.ai.autonomy_level ?? state.ai.autonomyLevel ?? 1}`)
    ].join("") : empty("AI runtime settings are not loaded.");
  }

  function runtimeRow(label, value) {
    return `<div class="runtime-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function bars(values) {
    const normalized = values.map((item) => Array.isArray(item) ? item : [item[0], item[1]]);
    const max = Math.max(1, ...normalized.map((item) => Number(item[1] || 0)));
    return normalized.map(([label, value]) => `<div class="bar-row"><span title="${esc(label)}">${esc(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Number(value || 0) / max * 100)}%"></div></div><span class="bar-value">${esc(value)}</span></div>`).join("");
  }

  function count(items, fn) {
    const map = new Map();
    for (const item of arr(items)) {
      const key = String(fn(item) || "unknown");
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }

  function filteredTargets() {
    return state.targets.filter((item) => searchable([item.target_name, item.name, item.program_url, arr(item.root_domains).join(" ")]));
  }

  function filteredRuns() {
    return state.runs.filter((item) => searchable([item.id, item.target_name, item.status, item.mode, item.run_type, item.active_phase, item.provider_profile]));
  }

  function filteredApiKeys() {
    return state.apiKeys.filter((item) => searchable([item.provider, item.label, item.status, item.notes]));
  }

  function searchable(values) {
    if (!state.search) return true;
    return values.some((value) => String(value || "").toLowerCase().includes(state.search));
  }

  function activeKeys() {
    return state.apiKeys.filter((key) => String(key.status || "").toLowerCase() === "active");
  }

  function statusBadge(status) {
    const value = String(status || "unknown");
    const cls = value === "completed" || value === "active" || value === "ok" ? "ok" : value === "running" || value === "queued" ? "running" : value === "failed" || value === "cancelled" ? "error" : "warn";
    return `<span class="badge ${cls}">${esc(value)}</span>`;
  }

  function empty(text) {
    return `<div class="empty">${esc(text)}</div>`;
  }

  function rowEmpty(cols, text) {
    return `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`;
  }

  function setBanner(message, type) {
    const banner = $("statusBanner");
    if (!banner) return;
    banner.classList.toggle("hidden", !message || type === "hidden");
    banner.textContent = message || "";
  }

  function formatDate(value) {
    if (!value) return "-";
    try { return new Date(value).toLocaleString(); } catch { return value; }
  }

  function shortTime(value) {
    if (!value) return "-";
    try { return new Date(value).toLocaleTimeString(); } catch { return String(value).slice(11, 19); }
  }

  function initials(value) {
    return String(value || "A").split(/[^a-z0-9]+/i).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A";
  }

  function emptyRunData() {
    return { run: null, counts: null, events: [], tools: [], domains: [], services: [], urls: [], technologies: [], screenshots: [] };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
