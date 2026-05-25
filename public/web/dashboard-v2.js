"use strict";

(function initAuraDashboardV2() {
  const passiveTools = ["crtsh", "wayback", "rapiddns", "rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx", "whoisxmlapi", "whoisfreaks"];
  const wslTools = ["subfinder", "amass", "dnsx", "puredns", "shuffleDns", "gau", "httpx"];
  const screenshotTools = ["gowitness", "aquatone", "eyewitness"];
  const apiTools = new Set(["rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx", "whoisxmlapi", "whoisfreaks"]);
  const labels = { crtsh: "crt.sh", wayback: "Wayback", rapiddns: "RapidDNS", rapid7: "Rapid7", certspotter: "CertSpotter", securitytrails: "SecurityTrails", shodan: "Shodan", virustotal: "VirusTotal", censys: "Censys", binaryedge: "BinaryEdge", urlscan: "urlscan", hunterio: "Hunter", passivetotal: "PassiveTotal", zoomeye: "ZoomEye", spyse: "Spyse", intelx: "IntelX", whoisxmlapi: "WhoisXML", whoisfreaks: "WhoisFreaks", subfinder: "subfinder", amass: "amass", dnsx: "dnsx", puredns: "puredns", shuffleDns: "shuffle-dns", gau: "gau", httpx: "httpx", gowitness: "gowitness", aquatone: "aquatone", eyewitness: "EyeWitness" };

  const state = { targets: [], runs: [], apiKeys: [], wordlists: [], ai: null, selectedRunId: "", selectedRunData: emptyRun(), metricWindow: "run", search: "" };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const arr = (value) => Array.isArray(value) ? value : [];

  function boot() {
    mountFeatureSections();
    bindEvents();
    refreshAll();
    setInterval(refreshAll, 15000);
  }

  function mountFeatureSections() {
    $("reconMount").innerHTML = reconHtml();
    $("resultsMount").innerHTML = resultsHtml();
    $("searchMount").innerHTML = searchHtml();
    $("wordlistsMount").innerHTML = wordlistsHtml();
    $("topologyMount").innerHTML = topologyHtml();
    $("settingsMount").innerHTML = settingsHtml();
  }

  function bindEvents() {
    document.addEventListener("click", async (event) => {
      const sectionButton = event.target.closest("[data-section], [data-section-jump]");
      if (sectionButton) {
        activateSection(sectionButton.dataset.section || sectionButton.dataset.sectionJump);
        return;
      }
      const metric = event.target.closest("[data-metric-window]");
      if (metric) {
        state.metricWindow = metric.dataset.metricWindow;
        document.querySelectorAll("[data-metric-window]").forEach((node) => node.classList.toggle("active", node === metric));
        renderMetrics();
        return;
      }
      const pane = event.target.closest("[data-result-pane]");
      if (pane) return activateResultPane(pane.dataset.resultPane);
      const exportButton = event.target.closest("[data-export]");
      if (exportButton) return exportRun(exportButton.dataset.export);
      const followup = event.target.closest("[data-followup]");
      if (followup) return followupRun(followup.dataset.followup);
      const wordlistDelete = event.target.closest("[data-wordlist-delete]");
      if (wordlistDelete) return deleteWordlist(wordlistDelete.dataset.wordlistDelete);
      const apiDelete = event.target.closest("[data-api-key-delete]");
      if (apiDelete) return deleteApiKey(apiDelete.dataset.apiKeyDelete);
      if (event.target.closest("#refreshDashboard")) return refreshAll();
      if (event.target.closest("#createTargetV2")) return createTarget();
      if (event.target.closest("#startReconV2")) return startRecon();
      if (event.target.closest("#runSearchV2")) return runSearch();
      if (event.target.closest("#saveWordlistV2")) return saveWordlist();
      if (event.target.closest("#generateWordlistV2")) return generateWordlist();
      if (event.target.closest("#checkEnvironmentV2")) return checkEnvironment();
      if (event.target.closest("#saveApiKeyV2")) return saveApiKey();
      if (event.target.closest("#testAllApiKeysV2")) return testAllApiKeys();
    });
    document.addEventListener("change", async (event) => {
      if (["runSelect", "logsRunSelect", "resultsRunSelect", "topologyRunSelect"].includes(event.target.id)) {
        state.selectedRunId = event.target.value;
        await loadRunData();
        renderAll();
      }
      if (["scanPresetV2"].includes(event.target.id)) renderToolCloud();
    });
    $("globalSearch")?.addEventListener("input", (event) => { state.search = String(event.target.value || "").trim().toLowerCase(); renderAll(); });
  }

  async function refreshAll() {
    try {
      setBanner("Loading live dashboard data...");
      const [targets, runs, apiKeys, wordlists, ai] = await Promise.all([
        api("/api/targets"),
        api("/api/recon-runs"),
        api("/api/api-keys"),
        api("/api/wordlists").catch(() => ({ wordlists: [] })),
        api("/api/ai-settings").catch(() => null)
      ]);
      state.targets = arr(targets.targets);
      state.runs = arr(runs.runs).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
      state.apiKeys = arr(apiKeys.apiKeys);
      state.wordlists = arr(wordlists.wordlists);
      state.ai = ai?.settings || null;
      if (!state.selectedRunId && state.runs[0]) state.selectedRunId = String(state.runs[0].id);
      await loadRunData();
      renderAll();
      setBanner("");
    } catch (error) {
      setBanner(`Dashboard failed: ${error.message}`, "error");
    }
  }

  async function loadRunData() {
    if (!state.selectedRunId) { state.selectedRunData = emptyRun(); return; }
    const id = encodeURIComponent(state.selectedRunId);
    const [run, counts, events, tools, domains, services, urls, tech, screens, delta] = await Promise.all([
      api(`/api/recon-runs/${id}`).catch(() => null),
      api(`/api/recon-runs/${id}/counts`).catch(() => null),
      api(`/api/recon-runs/${id}/events`).catch(() => null),
      api(`/api/recon-runs/${id}/tool-results`).catch(() => null),
      api(`/api/recon-runs/${id}/domains`).catch(() => null),
      api(`/api/recon-runs/${id}/http-services`).catch(() => null),
      api(`/api/recon-runs/${id}/urls`).catch(() => null),
      api(`/api/recon-runs/${id}/technologies`).catch(() => null),
      api(`/api/recon-runs/${id}/screenshots`).catch(() => null),
      api(`/api/recon-runs/${id}/delta`).catch(() => null)
    ]);
    state.selectedRunData = {
      run: run?.run || state.runs.find((item) => String(item.id) === String(state.selectedRunId)) || null,
      counts: counts?.counts || {},
      events: arr(events?.events),
      tools: arr(tools?.toolResults),
      domains: arr(domains?.domains),
      services: arr(services?.services),
      urls: arr(urls?.urls),
      tech: arr(tech?.technologies),
      screens: arr(screens?.screenshots),
      delta: delta?.delta || null
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (response.status === 401) { window.location.href = "/login.html"; throw new Error("Authentication required"); }
    if (!response.ok) throw new Error(data.error || data.errors?.join("; ") || response.statusText);
    return data;
  }

  function renderAll() {
    renderSelectors(); renderHero(); renderApplications(); renderRuns(); renderMetrics(); renderLogs(); renderProviders(); renderAnalytics(); renderSettings(); renderToolCloud(); renderResults(); renderWordlists(); renderTopology();
  }

  function renderSelectors() {
    const runOptions = state.runs.map((run) => `<option value="${esc(run.id)}">#${esc(run.id)} - ${esc(run.target_name || "target")} - ${esc(run.status || "unknown")}</option>`).join("");
    for (const id of ["runSelect", "logsRunSelect", "resultsRunSelect", "topologyRunSelect"]) if ($(id)) { $(id).innerHTML = runOptions || `<option value="">No runs</option>`; $(id).value = state.selectedRunId || ""; }
    const targetOptions = state.targets.map((target) => `<option value="${esc(target.target_name || target.name)}">${esc(target.target_name || target.name)}</option>`).join("");
    for (const id of ["scanTargetV2"]) if ($(id)) $(id).innerHTML = targetOptions || `<option value="">No targets</option>`;
    if ($("searchTargetV2")) $("searchTargetV2").innerHTML = `<option value="">All targets</option>${targetOptions}`;
  }

  function renderHero() {
    const run = state.selectedRunData.run;
    const activeRuns = state.runs.filter((run) => ["running", "queued", "paused"].includes(run.status)).length;
    $("overviewSubtitle").textContent = `${state.targets.length} target${state.targets.length === 1 ? "" : "s"}, ${state.runs.length} run${state.runs.length === 1 ? "" : "s"}, ${activeRuns} active. ${run ? `Viewing run #${run.id} for ${run.target_name}.` : "No run selected."}`;
    $("applicationsMeta").textContent = `${state.targets.length} targets - ${activeRuns} active runs - ${activeKeys().length} active providers`;
  }

  function renderApplications() {
    const modules = [
      { title: "Targets", icon: "T", detail: `${state.targets.length} saved applications`, status: state.targets.length ? "ok" : "warn", footer: "Scope configs", section: "targets" },
      { title: "Recon Runs", icon: "R", detail: `${state.runs.length} deployment records`, status: state.runs.some((run) => run.status === "running") ? "running" : "ok", footer: "Execution history", section: "runs" },
      { title: "Providers", icon: "P", detail: `${activeKeys().length}/${state.apiKeys.length} active keys`, status: activeKeys().length ? "ok" : "warn", footer: "API readiness", section: "settings" },
      { title: "Topology", icon: "G", detail: `${state.selectedRunData.domains.length} nodes candidate`, status: state.selectedRunId ? "ok" : "warn", footer: "Graph preview", section: "topology" }
    ];
    $("applicationCards").innerHTML = modules.map(appCard).join("");
    $("targetCards").innerHTML = filteredTargets().map((target) => appCard({ title: target.target_name || target.name, icon: initials(target.target_name || target.name), detail: `${arr(target.root_domains).length} root domains`, status: "ok", footer: target.program_url || target.config_path || "target config", section: "recon" })).join("") || empty("No targets match the current filter.");
  }

  function appCard(item) { return `<article class="app-card" data-section-jump="${esc(item.section || "overview")}"><div class="app-card-top"><div class="app-icon">${esc(item.icon)}</div><span class="badge ${esc(item.status || "")}">${esc(item.status || "ready")}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p><div class="app-card-footer"><span>${esc(item.footer || "")}</span><span>-&gt;</span></div></article>`; }

  function renderRuns() {
    $("recentRunsRows").innerHTML = filteredRuns().slice(0, 8).map((run) => `<tr><td class="mono">#${esc(run.id)}</td><td>${statusBadge(run.status)}</td><td>${esc(run.mode || run.run_type || "-")}</td><td>${esc(run.target_name || "-")}</td><td>${esc(formatDate(run.started_at || run.created_at))}</td></tr>`).join("") || rowEmpty(5, "No runs found.");
    $("allRunsRows").innerHTML = filteredRuns().map((run) => `<tr><td class="mono">#${esc(run.id)}</td><td>${statusBadge(run.status)}</td><td>${esc(run.active_phase || "-")}</td><td>${esc(run.mode || "-")}</td><td>${esc(run.provider_profile || "-")}</td><td>${esc(run.target_name || "-")}</td><td>${esc(formatDate(run.started_at || run.created_at))}</td><td>${esc(formatDate(run.finished_at))}</td></tr>`).join("") || rowEmpty(8, "No runs match the current filter.");
  }

  function renderMetrics() {
    const data = metricData();
    const values = [["Domains", data.domains, "Authorized and discovered names"], ["Services", data.services, "HTTP probes and live apps"], ["URLs", data.urls, "Archived and observed URLs"], ["Tech", data.technologies, "Detected stack entries"], ["Screens", data.screenshots, "Visual triage artifacts"], ["Events", data.events, "Run timeline messages"]];
    $("metricCards").innerHTML = values.map(([label, value, hint]) => `<div class="metric-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><em>${esc(hint)}</em></div>`).join("");
    $("chartTotal").textContent = values.reduce((sum, item) => sum + Number(item[1] || 0), 0);
    $("observationChart").innerHTML = bars(values);
    $("metricsWindowLabel").textContent = state.metricWindow === "run" ? "Selected run" : state.metricWindow === "target" ? "Selected target" : "Loaded aggregate";
  }

  function metricData() {
    const data = state.selectedRunData;
    const counts = data.counts || {};
    return { domains: counts.domains ?? data.domains.length, services: counts.httpServices ?? counts.services ?? data.services.length, urls: counts.urls ?? data.urls.length, technologies: counts.technologies ?? data.tech.length, screenshots: counts.screenshots ?? data.screens.length, events: counts.events ?? data.events.length };
  }

  function renderLogs() {
    const logs = state.selectedRunData.events.slice(-14).reverse();
    const html = logs.map((event) => `<div class="log-item"><div class="log-time">${esc(shortTime(event.created_at || event.createdAt || event.time))}</div><div><strong>${esc(event.source || event.phase || "system")} - ${esc(event.severity || "info")}</strong><p>${esc(event.message || JSON.stringify(event))}</p></div></div>`).join("") || empty("No events for the selected run.");
    $("liveLogs").innerHTML = html; $("eventsLogStream").innerHTML = html;
    $("toolResultsRows").innerHTML = state.selectedRunData.tools.map((tool) => `<tr><td>${esc(tool.toolName || tool.tool_name || "-")}</td><td>${statusBadge(tool.status)}</td><td>${esc(tool.exitCode ?? tool.exit_code ?? "-")}</td><td>${esc(formatDate(tool.startedAt || tool.started_at))}</td></tr>`).join("") || rowEmpty(4, "No tool results.");
  }

  function renderProviders() {
    $("providerRows").innerHTML = filteredApiKeys().map((key) => `<tr><td>${esc(key.provider)}</td><td>${statusBadge(key.status)}</td><td>${esc(key.used_count ?? key.usage_count ?? 0)}${key.monthly_limit ? `/${esc(key.monthly_limit)}` : ""}</td><td><button class="text-button" data-section-jump="settings">Manage</button></td></tr>`).join("") || rowEmpty(4, "No API keys configured.");
  }

  function renderAnalytics() {
    const data = state.selectedRunData;
    $("techBars").innerHTML = bars(data.tech.map((item) => [item.name || item.technology || "unknown", Number(item.count || item.serviceCount || 1)]).slice(0, 12));
    $("statusBars").innerHTML = bars([...count(data.services, (item) => item.statusCode || item.status_code || "none").entries()].slice(0, 12));
    $("serviceSurfaceRows").innerHTML = data.services.slice(0, 30).map((service) => `<tr><td>${esc(service.url || service.baseUrl || "-")}</td><td>${esc(service.statusCode || service.status_code || "-")}</td><td>${esc(service.title || "-")}</td><td>${esc(arr(service.technologies).join(", ") || service.tech || "-")}</td></tr>`).join("") || rowEmpty(4, "No HTTP services.");
  }

  function renderToolCloud() {
    const active = new Set(activeKeys().map((key) => String(key.provider).toLowerCase()));
    const selected = selectedPresetTools();
    const cloud = $("toolCloudV2");
    if (!cloud) return;
    cloud.innerHTML = [...passiveTools, ...wslTools, ...screenshotTools].map((id) => { const missing = apiTools.has(id) && !active.has(id); return `<label class="tool-pill ${missing ? "missing" : ""}" title="${missing ? "Requires active API key" : ""}"><input data-tool="${esc(id)}" type="checkbox" ${selected.has(id) && !missing ? "checked" : ""} ${missing ? "disabled" : ""}> ${esc(labels[id] || id)}</label>`; }).join("");
  }

  function renderResults() {
    const data = state.selectedRunData;
    table("resultsDomainsV2", ["Domain", "Kind", "Source"], data.domains.map((x) => [x.domain, x.kind, x.source]));
    table("resultsServicesV2", ["URL", "Status", "Title", "Tech"], data.services.map((x) => [x.url || x.baseUrl, x.statusCode || x.status_code, x.title, arr(x.technologies).join(", ") || x.tech]));
    table("resultsUrlsV2", ["URL", "Host", "Path", "Source"], data.urls.map((x) => [x.url, x.host, x.path, x.source]));
    table("resultsTechV2", ["Technology", "Services", "Hosts"], data.tech.map((x) => [x.name || x.technology, x.count || x.serviceCount, x.hostCount || "-"]));
    table("resultsScreensV2", ["Tool", "Screens", "Report"], data.screens.map((x) => [x.tool_name || x.toolName, x.metadata?.screenshotCount ?? "-", x.report_path || x.reportPath || x.output_path || "-"]));
    table("resultsToolsV2", ["Tool", "Status", "Exit", "Started"], data.tools.map((x) => [x.toolName || x.tool_name, x.status, x.exitCode ?? x.exit_code, x.startedAt || x.started_at]));
  }

  function renderWordlists() {
    const rows = state.wordlists.map((w) => `<tr><td>${esc(w.name)}</td><td>${esc(w.category)}</td><td>${statusBadge(w.status)}</td><td class="mono">${esc(w.path)}</td><td><a class="text-button" href="/api/wordlists/${esc(w.id)}/download">Download</a> <button class="text-button" data-wordlist-delete="${esc(w.id)}">Delete</button></td></tr>`).join("") || rowEmpty(5, "No wordlists configured.");
    if ($("wordlistRowsV2")) $("wordlistRowsV2").innerHTML = rows;
  }

  function renderTopology() {
    const map = $("topologyMapV2"); if (!map) return;
    const data = state.selectedRunData;
    const nodes = [];
    data.domains.slice(0, 10).forEach((x, i) => nodes.push(node(x.domain, "domain", i, 34)));
    data.services.slice(0, 10).forEach((x, i) => nodes.push(node(x.host || safeHost(x.url) || "service", "service", i, 24)));
    data.tech.slice(0, 8).forEach((x, i) => nodes.push(node(x.name || x.technology || "tech", "tech", i, 12)));
    map.innerHTML = nodes.join("") || empty("No topology data for selected run.");
  }

  function renderSettings() {
    const providerRows = filteredApiKeys().map((key) => `<tr><td>${esc(key.provider)}</td><td>${esc(key.label || "-")}</td><td>${statusBadge(key.status)}</td><td>${esc(key.used_count ?? key.usage_count ?? 0)}${key.monthly_limit ? `/${esc(key.monthly_limit)}` : ""}</td><td><button class="text-button" data-api-key-delete="${esc(key.id)}">Delete</button></td></tr>`).join("") || rowEmpty(5, "No provider keys configured.");
    if ($("settingsProviderRows")) $("settingsProviderRows").innerHTML = providerRows;
    if ($("settingsProviderRowsV2")) $("settingsProviderRowsV2").innerHTML = providerRows;
    $("aiRuntimeCard").innerHTML = state.ai ? [runtimeRow("Provider", state.ai.provider || "opencode"), runtimeRow("Planning model", state.ai.planningModel || state.ai.planning_model || "default"), runtimeRow("Execution model", state.ai.executionModel || state.ai.execution_model || "default"), runtimeRow("Autonomy", `Level ${state.ai.autonomyLevel ?? state.ai.autonomy_level ?? 1}`)].join("") : empty("AI runtime settings are not loaded.");
  }

  async function createTarget() {
    const set = status("targetStatusV2");
    try {
      const data = await api("/api/targets", { method: "POST", body: JSON.stringify({ targetName: $("targetNameV2").value.trim(), programUrl: $("programUrlV2").value.trim(), inScope: lines("inScopeV2"), outOfScope: lines("outScopeV2"), authorized: $("authorizedV2")?.checked || false, wslDistro: $("distroV2")?.value || "kali-linux", timeoutMs: Number($("timeoutV2")?.value || 180000) }) });
      set(`Target created: ${data.target?.target_name || "saved"}`, "ok"); await refreshAll();
    } catch (error) { set(error.message, "error"); }
  }

  async function startRecon() {
    const set = status("scanStatusV2");
    try {
      const selected = [...document.querySelectorAll("[data-tool]:checked")].map((node) => node.dataset.tool);
      const preset = $("scanPresetV2").value;
      const body = { targetName: $("scanTargetV2").value, reconMode: preset === "full" ? "full" : $("inputModeV2").value, rootDomains: $("seedsV2").value.split(/\s+/).filter(Boolean), passiveSources: selected.filter((x) => passiveTools.includes(x)), wslTools: selected.filter((x) => wslTools.includes(x)).map((x) => x === "shuffleDns" ? "shuffle-dns" : x), screenshotTools: selected.filter((x) => screenshotTools.includes(x)), useWsl: selected.some((x) => wslTools.includes(x)), wslDistro: $("distroV2").value || "kali-linux", timeoutMs: Number($("timeoutV2").value || 180000), authorized: $("authorizedV2").checked, intelPreflight: true };
      const data = await api("/api/recon-runs", { method: "POST", body: JSON.stringify(body) });
      state.selectedRunId = String(data.run.id); set(`Run #${data.run.id} queued.`, "ok"); await refreshAll(); activateSection("runs");
    } catch (error) { set(error.message, "error"); }
  }

  async function runSearch() {
    const set = status("searchStatusV2");
    try {
      const params = new URLSearchParams({ q: $("searchQueryV2").value.trim(), limit: "300" });
      if ($("searchTargetV2").value) params.set("target", $("searchTargetV2").value);
      const data = await api(`/api/search?${params.toString()}`);
      $("searchRowsV2").innerHTML = arr(data.results).map((r) => `<tr><td>${esc(r.result_type || r.type)}</td><td>${esc(r.target_name || r.targetName || "-")}</td><td>${esc(r.value)}</td><td>${esc(r.detail || "-")}</td><td>${esc(r.source || "-")}</td></tr>`).join("") || rowEmpty(5, "No results.");
      set(`${arr(data.results).length} results.`, "ok");
    } catch (error) { set(error.message, "error"); }
  }

  async function saveWordlist() {
    const set = status("wordlistStatusV2");
    try { await api("/api/wordlists", { method: "POST", body: JSON.stringify({ name: $("wordlistNameV2").value.trim(), category: $("wordlistCategoryV2").value, path: $("wordlistPathV2").value.trim(), notes: $("wordlistNotesV2").value.trim(), status: "active" }) }); set("Wordlist saved.", "ok"); await refreshAll(); } catch (error) { set(error.message, "error"); }
  }

  async function generateWordlist() {
    const set = status("wordlistStatusV2");
    try { const data = await api("/api/wordlists/generate", { method: "POST", body: JSON.stringify({ name: $("wordlistNameV2").value.trim(), category: $("wordlistCategoryV2").value, targetName: $("scanTargetV2")?.value || null }) }); set(`Generated ${data.generated?.count ?? "wordlist"}.`, "ok"); await refreshAll(); } catch (error) { set(error.message, "error"); }
  }

  async function deleteWordlist(id) { if (!confirm("Delete this wordlist?")) return; await api(`/api/wordlists/${encodeURIComponent(id)}`, { method: "DELETE" }); await refreshAll(); }
  async function deleteApiKey(id) { if (!confirm("Delete this API key?")) return; await api(`/api/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }); await refreshAll(); }
  async function saveApiKey() { const set = status("apiKeyStatusV2"); try { await api("/api/api-keys", { method: "POST", body: JSON.stringify({ provider: $("apiProviderV2").value.trim(), label: $("apiLabelV2").value.trim(), apiKey: $("apiValueV2").value.trim(), monthlyLimit: $("apiLimitV2").value ? Number($("apiLimitV2").value) : null }) }); $("apiValueV2").value = ""; set("API key saved.", "ok"); await refreshAll(); } catch (error) { set(error.message, "error"); } }
  async function testAllApiKeys() { const set = status("apiKeyStatusV2"); try { const data = await api("/api/api-keys/preflight-all", { method: "POST" }); set(`Preflight complete: ${arr(data.results).length} providers checked.`, "ok"); await refreshAll(); } catch (error) { set(error.message, "error"); } }
  async function checkEnvironment() { const set = status("environmentStatusV2"); try { const data = await api(`/api/environment/check?distro=${encodeURIComponent($("environmentDistroV2").value || "kali-linux")}`); const env = data.environment || {}; set(env.environmentAvailable ? `${env.mode} environment detected: ${env.distroName || env.distro}` : `${env.mode || "local"} environment unavailable: ${env.distro || "unknown"}`, env.environmentAvailable ? "ok" : "warn"); } catch (error) { set(error.message, "error"); } }

  function exportRun(format) { if (!state.selectedRunId) return; window.location.href = `/api/recon-runs/${encodeURIComponent(state.selectedRunId)}/export?format=${encodeURIComponent(format)}`; }
  async function followupRun(type) { const set = status("exportStatusV2"); try { const data = await api(`/api/recon-runs/${encodeURIComponent(state.selectedRunId)}/follow-up/${encodeURIComponent(type)}`, { method: "POST", body: JSON.stringify({ useWsl: true, wslDistro: "kali-linux", timeoutMs: 180000 }) }); set(`Follow-up run #${data.run?.id} queued.`, "ok"); state.selectedRunId = String(data.run?.id || state.selectedRunId); await refreshAll(); } catch (error) { set(error.message, "error"); } }

  function reconHtml() { return `<div class="operator-grid"><section class="panel"><div class="panel-head"><div><h2>Create Target</h2><p>Save scope before launching recon.</p></div></div><div class="form-grid"><div class="field-grid"><div class="field"><label>Target name</label><input id="targetNameV2" placeholder="acme"></div><div class="field"><label>Program URL</label><input id="programUrlV2" placeholder="https://example.com/security"></div></div><div class="field"><label>In-scope domains / URLs</label><textarea id="inScopeV2" placeholder="example.com\n*.example.com"></textarea></div><div class="field"><label>Out of scope</label><textarea id="outScopeV2" placeholder="dev.example.com"></textarea></div><div class="action-row"><button id="createTargetV2" class="primary-action" type="button">Create Target</button></div><div id="targetStatusV2" class="status-note">Ready.</div></div></section><section class="panel"><div class="panel-head"><div><h2>Start Scan</h2><p>Presets select tools and skip providers without active keys.</p></div></div><div class="form-grid"><div class="field"><label>Target</label><select id="scanTargetV2"></select></div><div class="field-grid"><div class="field"><label>Input mode</label><select id="inputModeV2"><option value="single">Single domain</option><option value="list">Domain list</option></select></div><div class="field"><label>Scan preset</label><select id="scanPresetV2"><option value="rapid">Rapid</option><option value="normal" selected>Normal</option><option value="full">Full</option></select></div></div><div class="field"><label>Authorized seed domains</label><textarea id="seedsV2" placeholder="example.com"></textarea></div><label class="tool-pill"><input id="authorizedV2" type="checkbox"> Authorized scope confirmed</label><div class="field-grid"><div class="field"><label>WSL distro</label><input id="distroV2" value="kali-linux"></div><div class="field"><label>Timeout ms</label><input id="timeoutV2" type="number" value="180000"></div></div><div id="toolCloudV2" class="tool-cloud"></div><button id="startReconV2" class="primary-action" type="button">Start Recon</button><div id="scanStatusV2" class="status-note">Choose a target and confirm authorization.</div></div></section></div>`; }
  function resultsHtml() { return `<section class="panel"><div class="mini-tabs"><button class="mini-tab active" data-result-pane="domains">Domains</button><button class="mini-tab" data-result-pane="services">Services</button><button class="mini-tab" data-result-pane="urls">URLs</button><button class="mini-tab" data-result-pane="tech">Tech</button><button class="mini-tab" data-result-pane="screens">Screenshots</button><button class="mini-tab" data-result-pane="tools">Tool Logs</button><button class="mini-tab" data-result-pane="export">Export</button></div><div id="resultsDomainsV2" class="result-pane active table-wrap"></div><div id="resultsServicesV2" class="result-pane table-wrap"></div><div id="resultsUrlsV2" class="result-pane table-wrap"></div><div id="resultsTechV2" class="result-pane table-wrap"></div><div id="resultsScreensV2" class="result-pane table-wrap"></div><div id="resultsToolsV2" class="result-pane table-wrap"></div><div id="resultsExportV2" class="result-pane"><div class="action-row"><button data-export="json" class="ghost-button">Export JSON</button><button data-export="csv" class="ghost-button">Export CSV</button><button data-export="markdown" class="ghost-button">Export Markdown</button><button data-followup="http" class="primary-action">HTTP/Tech Follow-up</button><button data-followup="urls" class="ghost-button">URL/Params</button><button data-followup="screenshots" class="ghost-button">Screenshots</button></div><div id="exportStatusV2" class="status-note">Exports and follow-ups use the selected run.</div></div></section>`; }
  function searchHtml() { return `<div class="operator-grid"><section class="panel"><div class="form-grid"><div class="field"><label>Query</label><input id="searchQueryV2" placeholder="citrix, jquery, /admin, cve"></div><div class="field"><label>Target filter</label><select id="searchTargetV2"></select></div><button id="runSearchV2" class="primary-action" type="button">Search</button><div id="searchStatusV2" class="status-note">Search checks saved data.</div></div></section><section class="panel"><div class="table-wrap"><table><thead><tr><th>Type</th><th>Target</th><th>Value</th><th>Detail</th><th>Source</th></tr></thead><tbody id="searchRowsV2"></tbody></table></div></section></div>`; }
  function wordlistsHtml() { return `<div class="operator-grid"><section class="panel"><div class="form-grid"><div class="field-grid"><div class="field"><label>Name</label><input id="wordlistNameV2"></div><div class="field"><label>Category</label><select id="wordlistCategoryV2"><option value="domains">domains</option><option value="technologies">technologies</option><option value="payloads">payloads</option><option value="paths">paths</option><option value="params">params</option></select></div></div><div class="field"><label>Path</label><input id="wordlistPathV2" placeholder="/usr/share/seclists/.../common.txt"></div><div class="field"><label>Notes</label><input id="wordlistNotesV2"></div><div class="action-row"><button id="saveWordlistV2" class="primary-action">Save Wordlist</button><button id="generateWordlistV2" class="ghost-button">Generate From Results</button></div><div id="wordlistStatusV2" class="status-note">Manage active local wordlists.</div></div></section><section class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Path</th><th>Actions</th></tr></thead><tbody id="wordlistRowsV2"></tbody></table></div></section></div>`; }
  function topologyHtml() { return `<section class="panel"><div class="panel-head"><div><h2>Graph Preview</h2><p>Interactive full topology remains in the classic UI.</p></div><a href="/#topology" class="text-button">Open Classic Topology</a></div><div id="topologyMapV2" class="topology-map"></div></section>`; }
  function settingsHtml() { return `<div class="two-column-layout"><section class="panel"><div class="panel-head"><div><h2>API Providers</h2><p>Save, test, and delete local API keys.</p></div></div><div class="provider-form"><div class="field"><label>Provider</label><input id="apiProviderV2" placeholder="shodan"></div><div class="field"><label>Label</label><input id="apiLabelV2" placeholder="free-api"></div><div class="field"><label>Monthly limit</label><input id="apiLimitV2" type="number"></div><div class="field wide"><label>API key</label><input id="apiValueV2" placeholder="provider key"></div></div><div class="action-row"><button id="saveApiKeyV2" class="primary-action">Save API Key</button><button id="testAllApiKeysV2" class="ghost-button">Test All</button></div><div id="apiKeyStatusV2" class="status-note">Provider keys are stored locally.</div><div class="table-wrap"><table><thead><tr><th>Provider</th><th>Label</th><th>Status</th><th>Usage</th><th>Actions</th></tr></thead><tbody id="settingsProviderRowsV2"></tbody></table></div></section><section class="panel"><div class="panel-head"><div><h2>Environment</h2><p>Check WSL/Kali and local tool readiness.</p></div></div><div class="field"><label>WSL distro</label><input id="environmentDistroV2" value="kali-linux"></div><button id="checkEnvironmentV2" class="primary-action">Check Environment</button><div id="environmentStatusV2" class="status-note">Environment has not been checked.</div><h2>AI Runtime</h2><div id="aiRuntimeCard" class="runtime-card"></div></section></div>`; }

  function activateSection(section) { document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.section === section)); document.querySelectorAll(".dashboard-section").forEach((node) => node.classList.toggle("active", node.id === `section-${section}`)); }
  function activateResultPane(name) { document.querySelectorAll("[data-result-pane]").forEach((node) => node.classList.toggle("active", node.dataset.resultPane === name)); document.querySelectorAll(".result-pane").forEach((node) => node.classList.toggle("active", node.id === `results${cap(name)}V2`)); }
  function selectedPresetTools() { const preset = $("scanPresetV2")?.value || "normal"; if (preset === "rapid") return new Set(["crtsh", "wayback", "rapiddns", "subfinder", "dnsx", "httpx"]); if (preset === "full") return new Set([...passiveTools, ...wslTools, ...screenshotTools]); return new Set(["crtsh", "wayback", "rapiddns", "certspotter", "securitytrails", "shodan", "virustotal", "urlscan", "subfinder", "dnsx", "gau", "httpx", "gowitness"]); }
  function filteredTargets() { return state.targets.filter((item) => searchable([item.target_name, item.name, item.program_url, arr(item.root_domains).join(" ")])); }
  function filteredRuns() { return state.runs.filter((item) => searchable([item.id, item.target_name, item.status, item.mode, item.run_type, item.active_phase, item.provider_profile])); }
  function filteredApiKeys() { return state.apiKeys.filter((item) => searchable([item.provider, item.label, item.status, item.notes])); }
  function searchable(values) { if (!state.search) return true; return values.some((value) => String(value || "").toLowerCase().includes(state.search)); }
  function activeKeys() { return state.apiKeys.filter((key) => String(key.status || "").toLowerCase() === "active"); }
  function table(id, heads, rows) { const el = $(id); if (!el) return; el.innerHTML = `<table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell ?? "-")}</td>`).join("")}</tr>`).join("") : rowEmpty(heads.length, "No data.")}</tbody></table>`; }
  function bars(values) { const items = values.length ? values : [["No data", 0]]; const max = Math.max(1, ...items.map((item) => Number(item[1] || 0))); return items.map(([label, value]) => `<div class="bar-row"><span title="${esc(label)}">${esc(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Number(value || 0) / max * 100)}%"></div></div><span class="bar-value">${esc(value)}</span></div>`).join(""); }
  function count(items, fn) { const map = new Map(); for (const item of arr(items)) { const key = String(fn(item) || "unknown"); map.set(key, (map.get(key) || 0) + 1); } return map; }
  function node(label, kind, i, radius) { const total = 14; const x = 50 + Math.cos(i / total * Math.PI * 2 + radius / 10) * radius; const y = 50 + Math.sin(i / total * Math.PI * 2 + radius / 10) * radius; return `<div class="topology-node ${kind}" style="left:${x}%;top:${y}%" title="${esc(label)}">${esc(short(label, 18))}</div>`; }
  function runtimeRow(label, value) { return `<div class="runtime-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function status(id) { return (message, cls = "") => { const node = $(id); if (!node) return; node.textContent = message; node.className = `status-note ${cls}`; }; }
  function setBanner(message, cls = "") { const node = $("statusBanner"); if (!node) return; node.className = message ? `status-banner ${cls}` : "status-banner hidden"; node.textContent = message || ""; }
  function statusBadge(status) { const value = String(status || "unknown"); const cls = ["completed", "active", "ok"].includes(value) ? "ok" : ["running", "queued"].includes(value) ? "running" : ["failed", "cancelled"].includes(value) ? "error" : "warn"; return `<span class="badge ${cls}">${esc(value)}</span>`; }
  function empty(text) { return `<div class="empty">${esc(text)}</div>`; }
  function rowEmpty(cols, text) { return `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`; }
  function lines(id) { return ($(id)?.value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
  function formatDate(value) { if (!value) return "-"; try { return new Date(value).toLocaleString(); } catch { return value; } }
  function shortTime(value) { if (!value) return "-"; try { return new Date(value).toLocaleTimeString(); } catch { return String(value).slice(11, 19); } }
  function initials(value) { return String(value || "A").split(/[^a-z0-9]+/i).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A"; }
  function safeHost(value) { try { return new URL(value).host; } catch { return ""; } }
  function short(value, length) { const text = String(value || ""); return text.length > length ? `${text.slice(0, length - 3)}...` : text; }
  function cap(value) { return String(value).charAt(0).toUpperCase() + String(value).slice(1); }
  function emptyRun() { return { run: null, counts: {}, events: [], tools: [], domains: [], services: [], urls: [], tech: [], screens: [], delta: null }; }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
