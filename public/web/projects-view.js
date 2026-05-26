"use strict";

(function initAuraProjectsView() {
  const $ = (id) => document.getElementById(id);
  const state = {
    targets: [],
    runs: [],
    selectedTarget: null,
    selectedRunId: null,
    snapshot: emptySnapshot(),
    activeView: "all",
    selectedItem: null,
    modalRows: [],
    modalIndex: -1,
    filter: { query: "", type: "all", onlyLive: false }
  };

  injectStylesheet("/projects-view.css", "aura-projects-view-css");

  function bind() {
    injectTab();
    injectPanel();
    bindEvents();
    refresh().catch(showError);
  }

  function injectTab() {
    const nav = document.querySelector(".tabs");
    if (!nav || document.querySelector('[data-tab="projects"]')) return;
    const button = document.createElement("button");
    button.className = "tab";
    button.dataset.tab = "projects";
    button.title = "Projects";
    button.innerHTML = `<span class="tab-icon" data-icon="projects"></span><span class="tab-label">Projects</span>`;
    const results = nav.querySelector('[data-tab="results"]');
    nav.insertBefore(button, results || nav.firstChild);
  }

  function injectPanel() {
    const workspace = document.querySelector(".workspace-main");
    if (!workspace || $("tab-projects")) return;
    const section = document.createElement("section");
    section.id = "tab-projects";
    section.className = "tab-panel";
    section.innerHTML = `
      <div class="projects-shell">
        <aside class="pane projects-sidebar">
          <h2>Projects</h2>
          <div class="projects-toolbar">
            <input id="projectsSearch" type="search" placeholder="Search project, scope, run">
            <button id="projectsRefresh" type="button">Refresh Projects</button>
          </div>
          <div id="projectsList" class="project-list"><div class="notice muted">Loading projects...</div></div>
        </aside>
        <section class="projects-main">
          <div class="pane">
            <div class="topology-head">
              <div>
                <h2 id="projectsTitle">Project Intelligence</h2>
                <p id="projectsSubtitle" class="muted">Select a project to see every collected observation in one searchable workspace.</p>
              </div>
            </div>
            <div class="projects-runbar">
              <select id="projectsRunSelect"></select>
              <input id="projectsDataSearch" type="search" placeholder="Filter all collected data">
              <select id="projectsTypeFilter">
                <option value="all">All data</option>
                <option value="domain">Domains</option>
                <option value="service">HTTP services</option>
                <option value="technology">Technologies</option>
                <option value="url">URLs</option>
                <option value="screenshot">Screenshots</option>
                <option value="lead">Leads</option>
                <option value="event">Events</option>
              </select>
              <button id="projectsOnlyLive" type="button">Live only</button>
              <button id="projectsExportJson" type="button">Export JSON</button>
              <button id="projectsExportCsv" type="button">Export CSV</button>
            </div>
            <div class="projects-summary" id="projectsSummary"></div>
            <div class="projects-ai-bar">
              <input id="projectsAiPrompt" type="text" placeholder="Ask AI: show live services with screenshots, export all Citrix hosts, find interesting tech...">
              <button id="projectsAskAi" type="button">Ask AI</button>
              <button id="projectsApplyAi" type="button">Apply AI Filter</button>
            </div>
            <div id="projectsAiAnswer" class="notice muted compact-notice">AI can summarize this project, suggest filters, or extract requested data from the loaded snapshot.</div>
          </div>
          <div class="pane">
            <div class="projects-subtabs" id="projectsSubtabs">
              ${["all", "domain", "service", "technology", "url", "screenshot", "lead", "event"].map((type) => `<button type="button" data-project-view="${type}">${labelForType(type)}</button>`).join("")}
            </div>
            <div class="projects-grid">
              <div class="projects-table-wrap">
                <table class="projects-table">
                  <thead id="projectsTableHead"></thead>
                  <tbody id="projectsTableRows"><tr><td class="muted">Select a project.</td></tr></tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    `;
    workspace.insertBefore(section, workspace.querySelector("#tab-results") || workspace.firstChild);
  }

  function bindEvents() {
    document.querySelector('[data-tab="projects"]')?.addEventListener("click", () => activateProjectsTab());
    $("projectsRefresh")?.addEventListener("click", () => refresh().catch(showError));
    $("projectsSearch")?.addEventListener("input", renderProjectsList);
    $("projectsRunSelect")?.addEventListener("change", () => loadSelectedRun(Number($("projectsRunSelect").value)).catch(showError));
    $("projectsDataSearch")?.addEventListener("input", () => { state.filter.query = $("projectsDataSearch").value; renderData(); });
    $("projectsTypeFilter")?.addEventListener("change", () => { setView($("projectsTypeFilter").value); });
    $("projectsOnlyLive")?.addEventListener("click", () => { state.filter.onlyLive = !state.filter.onlyLive; $("projectsOnlyLive").classList.toggle("active", state.filter.onlyLive); renderData(); });
    $("projectsExportJson")?.addEventListener("click", () => exportFiltered("json"));
    $("projectsExportCsv")?.addEventListener("click", () => exportFiltered("csv"));
    $("projectsAskAi")?.addEventListener("click", askAi);
    $("projectsApplyAi")?.addEventListener("click", applyAiFilter);
    $("projectsSubtabs")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-project-view]");
      if (button) setView(button.dataset.projectView);
    });
  }

  function activateProjectsTab() {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "projects"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "tab-projects"));
    refresh().catch(showError);
  }

  async function refresh() {
    const [targetsResult, runsResult] = await Promise.all([api("/api/targets"), api("/api/recon-runs")]);
    state.targets = targetsResult.targets || [];
    state.runs = runsResult.runs || [];
    if (!state.selectedTarget && state.targets.length) state.selectedTarget = state.targets[0].target_name;
    renderProjectsList();
    if (state.selectedTarget) await selectProject(state.selectedTarget);
  }

  async function selectProject(targetName) {
    state.selectedTarget = targetName;
    state.selectedItem = null;
    closeProjectInspector();
    const runs = runsForTarget(targetName);
    state.selectedRunId = runs[0]?.id || null;
    renderProjectsList();
    renderRunSelect();
    if (state.selectedRunId) await loadSelectedRun(state.selectedRunId);
    else {
      state.snapshot = emptySnapshot();
      renderData();
    }
  }

  async function loadSelectedRun(runId) {
    state.selectedRunId = runId || null;
    state.selectedItem = null;
    closeProjectInspector();
    if (!runId) {
      state.snapshot = emptySnapshot();
      renderData();
      return;
    }
    const [run, counts, domains, services, technologies, urls, screenshots, leads, events, tools, delta] = await Promise.all([
      api(`/api/recon-runs/${runId}`),
      api(`/api/recon-runs/${runId}/counts`),
      api(`/api/recon-runs/${runId}/domains`),
      api(`/api/recon-runs/${runId}/http-services`),
      api(`/api/recon-runs/${runId}/technologies`),
      api(`/api/recon-runs/${runId}/urls`),
      api(`/api/recon-runs/${runId}/screenshots`),
      state.selectedTarget ? api(`/api/targets/${encodeURIComponent(state.selectedTarget)}/asset-leads`) : Promise.resolve({ leads: [] }),
      api(`/api/recon-runs/${runId}/events`),
      api(`/api/recon-runs/${runId}/tool-results`),
      api(`/api/recon-runs/${runId}/delta`)
    ]);
    state.snapshot = {
      run: run.run,
      counts: counts.counts || {},
      domains: domains.domains || [],
      services: services.services || [],
      technologies: technologies.technologies || [],
      urls: urls.urls || [],
      screenshots: screenshots.screenshots || [],
      leads: (leads.leads || []).filter((lead) => !lead.run_id || lead.run_id === runId),
      events: events.events || [],
      tools: tools.toolResults || [],
      delta: delta.delta || null
    };
    renderRunSelect();
    renderData();
  }

  function renderProjectsList() {
    const query = String($("projectsSearch")?.value || "").toLowerCase();
    const rows = state.targets.filter((target) => matchesText(projectSearchText(target), query));
    $("projectsList").innerHTML = rows.length ? rows.map((target) => {
      const runs = runsForTarget(target.target_name);
      const latest = runs[0];
      return `<div class="project-card ${state.selectedTarget === target.target_name ? "active" : ""}" data-project="${esc(target.target_name)}">
        <strong>${esc(target.target_name)}</strong>
        <span>${esc((target.root_domains || []).join(", ") || target.program_url || "No roots")}</span>
        <span>${runs.length} runs${latest ? ` · latest ${esc(latest.status)} · #${esc(latest.id)}` : ""}</span>
      </div>`;
    }).join("") : `<div class="notice muted">No projects match this filter.</div>`;
    document.querySelectorAll(".project-card").forEach((card) => card.addEventListener("click", () => selectProject(card.dataset.project).catch(showError)));
  }

  function renderRunSelect() {
    const runs = runsForTarget(state.selectedTarget);
    $("projectsRunSelect").innerHTML = runs.length ? runs.map((run) => `<option value="${esc(run.id)}">#${esc(run.id)} · ${esc(run.status)} · ${esc(run.run_type || run.mode || "run")} · ${esc(run.started_at || "")}</option>`).join("") : `<option value="">No runs</option>`;
    if (state.selectedRunId) $("projectsRunSelect").value = String(state.selectedRunId);
  }

  function renderData() {
    const target = state.targets.find((item) => item.target_name === state.selectedTarget);
    $("projectsTitle").textContent = state.selectedTarget ? `Project: ${state.selectedTarget}` : "Project Intelligence";
    $("projectsSubtitle").textContent = target ? `${target.program_url || "No program URL"} · ${(target.root_domains || []).join(", ") || "No roots"}` : "Select a project to inspect collected data.";
    renderSummary();
    renderSubtabs();
    const rows = filteredRows();
    renderTable(rows);
  }

  function renderSummary() {
    const s = state.snapshot;
    const metrics = [
      ["Runs", runsForTarget(state.selectedTarget).length],
      ["Domains", s.domains.length],
      ["Live", s.services.length],
      ["Tech", s.technologies.length],
      ["URLs", s.urls.length],
      ["Screens", screenshotCount(s.screenshots)],
      ["Leads", s.leads.length],
      ["Events", s.events.length]
    ];
    $("projectsSummary").innerHTML = metrics.map(([label, value]) => `<div class="projects-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");
  }

  function renderSubtabs() {
    document.querySelectorAll("[data-project-view]").forEach((button) => button.classList.toggle("active", button.dataset.projectView === state.activeView));
    if ($("projectsTypeFilter")) $("projectsTypeFilter").value = state.activeView;
  }

  function renderTable(rows) {
    state.modalRows = rows;
    $("projectsTableHead").innerHTML = `<tr><th>Type</th><th>Value</th><th>Detail</th><th>Source</th><th>Seen</th></tr>`;
    $("projectsTableRows").innerHTML = rows.length ? rows.map((row, index) => `<tr data-project-row="${index}" title="Open row inspector"><td><span class="projects-pill">${esc(row.type)}</span></td><td class="projects-value-cell">${esc(row.value)}</td><td class="projects-detail-cell">${row.detailHtml || esc(row.detail || "")}</td><td class="projects-source-cell">${esc(row.source || "")}</td><td class="projects-seen-cell">${esc(row.seen || "")}</td></tr>`).join("") : `<tr><td colspan="5" class="muted">No data matches the current filters.</td></tr>`;
    document.querySelectorAll("[data-project-row]").forEach((tr) => tr.addEventListener("click", (event) => {
      if (event.target.closest(".screenshot-thumb, a, button")) return;
      openProjectInspector(rows, Number(tr.dataset.projectRow));
    }));
  }

  function ensureProjectInspectorModal() {
    let modal = $("projectInspectorModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "projectInspectorModal";
    modal.className = "image-modal project-inspector-modal hidden";
    modal.innerHTML = `
      <div class="project-inspector-dialog" role="dialog" aria-modal="true" aria-labelledby="projectInspectorTitle">
        <button class="image-modal-close project-inspector-close" type="button" aria-label="Close project inspector">&times;</button>
        <button class="image-modal-nav image-modal-prev project-inspector-prev" type="button" aria-label="Previous row">&#8249;</button>
        <section class="project-inspector-card">
          <div class="project-inspector-head">
            <div>
              <span id="projectInspectorType" class="projects-pill">row</span>
              <h2 id="projectInspectorTitle">Project row</h2>
              <p id="projectInspectorMeta" class="muted"></p>
            </div>
            <span id="projectInspectorCount" class="muted"></span>
          </div>
          <div id="projectInspectorBody" class="project-inspector-body"></div>
        </section>
        <button class="image-modal-nav image-modal-next project-inspector-next" type="button" aria-label="Next row">&#8250;</button>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest(".project-inspector-close")) closeProjectInspector();
      if (event.target.closest(".project-inspector-prev")) showProjectInspectorAt(state.modalIndex - 1);
      if (event.target.closest(".project-inspector-next")) showProjectInspectorAt(state.modalIndex + 1);
    });
    document.addEventListener("keydown", (event) => {
      if (modal.classList.contains("hidden")) return;
      if (!$("imagePreviewModal")?.classList.contains("hidden")) return;
      if (event.key === "Escape") closeProjectInspector();
      if (event.key === "ArrowLeft") showProjectInspectorAt(state.modalIndex - 1);
      if (event.key === "ArrowRight") showProjectInspectorAt(state.modalIndex + 1);
    });
    return modal;
  }

  function openProjectInspector(rows, index) {
    if (!rows.length) return;
    state.modalRows = rows;
    const modal = ensureProjectInspectorModal();
    showProjectInspectorAt(index);
    modal.classList.remove("hidden");
  }

  function closeProjectInspector() {
    $("projectInspectorModal")?.classList.add("hidden");
    state.modalIndex = -1;
  }

  function showProjectInspectorAt(index) {
    if (!state.modalRows.length) return;
    state.modalIndex = (index + state.modalRows.length) % state.modalRows.length;
    const row = state.modalRows[state.modalIndex];
    const item = row.raw || {};
    const screenshots = row.type === "screenshot" ? [item] : relatedScreenshots(row);
    $("projectInspectorType").textContent = row.type;
    $("projectInspectorTitle").textContent = row.value || "Project row";
    $("projectInspectorMeta").textContent = [row.source ? `Source: ${row.source}` : "Source: -", row.seen ? `Seen: ${row.seen}` : "Seen: -", row.detail || ""].filter(Boolean).join(" · ");
    $("projectInspectorCount").textContent = `${state.modalIndex + 1}/${state.modalRows.length}`;
    $("projectInspectorBody").innerHTML = `
      <div class="project-inspector-section">
        <strong>Raw observation</strong>
        <code>${esc(JSON.stringify(item, null, 2))}</code>
      </div>
      ${screenshots.length ? `<div class="project-inspector-section"><strong>Linked screenshots</strong><div class="projects-screenshot-grid">${screenshots.flatMap((shot) => (shot.images || []).slice(0, 12).map((image) => screenshotThumb(image))).join("")}</div></div>` : `<span class="muted">No screenshot preview linked to this selection.</span>`}
    `;
    $("projectInspectorModal")?.classList.toggle("single-image", state.modalRows.length <= 1);
  }

  function filteredRows() {
    const all = buildRows();
    const type = state.activeView;
    const query = state.filter.query.toLowerCase();
    return all
      .filter((row) => type === "all" || row.type === type)
      .filter((row) => !state.filter.onlyLive || row.type === "service" || Boolean(row.raw?.url || row.raw?.statusCode))
      .filter((row) => matchesText(`${row.type} ${row.value} ${row.detail} ${row.source}`, query));
  }

  function buildRows() {
    const s = state.snapshot;
    return []
      .concat(s.domains.map((item) => ({ type: "domain", value: item.domain, detail: item.kind || "", source: item.source, seen: item.first_seen_at, raw: item })))
      .concat(s.services.map((item) => ({ type: "service", value: item.url, detail: [item.statusCode, item.title, (item.technologies || []).join(", ")].filter(Boolean).join(" · "), source: item.source || "httpx", seen: item.probed_at, raw: item })))
      .concat(s.technologies.map((item) => ({ type: "technology", value: item.name, detail: `${item.count || 0} services · ${item.hostCount || 0} hosts`, source: item.source, seen: item.lastSeenAt, raw: item })))
      .concat(s.urls.map((item) => ({ type: "url", value: item.url, detail: (item.params || []).join(", "), source: item.source, seen: item.first_seen_at, raw: item })))
      .concat(s.screenshots.map((item) => ({ type: "screenshot", value: item.tool_name || item.output_dir || `screenshot-${item.id}`, detail: `${item.metadata?.screenshotCount ?? (item.images || []).length} images`, detailHtml: screenshotMiniGrid(item), source: item.tool_name, seen: item.created_at, raw: item })))
      .concat(s.leads.map((item) => ({ type: "lead", value: item.value, detail: `${item.status || item.confidence || ""} ${item.metadata?.correlationScore ? `score ${item.metadata.correlationScore}` : ""}`, source: item.source, seen: item.created_at, raw: item })))
      .concat(s.events.map((item) => ({ type: "event", value: item.message, detail: item.phase || "", source: item.source, seen: item.created_at, raw: item })));
  }

  function screenshotMiniGrid(item) {
    const images = (item.images || []).slice(0, 4);
    if (!images.length) return esc(`${item.metadata?.screenshotCount ?? 0} images`);
    return `<div class="projects-screenshot-grid projects-screenshot-grid-mini">${images.map(screenshotThumb).join("")}</div>`;
  }

  function screenshotThumb(image) {
    return `<button class="screenshot-thumb" type="button" data-image-url="${esc(image.url)}" data-image-name="${esc(image.name || "screenshot")}"><img src="${esc(image.url)}" alt="${esc(image.name || "screenshot")}" loading="lazy"></button>`;
  }

  function relatedScreenshots(row) {
    const value = String(row.value || "").toLowerCase();
    const host = row.raw?.host || hostFromUrl(row.raw?.url || row.value);
    return (state.snapshot.screenshots || []).filter((shot) => {
      const blob = JSON.stringify(shot).toLowerCase();
      return (host && blob.includes(String(host).toLowerCase())) || (value && blob.includes(value));
    }).slice(0, 3);
  }

  async function askAi() {
    const prompt = $("projectsAiPrompt").value.trim();
    if (!prompt) return;
    $("projectsAiAnswer").textContent = "Asking AI with the current project snapshot...";
    try {
      const context = summarizeForAi();
      const message = await window.AuraAiAgent.ask([
        "Use the loaded A.U.R.A project snapshot below. Help search, filter, summarize, or extract data. If the user asks for a filter, suggest concrete filter text and type.",
        "Return concise results and mention if screenshots are present.",
        "",
        context,
        "",
        `User request: ${prompt}`
      ].join("\n"));
      $("projectsAiAnswer").textContent = message;
    } catch (error) {
      $("projectsAiAnswer").textContent = error.message;
    }
  }

  function applyAiFilter() {
    const prompt = $("projectsAiPrompt").value.toLowerCase();
    const typeMap = { domain: "domain", domains: "domain", service: "service", services: "service", http: "service", tech: "technology", technology: "technology", url: "url", urls: "url", screenshot: "screenshot", screenshots: "screenshot", lead: "lead", leads: "lead", event: "event", events: "event" };
    const chosen = Object.entries(typeMap).find(([word]) => prompt.includes(word));
    if (chosen) setView(chosen[1]);
    const terms = prompt.replace(/show|find|filter|with|all|only|where|that|have|has|project|projects|screenshots?|services?|domains?|urls?|technologies?|tech/g, " ").split(/\s+/).filter((word) => word.length > 2).slice(0, 5);
    $("projectsDataSearch").value = terms.join(" ");
    state.filter.query = $("projectsDataSearch").value;
    renderData();
  }

  function summarizeForAi() {
    const s = state.snapshot;
    const rows = filteredRows().slice(0, 80);
    return JSON.stringify({
      target: state.selectedTarget,
      run: s.run,
      counts: { domains: s.domains.length, services: s.services.length, technologies: s.technologies.length, urls: s.urls.length, screenshots: screenshotCount(s.screenshots), leads: s.leads.length, events: s.events.length },
      topTechnologies: s.technologies.slice(0, 20),
      sampleRows: rows.map((row) => ({ type: row.type, value: row.value, detail: row.detail, source: row.source, screenshots: row.type === "screenshot" ? row.raw?.images?.length || 0 : relatedScreenshots(row).reduce((sum, shot) => sum + (shot.images || []).length, 0) }))
    }, null, 2).slice(0, 18000);
  }

  function setView(type) {
    state.activeView = type || "all";
    if ($("projectsTypeFilter")) $("projectsTypeFilter").value = state.activeView;
    renderData();
  }

  function exportFiltered(format) {
    const rows = filteredRows();
    if (format === "json") {
      download(`aura-project-${state.selectedTarget || "project"}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), target: state.selectedTarget, runId: state.selectedRunId, rows }, null, 2), "application/json");
      return;
    }
    const csv = [["type", "value", "detail", "source", "seen"]].concat(rows.map((row) => [row.type, row.value, row.detail, row.source, row.seen])).map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
    download(`aura-project-${state.selectedTarget || "project"}.csv`, csv, "text/csv");
  }

  function runsForTarget(targetName) {
    return state.runs.filter((run) => run.target_name === targetName).sort((a, b) => Number(b.id) - Number(a.id));
  }

  function projectSearchText(target) {
    return [target.target_name, target.program_url, ...(target.root_domains || []), ...runsForTarget(target.target_name).map((run) => `${run.id} ${run.status} ${run.run_type} ${run.mode}`)].join(" ");
  }

  function screenshotCount(shots) {
    return (shots || []).reduce((sum, shot) => sum + Number(shot.metadata?.screenshotCount ?? (shot.images || []).length ?? 0), 0);
  }

  function emptySnapshot() {
    return { run: null, counts: {}, domains: [], services: [], technologies: [], urls: [], screenshots: [], leads: [], events: [], tools: [], delta: null };
  }

  function labelForType(type) {
    return ({ all: "All", domain: "Domains", service: "Services", technology: "Tech", url: "URLs", screenshot: "Screenshots", lead: "Leads", event: "Events" })[type] || type;
  }

  function matchesText(value, query) {
    return !query || String(value || "").toLowerCase().includes(query);
  }

  function hostFromUrl(value) {
    try { return new URL(value).host; } catch { return ""; }
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function api(path, options = {}) {
    if (window.auraApi) return window.auraApi(path, options);
    const res = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function injectStylesheet(href, id) {
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function showError(error) {
    const status = $("status");
    if (status) status.textContent = error.message;
    const box = $("projectsAiAnswer");
    if (box) box.textContent = error.message;
  }

  window.AuraProjectsView = { bind, refresh, selectProject };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }
})();
