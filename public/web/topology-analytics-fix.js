"use strict";

(function initAuraTopologyAnalyticsFix() {
  function boot() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-topology-view]");
      if (!button) return;
      setTimeout(() => renderTopologyAnalytics(button.dataset.topologyView), 80);
    });
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-tab="topology"]')) {
        setTimeout(() => {
          const active = document.querySelector("[data-topology-view].active")?.dataset.topologyView || "graph";
          if (active !== "graph") renderTopologyAnalytics(active);
        }, 120);
      }
    });
  }

  async function renderTopologyAnalytics(view) {
    if (!view || view === "graph") return;
    const dashboard = document.getElementById("topologyDashboard");
    if (!dashboard || dashboard.classList.contains("hidden")) return;
    const runId = activeRunId();
    if (!runId) {
      dashboard.innerHTML = pane("Topology analytics", "Load a run before opening topology analytics.");
      return;
    }
    dashboard.innerHTML = pane("Topology analytics", "Loading run data...");
    try {
      const data = await fetchTopologyData(runId);
      const html = topologyHtml(view, data);
      dashboard.innerHTML = html || pane("Topology analytics", "No data available for this view yet.");
    } catch (error) {
      dashboard.innerHTML = pane("Topology analytics", `Unable to load topology analytics: ${error.message}`);
    }
  }

  function activeRunId() {
    const visibleRun = document.getElementById("runId")?.textContent?.trim();
    if (visibleRun && visibleRun !== "-") return visibleRun;
    const status = document.getElementById("status")?.textContent || "";
    return status.match(/run\s+(\d+)/i)?.[1] || null;
  }

  async function fetchTopologyData(runId) {
    const urls = {
      tree: `/api/recon-runs/${encodeURIComponent(runId)}/result-tree`,
      domains: `/api/recon-runs/${encodeURIComponent(runId)}/domains`,
      services: `/api/recon-runs/${encodeURIComponent(runId)}/http-services`,
      urls: `/api/recon-runs/${encodeURIComponent(runId)}/urls`,
      technologies: `/api/recon-runs/${encodeURIComponent(runId)}/technologies`,
      counts: `/api/recon-runs/${encodeURIComponent(runId)}/counts`
    };
    const [tree, domains, services, urlRows, technologies, counts] = await Promise.all(Object.values(urls).map((url) => fetchJson(url)));
    const flatTree = flattenResultTree(tree?.tree || {});
    return {
      runId,
      domains: normalizeArray(domains?.domains).length ? normalizeArray(domains.domains) : flatTree.domains,
      services: normalizeArray(services?.services).length ? normalizeArray(services.services) : flatTree.services,
      urls: normalizeArray(urlRows?.urls).length ? normalizeArray(urlRows.urls) : flatTree.urls,
      technologies: normalizeArray(technologies?.technologies).length ? normalizeArray(technologies.technologies) : flatTree.technologies,
      counts: counts?.counts || tree?.tree?.counts || tree?.tree?.summary || {}
    };
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.json();
  }

  function flattenResultTree(tree) {
    const domains = [];
    const services = [];
    const urls = [];
    const techMap = new Map();
    for (const root of normalizeArray(tree.roots)) {
      for (const child of normalizeArray(root.children)) {
        domains.push({
          domain: child.domain,
          root_domain: root.domain,
          kind: child.kind,
          source: normalizeArray(child.sources).join(","),
          status: child.scopeStatus,
          first_seen_at: child.firstSeenAt,
          last_seen_at: child.lastSeenAt
        });
        for (const service of normalizeArray(child.services)) {
          services.push({ ...service, host: service.host || child.domain, source: service.source || normalizeArray(child.sources).join(",") });
        }
        for (const url of normalizeArray(child.urls)) {
          urls.push({ ...url, host: url.host || child.domain, source: url.source || normalizeArray(child.sources).join(",") });
        }
        for (const name of normalizeArray(child.technologies)) {
          const current = techMap.get(name) || { name, count: 0, hostCount: 0, hosts: new Set() };
          current.count += 1;
          current.hosts.add(child.domain);
          current.hostCount = current.hosts.size;
          techMap.set(name, current);
        }
      }
    }
    return { domains, services, urls, technologies: [...techMap.values()] };
  }

  function topologyHtml(view, data) {
    const domains = data.domains;
    const services = data.services;
    const urls = data.urls;
    const technologies = data.technologies;
    const sourceCounts = countCsv(domains, (item) => item.source || item.sources || "unknown");
    const serviceSourceCounts = countCsv(services, (item) => item.source || "unknown");
    const urlSourceCounts = countCsv(urls, (item) => item.source || "unknown");
    const statusCounts = countBy(services, (item) => String(item.statusCode || item.status_code || "none"));
    const hostCounts = countBy(urls, (item) => item.host || safeHost(item.url) || "unknown");
    const techCounts = new Map(technologies.map((item) => [item.name || item.technology || String(item), Number(item.count || item.serviceCount || 1)]));
    const serviceHostCounts = countBy(services, (item) => item.host || safeHost(item.url) || "unknown");

    if (view === "dashboard") {
      return [
        metrics({ domains, services, urls, technologies }),
        bars("HTTP status", statusCounts),
        bars("Top technologies", techCounts),
        bars("Top URL hosts", hostCounts)
      ].join("");
    }
    if (view === "sources") {
      return [
        bars("Domain sources", sourceCounts),
        bars("Service sources", serviceSourceCounts),
        bars("URL sources", urlSourceCounts),
        bars("HTTP status by source context", statusCounts)
      ].join("");
    }
    if (view === "technologies") {
      return [
        bars("Top technologies", techCounts),
        bars("Service hosts", serviceHostCounts),
        table("Technology summary", ["Technology", "Services", "Hosts"], technologies.slice(0, 30).map((item) => [item.name || item.technology || "unknown", item.count || item.serviceCount || 1, item.hostCount || "-"]))
      ].join("");
    }
    return "";
  }

  function metrics({ domains, services, urls, technologies }) {
    return `<div class="topology-metrics pane">${metric("Domains", domains.length)}${metric("Services", services.length)}${metric("URLs", urls.length)}${metric("Tech", technologies.length)}</div>`;
  }

  function metric(label, value) {
    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function bars(title, map) {
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    const max = Math.max(1, ...rows.map((row) => row[1]));
    return `<div class="pane topology-chart"><h2>${escapeHtml(title)}</h2>${rows.length ? rows.map(([label, value]) => `<div class="chart-row"><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><b style="width:${Math.max(4, (value / max) * 100)}%"></b><em>${escapeHtml(value)}</em></div>`).join("") : `<p class="muted">No data.</p>`}</div>`;
  }

  function table(title, headers, rows) {
    return `<div class="pane topology-chart"><h2>${escapeHtml(title)}</h2><div class="scroll"><table><thead><tr>${headers.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  }

  function pane(title, message) {
    return `<div class="pane"><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(message)}</p></div>`;
  }

  function countBy(items, fn) {
    const map = new Map();
    for (const item of normalizeArray(items)) {
      const key = fn(item) || "unknown";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }

  function countCsv(items, fn) {
    const map = new Map();
    for (const item of normalizeArray(items)) {
      const values = String(fn(item) || "unknown").split(",").map((part) => part.trim()).filter(Boolean);
      for (const value of values.length ? values : ["unknown"]) map.set(value, (map.get(value) || 0) + 1);
    }
    return map;
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeHost(value) {
    try { return new URL(value).host; } catch { return ""; }
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
