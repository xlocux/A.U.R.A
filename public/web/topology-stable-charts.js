"use strict";

(function initAuraTopologyStableCharts() {
  function boot() {
    document.addEventListener("click", onTopologyClick, true);
  }

  function onTopologyClick(event) {
    const button = event.target.closest("[data-topology-view]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const view = button.dataset.topologyView || "graph";
    document.querySelectorAll("[data-topology-view]").forEach((node) => node.classList.toggle("active", node === button));
    const shell = document.querySelector(".topology-shell");
    const panel = document.getElementById("topologyDashboard");
    if (view === "graph") {
      shell?.classList.remove("hidden");
      panel?.classList.add("hidden");
      setTimeout(() => window.AuraTopology?.render?.(), 50);
      return;
    }
    shell?.classList.add("hidden");
    panel?.classList.remove("hidden");
    render(view);
  }

  async function render(view) {
    const panel = document.getElementById("topologyDashboard");
    const runId = document.getElementById("runId")?.textContent?.trim();
    if (!panel) return;
    if (!runId || runId === "-") {
      panel.innerHTML = card("Topology analytics", "Load a run from Results before opening this view.");
      return;
    }
    panel.innerHTML = card("Topology analytics", "Loading charts...");
    try {
      const data = await loadRun(runId);
      panel.innerHTML = html(view, data) || card("Topology analytics", "No chart data available yet.");
    } catch (error) {
      panel.innerHTML = card("Topology analytics", `Unable to load charts: ${error.message}`);
    }
  }

  async function loadRun(runId) {
    const [domains, services, urls, tech, tree] = await Promise.all([
      get(`/api/recon-runs/${runId}/domains`),
      get(`/api/recon-runs/${runId}/http-services`),
      get(`/api/recon-runs/${runId}/urls`),
      get(`/api/recon-runs/${runId}/technologies`),
      get(`/api/recon-runs/${runId}/result-tree`)
    ]);
    const flat = flatten(tree?.tree || {});
    return {
      domains: arr(domains?.domains).length ? arr(domains.domains) : flat.domains,
      services: arr(services?.services).length ? arr(services.services) : flat.services,
      urls: arr(urls?.urls).length ? arr(urls.urls) : flat.urls,
      tech: arr(tech?.technologies).length ? arr(tech.technologies) : flat.tech
    };
  }

  async function get(url) {
    const response = await fetch(url);
    return response.ok ? response.json() : null;
  }

  function flatten(tree) {
    const domains = [];
    const services = [];
    const urls = [];
    const tech = new Map();
    for (const root of arr(tree.roots)) for (const child of arr(root.children)) {
      const source = arr(child.sources).join(",") || "unknown";
      domains.push({ domain: child.domain, source, kind: child.kind, status: child.scopeStatus });
      for (const service of arr(child.services)) services.push({ ...service, host: service.host || child.domain, source: service.source || source });
      for (const item of arr(child.urls)) urls.push({ ...item, host: item.host || child.domain, source: item.source || source });
      for (const name of arr(child.technologies)) {
        const item = tech.get(name) || { name, count: 0, hosts: new Set() };
        item.count += 1; item.hosts.add(child.domain); tech.set(name, item);
      }
    }
    return { domains, services, urls, tech: [...tech.values()].map((item) => ({ name: item.name, count: item.count, hostCount: item.hosts.size })) };
  }

  function html(view, data) {
    const tech = new Map(data.tech.map((item) => [item.name || item.technology || String(item), Number(item.count || item.serviceCount || 1)]));
    if (view === "dashboard") return [metrics(data), bars("HTTP status", count(data.services, (x) => x.statusCode || x.status_code || "none")), bars("Top technologies", tech), bars("URL hosts", count(data.urls, (x) => x.host || host(x.url) || "unknown"))].join("");
    if (view === "sources") return [bars("Domain sources", countCsv(data.domains, (x) => x.source || "unknown")), bars("Service sources", countCsv(data.services, (x) => x.source || "unknown")), bars("URL sources", countCsv(data.urls, (x) => x.source || "unknown"))].join("");
    if (view === "technologies") return [bars("Top technologies", tech), bars("Service hosts", count(data.services, (x) => x.host || host(x.url) || "unknown")), table(data.tech)].join("");
    return "";
  }

  function metrics(data) {
    return `<div class="topology-metrics pane">${metric("Domains", data.domains.length)}${metric("Services", data.services.length)}${metric("URLs", data.urls.length)}${metric("Tech", data.tech.length)}</div>`;
  }
  function metric(label, value) { return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function bars(title, map) {
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    const max = Math.max(1, ...rows.map((x) => x[1]));
    return `<div class="pane topology-chart"><h2>${esc(title)}</h2>${rows.length ? rows.map(([label, value]) => `<div class="chart-row"><span>${esc(label)}</span><b style="width:${Math.max(5, value / max * 100)}%"></b><em>${esc(value)}</em></div>`).join("") : `<p class="muted">No data.</p>`}</div>`;
  }
  function table(items) { return `<div class="pane topology-chart"><h2>Technology summary</h2><div class="scroll"><table><thead><tr><th>Technology</th><th>Services</th><th>Hosts</th></tr></thead><tbody>${items.slice(0, 40).map((x) => `<tr><td>${esc(x.name || x.technology || "unknown")}</td><td>${esc(x.count || x.serviceCount || 1)}</td><td>${esc(x.hostCount || "-")}</td></tr>`).join("")}</tbody></table></div></div>`; }
  function card(title, text) { return `<div class="pane"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p></div>`; }
  function count(items, fn) { const m = new Map(); for (const x of arr(items)) { const k = String(fn(x)); m.set(k, (m.get(k) || 0) + 1); } return m; }
  function countCsv(items, fn) { const m = new Map(); for (const x of arr(items)) for (const k of String(fn(x)).split(",").map((p) => p.trim()).filter(Boolean)) m.set(k, (m.get(k) || 0) + 1); return m; }
  function arr(value) { return Array.isArray(value) ? value : []; }
  function host(value) { try { return new URL(value).host; } catch { return ""; } }
  function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
