"use strict";

(function initAuraDashboardV2Operator() {
  const passiveTools = ["crtsh", "wayback", "rapiddns", "rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx", "whoisxmlapi", "whoisfreaks"];
  const wslTools = ["subfinder", "amass", "dnsx", "puredns", "shuffleDns", "gau", "httpx"];
  const screenshotTools = ["gowitness", "aquatone", "eyewitness"];
  const apiBacked = new Set(["rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx", "whoisxmlapi", "whoisfreaks"]);
  const labels = { crtsh: "crt.sh", wayback: "Wayback", rapiddns: "RapidDNS", rapid7: "Rapid7", certspotter: "CertSpotter", securitytrails: "SecurityTrails", shodan: "Shodan", virustotal: "VirusTotal", censys: "Censys", binaryedge: "BinaryEdge", urlscan: "urlscan", hunterio: "Hunter", passivetotal: "PassiveTotal", zoomeye: "ZoomEye", spyse: "Spyse", intelx: "IntelX", whoisxmlapi: "WhoisXML", whoisfreaks: "WhoisFreaks", subfinder: "subfinder", amass: "amass", dnsx: "dnsx", puredns: "puredns", shuffleDns: "shuffle-dns", gau: "gau", httpx: "httpx", gowitness: "gowitness", aquatone: "aquatone", eyewitness: "EyeWitness" };

  let state = { targets: [], runs: [], apiKeys: [], wordlists: [], selectedRun: null, runData: null };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const arr = (v) => Array.isArray(v) ? v : [];

  function boot() {
    injectSections();
    bind();
    refreshOperator();
    setInterval(refreshOperator, 20000);
  }

  function injectSections() {
    const nav = document.querySelector(".main-nav");
    const main = document.querySelector(".dashboard-main");
    if (!nav || !main || $("section-recon")) return;
    nav.insertAdjacentHTML("beforeend", `
      <button class="nav-item" data-section="recon" type="button">Recon</button>
      <button class="nav-item" data-section="results" type="button">Results</button>
      <button class="nav-item" data-section="search" type="button">Search</button>
      <button class="nav-item" data-section="wordlists" type="button">Wordlists</button>
      <button class="nav-item" data-section="topology" type="button">Topology</button>
    `);
    main.insertAdjacentHTML("beforeend", `
      <section id="section-recon" class="dashboard-section"><div class="page-head"><div><p class="eyebrow">Recon</p><h1>Launch authorized recon.</h1><p>Create targets, choose scan presets, and start runs from the v2 dashboard.</p></div></div>${reconHtml()}</section>
      <section id="section-results" class="dashboard-section"><div class="page-head"><div><p class="eyebrow">Results</p><h1>Explore findings.</h1><p>Domains, services, URLs, technologies, screenshots, artifacts, and exports for the selected run.</p></div><select id="opResultsRun"></select></div>${resultsHtml()}</section>
      <section id="section-search" class="dashboard-section"><div class="page-head"><div><p class="eyebrow">Search</p><h1>Search saved data.</h1><p>Query saved domains, services, URLs, technology stack, titles, and asset leads.</p></div></div>${searchHtml()}</section>
      <section id="section-wordlists" class="dashboard-section"><div class="page-head"><div><p class="eyebrow">Wordlists</p><h1>Manage wordlists.</h1><p>Add local lists and generate scoped lists from saved results.</p></div></div>${wordlistsHtml()}</section>
      <section id="section-topology" class="dashboard-section"><div class="page-head"><div><p class="eyebrow">Topology</p><h1>Topology preview.</h1><p>Graph-style preview built from domains, services, and technologies for the selected run.</p></div><select id="opTopologyRun"></select></div>${topologyHtml()}</section>
    `);
  }

  function reconHtml() {
    return `<div class="operator-grid"><section class="panel"><div class="panel-head"><div><h2>Create Target</h2><p>Save scope before launching recon.</p></div></div><div class="form-grid"><div class="field-grid"><div class="field"><label>Target name</label><input id="opTargetName" placeholder="acme"></div><div class="field"><label>Program URL</label><input id="opProgramUrl" placeholder="https://example.com/security"></div></div><div class="field"><label>In-scope domains / URLs</label><textarea id="opInScope" placeholder="example.com\n*.example.com\nhttps://app.example.com/login"></textarea></div><div class="field"><label>Out of scope</label><textarea id="opOutScope" placeholder="dev.example.com\n*.internal.example.com"></textarea></div><div class="action-row"><button id="opCreateTarget" class="primary-action" type="button">Create Target</button><button class="ghost-button" data-section-jump="targets" type="button">View Targets</button></div><div id="opTargetStatus" class="status-note">Ready to create a target.</div></div></section><section class="panel"><div class="panel-head"><div><h2>Start Scan</h2><p>Presets select tools and skip API providers without active keys.</p></div></div><div class="form-grid"><div class="field"><label>Target</label><select id="opScanTarget"></select></div><div class="field-grid"><div class="field"><label>Input mode</label><select id="opInputMode"><option value="single">Single domain</option><option value="list">Domain list</option></select></div><div class="field"><label>Scan preset</label><select id="opScanPreset"><option value="rapid">Rapid</option><option value="normal" selected>Normal</option><option value="full">Full</option></select></div></div><div class="field"><label>Authorized seed domains</label><textarea id="opSeeds" placeholder="example.com"></textarea></div><label class="tool-pill"><input id="opAuthorized" type="checkbox"> Authorized scope confirmed</label><div class="field-grid"><div class="field"><label>WSL distro</label><input id="opDistro" value="kali-linux"></div><div class="field"><label>Timeout ms</label><input id="opTimeout" type="number" value="180000"></div></div><div id="opToolCloud" class="tool-cloud"></div><div id="opScanStatus" class="status-note">Choose a target and confirm authorization.</div><button id="opStartRecon" class="primary-action" type="button">Start Recon</button></div></section></div>`;
  }

  function resultsHtml() {
    return `<section class="panel"><div class="mini-tabs"><button class="mini-tab active" data-result-pane="domains">Domains</button><button class="mini-tab" data-result-pane="services">Services</button><button class="mini-tab" data-result-pane="urls">URLs</button><button class="mini-tab" data-result-pane="tech">Tech</button><button class="mini-tab" data-result-pane="screens">Screenshots</button><button class="mini-tab" data-result-pane="tools">Tool Logs</button><button class="mini-tab" data-result-pane="export">Export</button></div><div id="opResults-domains" class="result-pane active table-wrap"></div><div id="opResults-services" class="result-pane table-wrap"></div><div id="opResults-urls" class="result-pane table-wrap"></div><div id="opResults-tech" class="result-pane table-wrap"></div><div id="opResults-screens" class="result-pane table-wrap"></div><div id="opResults-tools" class="result-pane table-wrap"></div><div id="opResults-export" class="result-pane"><div class="action-row"><button data-export="json" class="ghost-button">Export JSON</button><button data-export="csv" class="ghost-button">Export CSV</button><button data-export="markdown" class="ghost-button">Export Markdown</button><button data-followup="http" class="primary-action">HTTP/Tech Follow-up</button><button data-followup="urls" class="ghost-button">URL/Params</button><button data-followup="screenshots" class="ghost-button">Screenshots</button></div><div id="opExportStatus" class="status-note">Exports and follow-ups use the selected run.</div></div></section>`;
  }

  function searchHtml() {
    return `<div class="operator-grid"><section class="panel"><div class="form-grid"><div class="field"><label>Query</label><input id="opSearchQuery" class="operator-input" placeholder="citrix, jquery, /admin, cve"></div><div class="field"><label>Target filter</label><select id="opSearchTarget"></select></div><button id="opRunSearch" class="primary-action" type="button">Search</button><div id="opSearchStatus" class="status-note">Search checks saved data.</div></div></section><section class="panel"><div class="table-wrap"><table><thead><tr><th>Type</th><th>Target</th><th>Value</th><th>Detail</th><th>Source</th></tr></thead><tbody id="opSearchRows"></tbody></table></div></section></div>`;
  }

  function wordlistsHtml() {
    return `<div class="operator-grid"><section class="panel"><div class="form-grid"><div class="field-grid"><div class="field"><label>Name</label><input id="opWordlistName"></div><div class="field"><label>Category</label><select id="opWordlistCategory"><option value="domains">domains</option><option value="technologies">technologies</option><option value="payloads">payloads</option><option value="paths">paths</option><option value="params">params</option></select></div></div><div class="field"><label>Path</label><input id="opWordlistPath" placeholder="/usr/share/seclists/.../common.txt"></div><div class="field"><label>Notes</label><input id="opWordlistNotes"></div><div class="action-row"><button id="opSaveWordlist" class="primary-action">Save Wordlist</button><button id="opGenerateWordlist" class="ghost-button">Generate From Results</button></div><div id="opWordlistStatus" class="status-note">Manage active local wordlists.</div></div></section><section class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Path</th><th>Actions</th></tr></thead><tbody id="opWordlistRows"></tbody></table></div></section></div>`;
  }

  function topologyHtml() {
    return `<section class="panel"><div class="panel-head"><div><h2>Graph Preview</h2><p>Interactive full topology remains in the classic UI; this preview summarizes run relationships.</p></div><a href="/#topology" class="text-button">Open Classic Topology</a></div><div id="opTopologyMap" class="topology-map"></div></section>`;
  }

  function bind() {
    document.addEventListener("click", (event) => {
      if (event.target.closest("#opCreateTarget")) createTarget();
      if (event.target.closest("#opStartRecon")) startRecon();
      if (event.target.closest("#opRunSearch")) runSearch();
      if (event.target.closest("#opSaveWordlist")) saveWordlist();
      if (event.target.closest("#opGenerateWordlist")) generateWordlist();
      const pane = event.target.closest("[data-result-pane]");
      if (pane) activateResultPane(pane.dataset.resultPane);
      const exp = event.target.closest("[data-export]");
      if (exp) exportRun(exp.dataset.export);
      const follow = event.target.closest("[data-followup]");
      if (follow) followupRun(follow.dataset.followup);
    });
    document.addEventListener("change", (event) => {
      if (["opResultsRun", "opTopologyRun"].includes(event.target.id)) loadRun(event.target.value).then(renderOperator);
      if (["opScanPreset", "opScanTarget"].includes(event.target.id)) applyPreset();
    });
  }

  async function refreshOperator() {
    const [targets, runs, keys, wordlists] = await Promise.all([get("/api/targets"), get("/api/recon-runs"), get("/api/api-keys"), get("/api/wordlists").catch(() => ({ wordlists: [] }))]);
    state.targets = arr(targets.targets);
    state.runs = arr(runs.runs).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    state.apiKeys = arr(keys.apiKeys);
    state.wordlists = arr(wordlists.wordlists);
    if (!state.selectedRun && state.runs[0]) state.selectedRun = String(state.runs[0].id);
    await loadRun(state.selectedRun);
    renderOperator();
  }

  async function loadRun(runId) {
    state.selectedRun = String(runId || "");
    if (!state.selectedRun) { state.runData = emptyRun(); return; }
    const id = encodeURIComponent(state.selectedRun);
    const [domains, services, urls, tech, screens, tools] = await Promise.all([get(`/api/recon-runs/${id}/domains`), get(`/api/recon-runs/${id}/http-services`), get(`/api/recon-runs/${id}/urls`), get(`/api/recon-runs/${id}/technologies`), get(`/api/recon-runs/${id}/screenshots`), get(`/api/recon-runs/${id}/tool-results`)]);
    state.runData = { domains: arr(domains.domains), services: arr(services.services), urls: arr(urls.urls), tech: arr(tech.technologies), screens: arr(screens.screenshots), tools: arr(tools.toolResults) };
  }

  async function get(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function renderOperator() {
    renderSelects();
    renderTools();
    renderResults();
    renderWordlists();
    renderTopology();
  }

  function renderSelects() {
    const targetOptions = state.targets.map((t) => `<option value="${esc(t.target_name)}">${esc(t.target_name)}</option>`).join("");
    for (const id of ["opScanTarget", "opSearchTarget"]) if ($(id)) $(id).innerHTML = (id === "opSearchTarget" ? `<option value="">All targets</option>` : "") + targetOptions;
    const runOptions = state.runs.map((r) => `<option value="${esc(r.id)}">#${esc(r.id)} · ${esc(r.target_name)} · ${esc(r.status)}</option>`).join("");
    for (const id of ["opResultsRun", "opTopologyRun"]) if ($(id)) { $(id).innerHTML = runOptions || `<option value="">No runs</option>`; $(id).value = state.selectedRun || ""; }
  }

  function renderTools() {
    const active = new Set(state.apiKeys.filter((k) => k.status === "active").map((k) => String(k.provider).toLowerCase()));
    const tools = selectedPresetTools();
    const html = [...passiveTools, ...wslTools, ...screenshotTools].map((id) => {
      const missing = apiBacked.has(id) && !active.has(id);
      return `<label class="tool-pill ${missing ? "missing" : ""}" title="${missing ? "Requires active API key" : ""}"><input data-op-tool="${esc(id)}" type="checkbox" ${tools.has(id) && !missing ? "checked" : ""} ${missing ? "disabled" : ""}> ${esc(labels[id] || id)}</label>`;
    }).join("");
    if ($("opToolCloud")) $("opToolCloud").innerHTML = html;
    const status = $("opScanStatus");
    if (status) status.textContent = "Preset applied. API-backed providers without active keys are disabled and skipped.";
  }

  function applyPreset() { renderTools(); }

  function selectedPresetTools() {
    const preset = $("opScanPreset")?.value || "normal";
    if (preset === "rapid") return new Set(["crtsh", "wayback", "rapiddns", "subfinder", "dnsx", "httpx"]);
    if (preset === "full") return new Set([...passiveTools, ...wslTools, ...screenshotTools]);
    return new Set(["crtsh", "wayback", "rapiddns", "certspotter", "securitytrails", "shodan", "virustotal", "urlscan", "subfinder", "dnsx", "gau", "httpx", "gowitness"]);
  }

  async function createTarget() {
    const set = statusSetter("opTargetStatus");
    try {
      const data = await post("/api/targets", { targetName: $("opTargetName").value.trim(), programUrl: $("opProgramUrl").value.trim(), inScope: $("opInScope").value.split(/\r?\n/).filter(Boolean), outOfScope: $("opOutScope").value.split(/\r?\n/).filter(Boolean), authorized: false });
      set(`Target ${data.target?.target_name || "created"} saved.`, "ok");
      await refreshOperator();
    } catch (e) { set(e.message, "error"); }
  }

  async function startRecon() {
    const set = statusSetter("opScanStatus");
    try {
      const selected = [...document.querySelectorAll("[data-op-tool]:checked")].map((n) => n.dataset.opTool);
      const preset = $("opScanPreset").value;
      const passive = selected.filter((x) => passiveTools.includes(x));
      const wsl = selected.filter((x) => wslTools.includes(x));
      const shots = selected.filter((x) => screenshotTools.includes(x));
      const seeds = $("opSeeds").value.split(/\s+/).filter(Boolean);
      const reconMode = preset === "full" ? "full" : $("opInputMode").value;
      const body = { targetName: $("opScanTarget").value, authorized: $("opAuthorized").checked, rootDomains: seeds, reconMode, passiveSources: passive, wslTools: wsl, screenshotTools: shots, useWsl: wsl.length > 0, wslDistro: $("opDistro").value || "kali-linux", timeoutMs: Number($("opTimeout").value || 180000), intelPreflight: true };
      const data = await post("/api/recon-runs", body);
      set(`Run #${data.run?.id} queued.`, "ok");
      await refreshOperator();
    } catch (e) { set(e.message, "error"); }
  }

  function renderResults() {
    const d = state.runData || emptyRun();
    table("opResults-domains", ["Domain", "Kind", "Source"], d.domains.map((x) => [x.domain, x.kind, x.source]));
    table("opResults-services", ["URL", "Status", "Title", "Tech"], d.services.map((x) => [x.url || x.baseUrl, x.statusCode || x.status_code, x.title, arr(x.technologies).join(", ") || x.tech]));
    table("opResults-urls", ["URL", "Host", "Path", "Source"], d.urls.map((x) => [x.url, x.host, x.path, x.source]));
    table("opResults-tech", ["Technology", "Services", "Hosts"], d.tech.map((x) => [x.name || x.technology, x.count || x.serviceCount, x.hostCount || "-"]));
    table("opResults-screens", ["Tool", "Screens", "Report"], d.screens.map((x) => [x.tool_name || x.toolName, x.metadata?.screenshotCount ?? "-", x.report_path || x.reportPath || x.output_path || "-"]));
    table("opResults-tools", ["Tool", "Status", "Exit", "Started"], d.tools.map((x) => [x.toolName || x.tool_name, x.status, x.exitCode ?? x.exit_code, x.startedAt || x.started_at]));
  }

  function activateResultPane(name) {
    document.querySelectorAll("[data-result-pane]").forEach((n) => n.classList.toggle("active", n.dataset.resultPane === name));
    document.querySelectorAll(".result-pane").forEach((n) => n.classList.toggle("active", n.id === `opResults-${name}`));
  }

  async function runSearch() {
    const set = statusSetter("opSearchStatus");
    try {
      const q = encodeURIComponent($("opSearchQuery").value.trim());
      const target = $("opSearchTarget").value ? `&target=${encodeURIComponent($("opSearchTarget").value)}` : "";
      const data = await get(`/api/search?q=${q}${target}&limit=300`);
      $("opSearchRows").innerHTML = arr(data.results).map((r) => `<tr><td>${esc(r.type)}</td><td>${esc(r.targetName || r.target_name || "-")}</td><td>${esc(r.value)}</td><td>${esc(r.detail || "-")}</td><td>${esc(r.source || "-")}</td></tr>`).join("") || rowEmpty(5, "No results.");
      set(`${arr(data.results).length} results.`, "ok");
    } catch (e) { set(e.message, "error"); }
  }

  async function saveWordlist() {
    const set = statusSetter("opWordlistStatus");
    try {
      await post("/api/wordlists", { name: $("opWordlistName").value.trim(), category: $("opWordlistCategory").value, path: $("opWordlistPath").value.trim(), notes: $("opWordlistNotes").value.trim(), status: "active" });
      set("Wordlist saved.", "ok");
      await refreshOperator();
    } catch (e) { set(e.message, "error"); }
  }

  async function generateWordlist() {
    const set = statusSetter("opWordlistStatus");
    try {
      await post("/api/wordlists/generate", { name: $("opWordlistName").value.trim() || null, category: $("opWordlistCategory").value, targetName: $("opScanTarget")?.value || null });
      set("Wordlist generated from saved results.", "ok");
      await refreshOperator();
    } catch (e) { set(e.message, "error"); }
  }

  function renderWordlists() {
    if (!$("opWordlistRows")) return;
    $("opWordlistRows").innerHTML = state.wordlists.map((w) => `<tr><td>${esc(w.name)}</td><td>${esc(w.category)}</td><td>${esc(w.status)}</td><td class="mono">${esc(w.path)}</td><td><a class="text-button" href="/api/wordlists/${esc(w.id)}/download">Download</a></td></tr>`).join("") || rowEmpty(5, "No wordlists configured.");
  }

  function renderTopology() {
    const map = $("opTopologyMap");
    if (!map) return;
    const d = state.runData || emptyRun();
    const nodes = [];
    const domains = d.domains.slice(0, 10);
    const services = d.services.slice(0, 10);
    const tech = d.tech.slice(0, 8);
    domains.forEach((x, i) => nodes.push(node(x.domain, "domain", 50 + Math.cos(i / Math.max(1, domains.length) * Math.PI * 2) * 32, 50 + Math.sin(i / Math.max(1, domains.length) * Math.PI * 2) * 32)));
    services.forEach((x, i) => nodes.push(node(x.host || safeHost(x.url) || "service", "service", 50 + Math.cos(i / Math.max(1, services.length) * Math.PI * 2 + .6) * 22, 50 + Math.sin(i / Math.max(1, services.length) * Math.PI * 2 + .6) * 22)));
    tech.forEach((x, i) => nodes.push(node(x.name || x.technology || "tech", "tech", 50 + Math.cos(i / Math.max(1, tech.length) * Math.PI * 2 + 1.2) * 12, 50 + Math.sin(i / Math.max(1, tech.length) * Math.PI * 2 + 1.2) * 12)));
    map.innerHTML = nodes.join("") || `<div class="empty">No topology data for selected run.</div>`;
  }

  function node(label, kind, x, y) { return `<div class="topology-node ${kind}" style="left:${x}%;top:${y}%" title="${esc(label)}">${esc(short(label, 18))}</div>`; }
  function short(v, n) { const s = String(v || ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
  function safeHost(v) { try { return new URL(v).host; } catch { return ""; } }

  function table(id, heads, rows) {
    const el = $(id); if (!el) return;
    el.innerHTML = `<table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? "-")}</td>`).join("")}</tr>`).join("") : rowEmpty(heads.length, "No data.")}</tbody></table>`;
  }

  function exportRun(format) {
    if (!state.selectedRun) return;
    window.open(`/api/recon-runs/${encodeURIComponent(state.selectedRun)}/export?format=${encodeURIComponent(format)}`, "_blank", "noopener");
  }

  async function followupRun(type) {
    const set = statusSetter("opExportStatus");
    try {
      const path = type === "http" ? "http" : type;
      const data = await post(`/api/recon-runs/${encodeURIComponent(state.selectedRun)}/follow-up/${path}`, { useWsl: true, wslDistro: "kali-linux" });
      set(`Follow-up run #${data.run?.id} queued.`, "ok");
      await refreshOperator();
    } catch (e) { set(e.message, "error"); }
  }

  function statusSetter(id) { return (msg, cls = "") => { const n = $(id); if (!n) return; n.textContent = msg; n.className = `status-note ${cls}`; }; }
  function rowEmpty(cols, text) { return `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`; }
  function emptyRun() { return { domains: [], services: [], urls: [], tech: [], screens: [], tools: [] }; }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
