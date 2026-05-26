"use strict";

(function initAuraWorkspaceLayout() {
  let currentRunData = null;

  function boot() {
    injectStyles();
    collapseAdvancedProviderLeads();
    setupLogsTab();
    setupTopologyEnhancements();
    observeRunData();
  }

  function collapseAdvancedProviderLeads() {
    const recon = document.getElementById("tab-recon");
    if (!recon) return;
    const advancedPane = [...recon.querySelectorAll(".pane")].find((pane) => /advanced provider leads/i.test(pane.querySelector("h2")?.textContent || ""));
    const discoveryPane = [...recon.querySelectorAll(".pane")].find((pane) => /discovery leads/i.test(pane.querySelector("h2")?.textContent || ""));
    if (!advancedPane || !discoveryPane) return;
    const parent = advancedPane.parentElement;
    advancedPane.classList.add("aura-hidden-provider-leads");
    discoveryPane.classList.add("aura-discovery-leads-wide");
    parent?.classList.add("aura-discovery-only-row");
    if (!document.getElementById("providerLeadsAiNote")) {
      const note = document.createElement("div");
      note.id = "providerLeadsAiNote";
      note.className = "notice muted compact-notice";
      note.textContent = "Advanced provider-lead collection is AI-assisted. Ask AI Agent for WHOIS/RDAP/provider pivots; this table stays focused on saved Discovery Leads.";
      discoveryPane.insertBefore(note, discoveryPane.querySelector(".scroll"));
    }
  }

  function observeRunData() {
    const refresh = () => {
      const runId = activeRunId();
      if (runId) loadRunData(runId).then(() => {
        renderTopologyView(document.querySelector("[data-topology-view].active")?.dataset.topologyView || "graph");
        renderActiveLogSubtab(document.querySelector("[data-log-subtab].active")?.dataset.logSubtab || "timeline");
      }).catch(() => {});
    };
    refresh();
    setInterval(refresh, 12000);
    document.addEventListener("click", (event) => {
      if (event.target.closest(".result-subtab,.tab,[data-tab],[data-results-view]")) setTimeout(refresh, 250);
    });
  }

  async function loadRunData(runId) {
    if (!runId || runId === "-") return null;
    try {
      const treeData = await fetch(`/api/recon-runs/${encodeURIComponent(runId)}/result-tree`).then((res) => res.ok ? res.json() : null);
      const eventsData = await fetch(`/api/recon-runs/${encodeURIComponent(runId)}/events`).then((res) => res.ok ? res.json() : null).catch(() => null);
      currentRunData = {
        runId,
        tree: treeData?.tree || treeData || {},
        events: eventsData?.events || eventsData || []
      };
    } catch {
      currentRunData = { runId, tree: {}, events: [] };
    }
    return currentRunData;
  }

  function activeRunId() {
    const text = document.getElementById("runId")?.textContent?.trim();
    if (text && text !== "-") return text;
    const loaded = document.getElementById("status")?.textContent?.match(/run\s+(\d+)/i);
    return loaded?.[1] || null;
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
    logsButton.title = "Logs";
    logsButton.innerHTML = `<span class="tab-icon" data-icon="logs"></span><span class="tab-label">Logs</span>`;
    tabs.insertBefore(logsButton, aiButton || runButton || null);
    aiButton?.classList.add("aura-hidden-tab");
    runButton?.classList.add("aura-hidden-tab");

    const logsPanel = document.createElement("section");
    logsPanel.id = "tab-logs";
    logsPanel.className = "tab-panel aura-logs-panel";
    logsPanel.innerHTML = `
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
    document.querySelector(".workspace-main")?.appendChild(logsPanel);

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

  function activateMainPanel(name) {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
  }

  function renderActiveLogSubtab(mode) {
    const node = document.getElementById("logsContent");
    if (!node) return;
    const runData = currentRunData || { tree: {}, events: [] };
    const events = normalizeEvents(runData.events);
    const tree = runData.tree || {};
    const tools = collectToolRows();
    const aiRows = collectTableRows("#aiLogRows tr", ["Time", "Source", "Action", "Evidence"]);
    const correlation = collectCorrelationRows();
    const warnings = events.filter((event) => /warn|error|fail/i.test(`${event.severity} ${event.message}`)).concat(tools.filter((tool) => /fail|error/i.test(tool.Status || "")));
    const views = {
      timeline: timelineHtml(events, tools, aiRows),
      events: cardTable("Run Events", ["Time", "Phase", "Severity", "Source", "Message"], events.map((event) => [event.time, event.phase, event.severity, event.source, event.message])),
      tools: cardTable("Tool Results", ["Tool", "Status", "Exit", "Started", "Logs"], tools.map((tool) => [tool.Tool, tool.Status, tool.Exit, tool.Started, tool.Logs])),
      ai: cardTable("AI Decisions", ["Time", "Source", "Action", "Evidence"], aiRows.map((row) => [row.Time, row.Source, row.Action, row.Evidence])),
      correlation: correlationHtml(correlation, tree),
      errors: cardTable("Warnings & Errors", ["Time/Tool", "Severity/Status", "Source", "Message"], warnings.map((item) => [item.time || item.Tool || "-", item.severity || item.Status || "-", item.source || item.Tool || "-", item.message || item.Logs || "-"]))
    };
    node.innerHTML = views[mode] || views.timeline;
  }

  function normalizeEvents(events) {
    return (Array.isArray(events) ? events : []).map((event) => ({
      time: event.created_at || event.createdAt || event.time || "-",
      phase: event.phase || "-",
      severity: event.severity || "info",
      source: event.source || "-",
      message: event.message || JSON.stringify(event)
    }));
  }

  function collectToolRows() {
    return collectTableRows("#toolLogRows tr", ["Tool", "Status", "Exit", "Started", "Logs"]);
  }

  function collectTableRows(selector, keys) {
    return [...document.querySelectorAll(selector)].map((tr) => {
      const cells = [...tr.children].map((td) => td.textContent.trim());
      if (!cells.length || /no .*loaded|no .*results/i.test(cells.join(" "))) return null;
      return Object.fromEntries(keys.map((key, index) => [key, cells[index] || "-"]));
    }).filter(Boolean);
  }

  function collectCorrelationRows() {
    const nodes = [...document.querySelectorAll("#aiCorrelationTechniques .correlation-technique, #aiCorrelationTechniques .guide-correlation-card, #aiCorrelationTechniques > *")];
    return nodes.map((node) => node.textContent.trim()).filter(Boolean);
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

  function cardTable(title, headers, rows) {
    if (!rows.length) return emptyPane(title, "No data for this log view yet.");
    return `<div class="pane"><h2>${esc(title)}</h2><div class="scroll"><table><thead><tr>${headers.map((head) => `<th>${esc(head)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td>${logCellHtml(headers[index], cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  }

  function logCellHtml(header, cell) {
    const label = String(header || "").toLowerCase();
    if (label === "severity") return window.AuraStatusBadges?.badge(cell, { kind: "severity" }) || esc(cell);
    if (label === "status" || label === "severity/status") return window.AuraStatusBadges?.badge(cell) || esc(cell);
    return esc(cell);
  }

  function correlationHtml(items, tree) {
    const counts = [
      ["Domains", arrayLen(tree.domains)],
      ["Services", arrayLen(tree.services)],
      ["URLs", arrayLen(tree.urls)],
      ["Technologies", arrayLen(tree.technologies)],
      ["Leads", arrayLen(tree.leads || tree.assetLeads)]
    ];
    const cards = counts.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");
    const detail = items.length ? items.map((item) => `<li>${esc(item)}</li>`).join("") : `<li>No AI correlation technique output loaded yet.</li>`;
    return `<div class="pane"><h2>Correlation</h2><div class="topology-metrics compact-metrics">${cards}</div><ul class="aura-correlation-list">${detail}</ul></div>`;
  }

  function setupTopologyEnhancements() {
    const topology = document.getElementById("tab-topology");
    const main = document.querySelector(".topology-main");
    if (!topology || !main || document.getElementById("topologyFullscreen")) return;
    const actions = topology.querySelector(".topology-actions");
    actions?.insertAdjacentHTML("beforeend", `<button id="topologyFullscreen" type="button">Fullscreen</button>`);
    main.insertAdjacentHTML("beforeend", `<button id="topologyFullscreenClose" type="button" class="topology-fullscreen-close">Close</button>`);
    document.getElementById("topologyFullscreen")?.addEventListener("click", openTopologyFullscreen);
    document.getElementById("topologyFullscreenClose")?.addEventListener("click", closeTopologyFullscreen);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeTopologyFullscreen(); });

    const shell = topology.querySelector(".topology-shell");
    if (shell && !document.getElementById("topologyDashboard")) {
      shell.insertAdjacentHTML("beforebegin", `
        <div class="topology-view-tabs">
          <button type="button" class="active" data-topology-view="graph">Graph</button>
          <button type="button" data-topology-view="dashboard">Dashboard</button>
          <button type="button" data-topology-view="sources">Sources</button>
          <button type="button" data-topology-view="technologies">Technologies</button>
        </div>
        <div id="topologyDashboard" class="topology-dashboard hidden"></div>
      `);
      document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-topology-view]");
        if (!button) return;
        const view = button.dataset.topologyView;
        document.querySelectorAll("[data-topology-view]").forEach((node) => node.classList.toggle("active", node === button));
        document.getElementById("topologyDashboard")?.classList.toggle("hidden", view === "graph");
        shell.classList.toggle("hidden", view !== "graph");
        renderTopologyView(view);
        if (view === "graph") window.AuraTopology?.render();
      });
    }
  }

  function renderTopologyView(view = "graph") {
    const node = document.getElementById("topologyDashboard");
    if (!node || view === "graph") return;
    const tree = currentRunData?.tree || {};
    const domains = ensureArray(tree.domains);
    const services = ensureArray(tree.services);
    const urls = ensureArray(tree.urls);
    const tech = ensureArray(tree.technologies).length ? ensureArray(tree.technologies) : summarizeTech(services);
    if (!domains.length && !services.length && !urls.length && !tech.length) {
      node.innerHTML = emptyPane("Topology analytics", "No run data loaded for this topology view. Load a run from Results first.");
      return;
    }
    const sourceCounts = countBy(domains, (item) => item.source || "unknown");
    const statusCounts = countBy(services, (item) => String(item.statusCode || item.status_code || "none"));
    const hostCounts = countBy(urls, (item) => item.host || safeHost(item.url) || "unknown");
    const techCounts = new Map(tech.map((item) => [item.name || item.technology || String(item), Number(item.count || item.serviceCount || 1)]));
    const blocks = {
      dashboard: [metricCards({ domains, services, urls, tech }), bars("HTTP status", statusCounts), bars("Top technologies", techCounts), bars("Top URL hosts", hostCounts)],
      sources: [bars("Domain sources", sourceCounts), bars("Service sources", countBy(services, (item) => item.source || "unknown")), bars("URL sources", countBy(urls, (item) => item.source || "unknown"))],
      technologies: [bars("Top technologies", techCounts), bars("Technology hosts", countBy(services.flatMap((service) => (service.technologies || []).map((techName) => ({ techName }))), (item) => item.techName || "unknown"))]
    }[view] || [];
    node.innerHTML = blocks.join("");
  }

  function openTopologyFullscreen() {
    document.body.classList.add("topology-fullscreen-mode");
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.AuraTopology?.render(), 50);
  }

  function closeTopologyFullscreen() {
    if (!document.body.classList.contains("topology-fullscreen-mode")) return;
    document.body.classList.remove("topology-fullscreen-mode");
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.AuraTopology?.render(), 50);
  }

  function metricCards({ domains, services, urls, tech }) {
    return `<div class="topology-metrics pane">${metric("Domains", domains.length)}${metric("Services", services.length)}${metric("URLs", urls.length)}${metric("Tech", tech.length)}</div>`;
  }

  function metric(label, value) { return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function bars(title, map) {
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    const max = Math.max(1, ...rows.map((row) => row[1]));
    return `<div class="pane topology-chart"><h2>${esc(title)}</h2>${rows.length ? rows.map(([label, value]) => `<div class="chart-row"><span>${esc(label)}</span><b style="width:${Math.max(4, (value / max) * 100)}%"></b><em>${esc(value)}</em></div>`).join("") : `<p class="muted">No data.</p>`}</div>`;
  }

  function countBy(items, fn) {
    const map = new Map();
    for (const item of items || []) { const key = fn(item); map.set(key, (map.get(key) || 0) + 1); }
    return map;
  }
  function summarizeTech(services) {
    const map = new Map();
    for (const service of services || []) for (const tech of service.technologies || []) map.set(tech, (map.get(tech) || 0) + 1);
    return [...map.entries()].map(([name, count]) => ({ name, count }));
  }
  function ensureArray(value) { return Array.isArray(value) ? value : []; }
  function arrayLen(value) { return ensureArray(value).length; }
  function safeHost(value) { try { return new URL(value).host; } catch { return ""; } }
  function emptyPane(title, message) { return `<div class="pane"><h2>${esc(title)}</h2><p class="muted">${esc(message)}</p></div>`; }

  function injectStyles() {
    if (document.getElementById("aura-workspace-layout-style")) return;
    const style = document.createElement("style");
    style.id = "aura-workspace-layout-style";
    style.textContent = `
      .aura-hidden-provider-leads, .aura-hidden-tab { display: none !important; }
      .aura-discovery-only-row { grid-template-columns: 1fr !important; }
      .aura-discovery-leads-wide .scroll { max-height: none !important; overflow-y: visible !important; overflow-x: auto; }
      .aura-discovery-leads-wide table { table-layout: fixed; min-width: 1120px; }
      .aura-discovery-leads-wide th, .aura-discovery-leads-wide td { padding: 5px 8px; }
      .logs-subtabs, .topology-view-tabs { display: flex; gap: 5px; align-items: center; margin: 0 0 8px; flex-wrap: wrap; }
      .logs-subtabs button, .topology-view-tabs button { width: auto; margin: 0; padding: 5px 9px; border-radius: 999px; background: rgba(20, 18, 34, .72); }
      .logs-subtabs button.active, .topology-view-tabs button.active { color: #071017; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
      .aura-log-content .scroll { max-height: calc(100vh - 190px); }
      .aura-timeline { display: grid; gap: 7px; }
      .aura-timeline-item { border: 1px solid var(--line); border-radius: 10px; padding: 8px; background: rgba(10,14,20,.36); }
      .aura-timeline-item strong { display: block; margin-bottom: 3px; }
      .aura-timeline-item span, .aura-timeline-item p { color: var(--muted); margin: 0; font-size: 12px; }
      .aura-correlation-list { margin: 10px 0 0; padding-left: 18px; color: var(--muted); }
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
      body.topology-fullscreen-mode .topology-fullscreen-close { display: inline-flex; position: absolute; top: 12px; right: 12px; z-index: 2; }
      @media (max-width: 1000px) { .topology-dashboard, .topology-metrics { grid-template-columns: 1fr; } .chart-row { grid-template-columns: 120px 1fr 42px; } }
    `;
    document.head.appendChild(style);
  }

  function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
