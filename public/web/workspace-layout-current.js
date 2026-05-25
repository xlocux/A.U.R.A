"use strict";

(function initAuraWorkspaceLayoutCurrent() {
  let currentRunData = null;
  let refreshTimer = null;
  let topologyRenderSerial = 0;

  function boot() {
    injectStyles();
    collapseAdvancedProviderLeads();
    setupLogsTab();
    setupTopologyViews();
    observeRunData();
  }

  function collapseAdvancedProviderLeads() {
    const recon = document.getElementById("tab-recon");
    if (!recon) return;
    const advancedPane = [...recon.querySelectorAll(".pane")].find((pane) => /advanced provider leads/i.test(pane.querySelector("h2")?.textContent || ""));
    const discoveryPane = [...recon.querySelectorAll(".pane")].find((pane) => /discovery leads/i.test(pane.querySelector("h2")?.textContent || ""));
    if (!advancedPane || !discoveryPane) return;
    advancedPane.classList.add("aura-hidden-provider-leads");
    discoveryPane.classList.add("aura-discovery-leads-wide");
    advancedPane.parentElement?.classList.add("aura-discovery-only-row");
    if (!document.getElementById("providerLeadsAiNote")) {
      const note = document.createElement("div");
      note.id = "providerLeadsAiNote";
      note.className = "notice muted compact-notice";
      note.textContent = "Advanced provider-lead collection is AI-assisted. Ask AI Agent for WHOIS/RDAP/provider pivots; this table stays focused on saved Discovery Leads.";
      discoveryPane.insertBefore(note, discoveryPane.querySelector(".scroll"));
    }
  }

  function setupLogsTab() {
    const tabs = document.querySelector(".tabs");
    if (!tabs || document.querySelector('[data-tab="logs"]')) return;
    const aiButton = tabs.querySelector('[data-tab="ai-log"]');
    const runButton = tabs.querySelector('[data-tab="runs"]');
    const logsButton = document.createElement("button");
    logsButton.className = "tab";
    logsButton.type = "button";
    logsButton.dataset.tab = "logs";
    logsButton.textContent = "Logs";
    tabs.insertBefore(logsButton, aiButton || runButton || null);
    aiButton?.classList.add("aura-hidden-tab");
    runButton?.classList.add("aura-hidden-tab");

    const panel = document.createElement("section");
    panel.id = "tab-logs";
    panel.className = "tab-panel aura-logs-panel";
    panel.innerHTML = `
      <div class="logs-subtabs">
        <button type="button" class="active" data-log-subtab="timeline">Timeline</button>
        <button type="button" data-log-subtab="events">Run Events</button>
        <button type="button" data-log-subtab="tools">Tool Results</button>
        <button type="button" data-log-subtab="ai">AI Decisions</button>
        <button type="button" data-log-subtab="correlation">Correlation</button>
        <button type="button" data-log-subtab="errors">Warnings & Errors</button>
      </div>
      <div id="logsContent" class="aura-log-content"></div>
    `;
    document.querySelector(".workspace-main")?.appendChild(panel);

    logsButton.addEventListener("click", (event) => {
      event.preventDefault();
      activateMainPanel("logs");
      renderActiveLogSubtab("timeline");
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-log-subtab]");
      if (!button) return;
      event.preventDefault();
      document.querySelectorAll("[data-log-subtab]").forEach((node) => node.classList.toggle("active", node === button));
      renderActiveLogSubtab(button.dataset.logSubtab);
    });
  }

  function setupTopologyViews() {
    const topology = document.getElementById("tab-topology");
    const shell = topology?.querySelector(".topology-shell");
    const main = topology?.querySelector(".topology-main");
    if (!topology || !shell || !main) return;

    if (!document.getElementById("topologyFullscreen")) {
      topology.querySelector(".topology-actions")?.insertAdjacentHTML("beforeend", `<button id="topologyFullscreen" type="button">Fullscreen</button>`);
      main.insertAdjacentHTML("beforeend", `<button id="topologyFullscreenClose" type="button" class="topology-fullscreen-close">Close</button>`);
      document.getElementById("topologyFullscreen")?.addEventListener("click", openTopologyFullscreen);
      document.getElementById("topologyFullscreenClose")?.addEventListener("click", closeTopologyFullscreen);
      document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeTopologyFullscreen(); });
    }

    if (!document.getElementById("topologyDashboard")) {
      shell.insertAdjacentHTML("beforebegin", `
        <div class="topology-view-tabs">
          <button type="button" class="active" data-topology-view="graph">Graph</button>
          <button type="button" data-topology-view="dashboard">Dashboard</button>
          <button type="button" data-topology-view="sources">Sources</button>
          <button type="button" data-topology-view="technologies">Technologies</button>
        </div>
        <div id="topologyDashboard" class="topology-dashboard hidden"></div>
      `);
    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-topology-view]");
      if (!button) return;
      event.preventDefault();
      const view = button.dataset.topologyView || "graph";
      document.querySelectorAll("[data-topology-view]").forEach((node) => node.classList.toggle("active", node === button));
      document.getElementById("topologyDashboard")?.classList.toggle("hidden", view === "graph");
      shell.classList.toggle("hidden", view !== "graph");
      if (view === "graph") {
        topologyRenderSerial += 1;
        setTimeout(() => window.AuraTopology?.render?.(), 50);
      } else {
        renderTopologyView(view);
      }
    });
  }

  function observeRunData() {
    const refresh = async () => {
      const runId = activeRunId();
      if (!runId) return;
      await loadRunData(runId);
      renderActiveLogSubtab(document.querySelector("[data-log-subtab].active")?.dataset.logSubtab || "timeline");
      const view = activeTopologyView();
      if (view !== "graph" && !document.getElementById("topologyDashboard")?.classList.contains("hidden")) {
        renderTopologyView(view, { useCache: true });
      }
    };
    refresh();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 12000);
    document.addEventListener("click", (event) => {
      if (event.target.closest(".result-subtab,.tab,[data-tab],[data-results-view]")) setTimeout(refresh, 250);
    });
  }

  async function loadRunData(runId) {
    if (!runId || runId === "-") return null;
    const id = encodeURIComponent(runId);
    const [tree, events, domains, services, urls, technologies] = await Promise.all([
      fetchJson(`/api/recon-runs/${id}/result-tree`),
      fetchJson(`/api/recon-runs/${id}/events`),
      fetchJson(`/api/recon-runs/${id}/domains`),
      fetchJson(`/api/recon-runs/${id}/http-services`),
      fetchJson(`/api/recon-runs/${id}/urls`),
      fetchJson(`/api/recon-runs/${id}/technologies`)
    ]);
    const flattened = flattenResultTree(tree?.tree || {});
    currentRunData = {
      runId,
      tree: tree?.tree || {},
      events: array(events?.events),
      domains: array(domains?.domains).length ? array(domains.domains) : flattened.domains,
      services: array(services?.services).length ? array(services.services) : flattened.services,
      urls: array(urls?.urls).length ? array(urls.urls) : flattened.urls,
      technologies: array(technologies?.technologies).length ? array(technologies.technologies) : flattened.technologies
    };
    return currentRunData;
  }

  async function renderTopologyView(view = "dashboard", options = {}) {
    const panel = document.getElementById("topologyDashboard");
    if (!panel || view === "graph") return;
    const serial = ++topologyRenderSerial;
    const runId = activeRunId();
    if (!runId) {
      panel.innerHTML = emptyPane("Topology analytics", "Load a run from Results before opening this view.");
      return;
    }
    if (!options.useCache) panel.innerHTML = emptyPane("Topology analytics", "Loading charts...");
    const data = options.useCache && currentRunData?.runId === runId ? currentRunData : await loadRunData(runId);
    if (serial !== topologyRenderSerial || activeTopologyView() !== view) return;
    panel.innerHTML = topologyHtml(view, data || emptyRunData(runId)) || emptyPane("Topology analytics", "No chart data available yet.");
  }

  async function fetchJson(url) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 5000) : null;
    try {
      const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
      if (!response.ok) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function flattenResultTree(tree) {
    const domains = [];
    const services = [];
    const urls = [];
    const technologies = new Map();
    for (const root of array(tree.roots)) {
      for (const child of array(root.children)) {
        const source = array(child.sources).join(",") || "unknown";
        domains.push({ domain: child.domain, root_domain: root.domain, kind: child.kind, source });
        for (const service of array(child.services)) services.push({ ...service, host: service.host || child.domain, source: service.source || source });
        for (const url of array(child.urls)) urls.push({ ...url, host: url.host || child.domain, source: url.source || source });
        for (const name of array(child.technologies)) {
          const item = technologies.get(name) || { name, count: 0, hosts: new Set() };
          item.count += 1;
          item.hosts.add(child.domain);
          technologies.set(name, item);
        }
      }
    }
    return { domains, services, urls, technologies: [...technologies.values()].map((item) => ({ name: item.name, count: item.count, hostCount: item.hosts.size })) };
  }

  function topologyHtml(view, data) {
    const domains = array(data?.domains);
    const services = array(data?.services);
    const urls = array(data?.urls);
    const technologies = array(data?.technologies);
    const techCounts = new Map(technologies.map((item) => [item.name || item.technology || String(item), Number(item.count || item.serviceCount || 1)]));
    if (view === "dashboard") return [
      metricCards({ domains, services, urls, technologies }),
      bars("HTTP status", countBy(services, (item) => item.statusCode || item.status_code || "none")),
      bars("Top technologies", techCounts),
      bars("Top URL hosts", countBy(urls, (item) => item.host || safeHost(item.url) || "unknown"))
    ].join("");
    if (view === "sources") return [
      bars("Domain sources", countCsv(domains, (item) => item.source || "unknown")),
      bars("Service sources", countCsv(services, (item) => item.source || "unknown")),
      bars("URL sources", countCsv(urls, (item) => item.source || "unknown"))
    ].join("");
    if (view === "technologies") return [
      bars("Top technologies", techCounts),
      bars("Service hosts", countBy(services, (item) => item.host || safeHost(item.url) || "unknown")),
      technologyTable(technologies)
    ].join("");
    return "";
  }

  function renderActiveLogSubtab(mode) {
    const node = document.getElementById("logsContent");
    if (!node) return;
    const events = normalizeEvents(currentRunData?.events || []);
    const tools = collectTableRows("#toolLogRows tr", ["Tool", "Status", "Exit", "Started", "Logs"]);
    const aiRows = collectTableRows("#aiLogRows tr", ["Time", "Source", "Action", "Evidence"]);
    const warnings = events.filter((event) => /warn|error|fail/i.test(`${event.severity} ${event.message}`)).concat(tools.filter((tool) => /fail|error/i.test(tool.Status || "")));
    const views = {
      timeline: timelineHtml(events, tools, aiRows),
      events: tablePane("Run Events", ["Time", "Phase", "Severity", "Source", "Message"], events.map((event) => [event.time, event.phase, event.severity, event.source, event.message])),
      tools: tablePane("Tool Results", ["Tool", "Status", "Exit", "Started", "Logs"], tools.map((tool) => [tool.Tool, tool.Status, tool.Exit, tool.Started, tool.Logs])),
      ai: tablePane("AI Decisions", ["Time", "Source", "Action", "Evidence"], aiRows.map((row) => [row.Time, row.Source, row.Action, row.Evidence])),
      correlation: correlationHtml(currentRunData),
      errors: tablePane("Warnings & Errors", ["Time/Tool", "Severity/Status", "Source", "Message"], warnings.map((item) => [item.time || item.Tool || "-", item.severity || item.Status || "-", item.source || item.Tool || "-", item.message || item.Logs || "-"]))
    };
    node.innerHTML = views[mode] || views.timeline;
  }

  function normalizeEvents(events) {
    return array(events).map((event) => ({
      time: event.created_at || event.createdAt || event.time || "-",
      phase: event.phase || "-",
      severity: event.severity || "info",
      source: event.source || "-",
      message: event.message || JSON.stringify(event)
    }));
  }

  function collectTableRows(selector, keys) {
    return [...document.querySelectorAll(selector)].map((tr) => {
      const cells = [...tr.children].map((td) => td.textContent.trim());
      if (!cells.length || /no .*loaded|no .*results/i.test(cells.join(" "))) return null;
      return Object.fromEntries(keys.map((key, index) => [key, cells[index] || "-"]));
    }).filter(Boolean);
  }

  function timelineHtml(events, tools, aiRows) {
    const items = [];
    events.slice(-40).forEach((event) => items.push({ type: "event", time: event.time, title: event.message, meta: `${event.phase} · ${event.severity} · ${event.source}` }));
    tools.slice(0, 20).forEach((tool) => items.push({ type: "tool", time: tool.Started, title: `${tool.Tool} ${tool.Status}`, meta: `exit ${tool.Exit} · ${tool.Logs}` }));
    aiRows.slice(0, 20).forEach((row) => items.push({ type: "ai", time: row.Time, title: row.Action, meta: `${row.Source} · ${row.Evidence}` }));
    items.sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
    if (!items.length) return emptyPane("Timeline", "No loaded run logs yet. Start or load a run to populate this view.");
    return `<div class="pane"><h2>Timeline</h2><div class="aura-timeline">${items.map((item) => `<div class="aura-timeline-item ${esc(item.type)}"><strong>${esc(item.title)}</strong><span>${esc(item.time || "-")}</span><p>${esc(item.meta || "")}</p></div>`).join("")}</div></div>`;
  }

  function correlationHtml(data) {
    const counts = [
      ["Domains", array(data?.domains).length],
      ["Services", array(data?.services).length],
      ["URLs", array(data?.urls).length],
      ["Technologies", array(data?.technologies).length]
    ];
    return `<div class="pane"><h2>Correlation</h2><div class="topology-metrics compact-metrics">${counts.map(([label, value]) => metric(label, value)).join("")}</div><p class="muted">Correlation counts are derived from the active run data loaded for Topology and Results.</p></div>`;
  }

  function openTopologyFullscreen() {
    document.body.classList.add("topology-fullscreen-mode");
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.AuraTopology?.render?.(), 50);
  }

  function closeTopologyFullscreen() {
    document.body.classList.remove("topology-fullscreen-mode");
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.AuraTopology?.render?.(), 50);
  }

  function activateMainPanel(name) {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
  }

  function activeRunId() {
    const text = document.getElementById("runId")?.textContent?.trim();
    if (text && text !== "-") return text;
    return document.getElementById("status")?.textContent?.match(/run\s+(\d+)/i)?.[1] || "";
  }

  function activeTopologyView() {
    return document.querySelector("[data-topology-view].active")?.dataset.topologyView || "graph";
  }

  function emptyRunData(runId) {
    return { runId, domains: [], services: [], urls: [], technologies: [], events: [], tree: {} };
  }

  function metricCards({ domains, services, urls, technologies }) {
    return `<div class="topology-metrics pane">${metric("Domains", domains.length)}${metric("Services", services.length)}${metric("URLs", urls.length)}${metric("Tech", technologies.length)}</div>`;
  }

  function metric(label, value) {
    return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function bars(title, map) {
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    const max = Math.max(1, ...rows.map((row) => row[1]));
    return `<div class="pane topology-chart"><h2>${esc(title)}</h2>${rows.length ? rows.map(([label, value]) => `<div class="chart-row"><span title="${esc(label)}">${esc(label)}</span><b style="width:${Math.max(4, (value / max) * 100)}%"></b><em>${esc(value)}</em></div>`).join("") : `<p class="muted">No data.</p>`}</div>`;
  }

  function technologyTable(items) {
    return `<div class="pane topology-chart"><h2>Technology summary</h2><div class="scroll"><table><thead><tr><th>Technology</th><th>Services</th><th>Hosts</th></tr></thead><tbody>${array(items).slice(0, 40).map((item) => `<tr><td>${esc(item.name || item.technology || "unknown")}</td><td>${esc(item.count || item.serviceCount || 1)}</td><td>${esc(item.hostCount || "-")}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  function tablePane(title, headers, rows) {
    if (!rows.length) return emptyPane(title, "No data for this log view yet.");
    return `<div class="pane"><h2>${esc(title)}</h2><div class="scroll"><table><thead><tr>${headers.map((head) => `<th>${esc(head)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  }

  function countBy(items, fn) {
    const map = new Map();
    for (const item of array(items)) {
      const key = String(fn(item) || "unknown");
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }

  function countCsv(items, fn) {
    const map = new Map();
    for (const item of array(items)) {
      const values = String(fn(item) || "unknown").split(",").map((part) => part.trim()).filter(Boolean);
      for (const value of values.length ? values : ["unknown"]) map.set(value, (map.get(value) || 0) + 1);
    }
    return map;
  }

  function safeHost(value) {
    try { return new URL(value).host; } catch { return ""; }
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function emptyPane(title, message) {
    return `<div class="pane"><h2>${esc(title)}</h2><p class="muted">${esc(message)}</p></div>`;
  }

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function injectStyles() {
    if (document.getElementById("aura-workspace-current-style")) return;
    const style = document.createElement("style");
    style.id = "aura-workspace-current-style";
    style.textContent = `
      .aura-hidden-provider-leads, .aura-hidden-tab { display: none !important; }
      .aura-discovery-only-row { grid-template-columns: 1fr !important; }
      .aura-discovery-leads-wide .scroll { max-height: calc(100vh - 250px); }
      .aura-discovery-leads-wide table { table-layout: fixed; min-width: 1120px; }
      .aura-discovery-leads-wide th, .aura-discovery-leads-wide td { padding: 4px 7px; }
      .logs-subtabs, .topology-view-tabs { display: flex; gap: 5px; align-items: center; margin: 0 0 8px; flex-wrap: wrap; }
      .logs-subtabs button, .topology-view-tabs button { width: auto; margin: 0; padding: 5px 9px; border-radius: 999px; background: rgba(20, 18, 34, .72); }
      .logs-subtabs button.active, .topology-view-tabs button.active { color: #071017; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
      .aura-log-content .scroll { max-height: calc(100vh - 190px); }
      .aura-timeline { display: grid; gap: 7px; }
      .aura-timeline-item { border: 1px solid var(--line); border-radius: 10px; padding: 8px; background: rgba(10,14,20,.36); }
      .aura-timeline-item strong { display: block; margin-bottom: 3px; }
      .aura-timeline-item span, .aura-timeline-item p { color: var(--muted); margin: 0; font-size: 12px; }
      .topology-dashboard { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .topology-dashboard.hidden, .topology-shell.hidden { display: none !important; }
      .topology-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
      .compact-metrics { margin-bottom: 8px; }
      .topology-metrics div { border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: rgba(10,14,20,.38); }
      .topology-metrics span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; }
      .topology-metrics strong { display: block; font-size: 24px; }
      .chart-row { display: grid; grid-template-columns: 170px 1fr 52px; gap: 8px; align-items: center; margin: 5px 0; font-size: 12px; }
      .chart-row b { display: block; height: 11px; min-width: 4px; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
      .chart-row em { color: var(--muted); font-style: normal; text-align: right; font-variant-numeric: tabular-nums; }
      .topology-fullscreen-close { display: none; }
      body.topology-fullscreen-mode { overflow: hidden; }
      body.topology-fullscreen-mode .topology-main { position: fixed; inset: 10px; z-index: 9998; padding: 12px; background: rgba(10,14,20,.98); border: 1px solid var(--accent); box-shadow: 0 0 0 9999px rgba(0,0,0,.72); }
      body.topology-fullscreen-mode #topologyCanvas { height: calc(100vh - 120px) !important; min-height: 0; }
      body.topology-fullscreen-mode #topologyFullscreenClose { display: inline-flex !important; position: fixed !important; top: 16px !important; right: 16px !important; left: auto !important; z-index: 10050 !important; width: auto !important; min-width: 88px !important; justify-content: center !important; padding: 8px 14px !important; border-radius: 999px !important; color: #071017 !important; background: linear-gradient(135deg, var(--accent), var(--accent-2)) !important; box-shadow: 0 12px 30px rgba(0,0,0,.45) !important; }
      @media (max-width: 1000px) { .topology-dashboard, .topology-metrics { grid-template-columns: 1fr; } .chart-row { grid-template-columns: 120px 1fr 42px; } }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
