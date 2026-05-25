"use strict";

(function initAuraWorkspaceLayout() {
  function boot() {
    injectStyles();
    collapseAdvancedProviderLeads();
    setupLogsTab();
    setupTopologyEnhancements();
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
      note.textContent = "Advanced provider-lead collection is AI-assisted now. Use AI Agent or Guide to ask for WHOIS/RDAP, provider pivots, and correlation next steps; this table keeps the saved Discovery Leads visible.";
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

    ensureLogSubtabs(document.getElementById("tab-runs"), "activity");
    ensureLogSubtabs(document.getElementById("tab-ai-log"), "ai");

    logsButton.addEventListener("click", (event) => {
      event.preventDefault();
      activateLogPanel("activity");
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-log-subtab]");
      if (!button) return;
      event.preventDefault();
      activateLogPanel(button.dataset.logSubtab);
    });

    const observer = new MutationObserver(() => {
      if (document.getElementById("tab-runs")?.classList.contains("active")) markLogsActive("activity");
      if (document.getElementById("tab-ai-log")?.classList.contains("active")) markLogsActive("ai");
    });
    [document.getElementById("tab-runs"), document.getElementById("tab-ai-log")].filter(Boolean).forEach((panel) => observer.observe(panel, { attributes: true, attributeFilter: ["class"] }));
  }

  function ensureLogSubtabs(panel, active) {
    if (!panel || panel.querySelector(".logs-subtabs")) return;
    panel.insertAdjacentHTML("afterbegin", `
      <div class="logs-subtabs">
        <button type="button" data-log-subtab="activity">Activity</button>
        <button type="button" data-log-subtab="events">Events</button>
        <button type="button" data-log-subtab="ai">AI Correlation</button>
        <button type="button" data-log-subtab="techniques">Techniques</button>
        <button type="button" data-log-subtab="tool-logs">Tool Logs</button>
        <button type="button" data-log-subtab="delta">Delta</button>
      </div>
    `);
    panel.querySelector(`[data-log-subtab="${active}"]`)?.classList.add("active");
  }

  function activateLogPanel(mode) {
    const tabName = ["ai", "techniques"].includes(mode) ? "ai-log" : mode === "tool-logs" || mode === "delta" ? "results" : "runs";
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "logs"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${tabName}`));
    markLogsActive(mode);
    if (mode === "tool-logs") clickResultSubtab("tool-logs");
    if (mode === "delta") clickResultSubtab("delta");
    if (mode === "events") document.getElementById("events")?.scrollIntoView({ block: "start" });
    if (mode === "techniques") document.getElementById("aiCorrelationTechniques")?.scrollIntoView({ block: "start" });
  }

  function markLogsActive(mode) {
    document.querySelectorAll('[data-tab="logs"]').forEach((tab) => tab.classList.add("active"));
    document.querySelectorAll('[data-tab="ai-log"], [data-tab="runs"]').forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll("[data-log-subtab]").forEach((button) => button.classList.toggle("active", button.dataset.logSubtab === mode));
  }

  function clickResultSubtab(name) {
    const button = document.querySelector(`[data-results-view="${name}"]`);
    button?.click();
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
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeTopologyFullscreen();
    });

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
      renderTopologyDashboard();
      document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-topology-view]");
        if (!button) return;
        const view = button.dataset.topologyView;
        document.querySelectorAll("[data-topology-view]").forEach((node) => node.classList.toggle("active", node === button));
        document.getElementById("topologyDashboard")?.classList.toggle("hidden", view === "graph");
        shell.classList.toggle("hidden", view !== "graph");
        renderTopologyDashboard(view);
        if (view === "graph") window.AuraTopology?.render();
      });
    }
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

  async function renderTopologyDashboard(view = "dashboard") {
    const node = document.getElementById("topologyDashboard");
    if (!node || node.classList.contains("hidden")) return;
    const runId = document.getElementById("runId")?.textContent?.trim();
    if (!runId || runId === "-") {
      node.innerHTML = `<div class="pane"><h2>No run loaded</h2><p class="muted">Load a run to see topology charts.</p></div>`;
      return;
    }
    node.innerHTML = `<div class="pane"><h2>Loading topology analytics...</h2></div>`;
    try {
      const data = await fetch(`/api/recon-runs/${encodeURIComponent(runId)}/result-tree`).then((res) => res.json());
      const tree = data.tree || {};
      const domains = tree.domains || [];
      const services = tree.services || [];
      const urls = tree.urls || [];
      const tech = tree.technologies || summarizeTech(services);
      node.innerHTML = dashboardHtml({ view, domains, services, urls, tech });
    } catch (error) {
      node.innerHTML = `<div class="pane"><h2>Topology analytics unavailable</h2><p class="muted">${esc(error.message)}</p></div>`;
    }
  }

  function dashboardHtml({ view, domains, services, urls, tech }) {
    const sourceCounts = countBy(domains, (item) => item.source || "unknown");
    const statusCounts = countBy(services, (item) => String(item.statusCode || "none"));
    const hostCounts = countBy(urls, (item) => item.host || "unknown");
    const techCounts = new Map((tech || []).map((item) => [item.name || item.technology || "unknown", Number(item.count || 1)]));
    const blocks = {
      dashboard: [metricCards({ domains, services, urls, tech }), bars("HTTP status", statusCounts), bars("Top technologies", techCounts), bars("Top URL hosts", hostCounts)],
      sources: [bars("Domain sources", sourceCounts), bars("HTTP status", statusCounts)],
      technologies: [bars("Top technologies", techCounts), bars("Service hosts", countBy(services, (item) => item.host || "unknown"))]
    }[view] || [];
    return blocks.join("");
  }

  function metricCards({ domains, services, urls, tech }) {
    return `
      <div class="topology-metrics pane">
        ${metric("Domains", domains.length)}
        ${metric("Services", services.length)}
        ${metric("URLs", urls.length)}
        ${metric("Tech", tech.length)}
      </div>
    `;
  }

  function metric(label, value) {
    return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function bars(title, map) {
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const max = Math.max(1, ...rows.map((row) => row[1]));
    return `
      <div class="pane topology-chart"><h2>${esc(title)}</h2>
        ${rows.length ? rows.map(([label, value]) => `<div class="chart-row"><span>${esc(label)}</span><b style="width:${Math.max(4, (value / max) * 100)}%"></b><em>${esc(value)}</em></div>`).join("") : `<p class="muted">No data.</p>`}
      </div>
    `;
  }

  function countBy(items, fn) {
    const map = new Map();
    for (const item of items || []) {
      const key = fn(item);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }

  function summarizeTech(services) {
    const map = new Map();
    for (const service of services || []) {
      for (const tech of service.technologies || []) map.set(tech, (map.get(tech) || 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count }));
  }

  function injectStyles() {
    if (document.getElementById("aura-workspace-layout-style")) return;
    const style = document.createElement("style");
    style.id = "aura-workspace-layout-style";
    style.textContent = `
      .aura-hidden-provider-leads, .aura-hidden-tab { display: none !important; }
      .aura-discovery-only-row { grid-template-columns: 1fr !important; }
      .aura-discovery-leads-wide .scroll { max-height: calc(100vh - 250px); }
      .aura-discovery-leads-wide table { table-layout: fixed; min-width: 1120px; }
      .aura-discovery-leads-wide th, .aura-discovery-leads-wide td { padding: 4px 7px; }
      .aura-discovery-leads-wide th:nth-child(1), .aura-discovery-leads-wide td:nth-child(1) { width: 230px; }
      .aura-discovery-leads-wide th:nth-child(2), .aura-discovery-leads-wide td:nth-child(2) { width: 170px; }
      .aura-discovery-leads-wide th:nth-child(3), .aura-discovery-leads-wide td:nth-child(3) { width: 90px; }
      .aura-discovery-leads-wide th:nth-child(4), .aura-discovery-leads-wide td:nth-child(4) { width: 70px; }
      .aura-discovery-leads-wide th:nth-child(5), .aura-discovery-leads-wide td:nth-child(5) { width: auto; }
      .aura-discovery-leads-wide th:nth-child(6), .aura-discovery-leads-wide td:nth-child(6) { width: 130px; }

      .logs-subtabs, .topology-view-tabs { display: flex; gap: 5px; align-items: center; margin: 0 0 8px; flex-wrap: wrap; }
      .logs-subtabs button, .topology-view-tabs button { width: auto; margin: 0; padding: 5px 9px; border-radius: 999px; background: rgba(20, 18, 34, .72); }
      .logs-subtabs button.active, .topology-view-tabs button.active { color: #071017; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }

      .topology-dashboard { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .topology-dashboard.hidden, .topology-shell.hidden { display: none !important; }
      .topology-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
      .topology-metrics div { border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: rgba(10,14,20,.38); }
      .topology-metrics span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; }
      .topology-metrics strong { display: block; font-size: 24px; }
      .topology-chart h2 { margin-bottom: 10px; }
      .chart-row { display: grid; grid-template-columns: 170px 1fr 52px; gap: 8px; align-items: center; margin: 5px 0; font-size: 12px; }
      .chart-row b { display: block; height: 11px; min-width: 4px; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
      .chart-row em { color: var(--muted); font-style: normal; text-align: right; font-variant-numeric: tabular-nums; }
      .topology-fullscreen-close { display: none; }
      body.topology-fullscreen-mode { overflow: hidden; }
      body.topology-fullscreen-mode .topology-main { position: fixed; inset: 10px; z-index: 9998; padding: 12px; background: rgba(10, 14, 20, .98); border: 1px solid var(--accent); box-shadow: 0 0 0 9999px rgba(0,0,0,.72); }
      body.topology-fullscreen-mode #topologyCanvas { height: calc(100vh - 120px) !important; min-height: 0; }
      body.topology-fullscreen-mode .topology-fullscreen-close { display: inline-flex; position: absolute; top: 12px; right: 12px; z-index: 2; }
      @media (max-width: 1000px) {
        .topology-dashboard, .topology-metrics { grid-template-columns: 1fr; }
        .chart-row { grid-template-columns: 120px 1fr 42px; }
      }
    `;
    document.head.appendChild(style);
  }

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
