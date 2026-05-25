"use strict";

(function initAuraTopologyAnalyticsResilient() {
  let serial = 0;

  function boot() {
    document.addEventListener("click", handleTopologyViewClick, true);
    document.addEventListener("click", handleTopologyTabClick, true);
  }

  function handleTopologyViewClick(event) {
    const button = event.target.closest("[data-topology-view]");
    if (!button) return;
    const view = button.dataset.topologyView || "graph";
    if (view === "graph") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    document.querySelectorAll("[data-topology-view]").forEach((node) => node.classList.toggle("active", node === button));
    document.querySelector(".topology-shell")?.classList.add("hidden");
    document.getElementById("topologyDashboard")?.classList.remove("hidden");
    render(view);
  }

  function handleTopologyTabClick(event) {
    if (!event.target.closest('[data-tab="topology"]')) return;
    setTimeout(() => {
      const view = activeView();
      if (view !== "graph") render(view);
    }, 120);
  }

  async function render(view) {
    const panel = document.getElementById("topologyDashboard");
    if (!panel) return;
    const runId = activeRunId();
    const current = ++serial;
    if (!runId) {
      panel.innerHTML = pane("Topology analytics", "Load a run from Results before opening this view.");
      return;
    }
    panel.innerHTML = pane("Topology analytics", "Loading charts...");
    const data = await loadData(runId);
    if (current !== serial || activeView() !== view) return;
    panel.innerHTML = viewHtml(view, data) || pane("Topology analytics", "No chart data available yet.");
  }

  async function loadData(runId) {
    const id = encodeURIComponent(runId);
    const [domainsPayload, servicesPayload, urlsPayload, techPayload, treePayload] = await Promise.all([
      fetchJson(`/api/recon-runs/${id}/domains`),
      fetchJson(`/api/recon-runs/${id}/http-services`),
      fetchJson(`/api/recon-runs/${id}/urls`),
      fetchJson(`/api/recon-runs/${id}/technologies`),
      fetchJson(`/api/recon-runs/${id}/result-tree`)
    ]);
    const flat = flattenTree(treePayload?.tree || {});
    return {
      domains: array(domainsPayload?.domains).length ? array(domainsPayload.domains) : flat.domains,
      services: array(servicesPayload?.services).length ? array(servicesPayload.services) : flat.services,
      urls: array(urlsPayload?.urls).length ? array(urlsPayload.urls) : flat.urls,
      technologies: array(techPayload?.technologies).length ? array(techPayload.technologies) : flat.technologies
    };
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  function flattenTree(tree) {
    const domains = [];
    const services = [];
    const urls = [];
    const technologies = new Map();
    for (const root of array(tree.roots)) {
      for (const child of array(root.children)) {
        const source = array(child.sources).join(",") || "unknown";
        domains.push({ domain: child.domain, rootDomain: root.domain, kind: child.kind, source });
        for (const service of array(child.services)) services.push({ ...service, host: service.host || child.domain, source: service.source || source });
        for (const url of array(child.urls)) urls.push({ ...url, host: url.host || child.domain, source: url.source || source });
        for (const name of array(child.technologies)) {
          const current = technologies.get(name) || { name, count: 0, hosts: new Set() };
          current.count += 1;
          current.hosts.add(child.domain);
          technologies.set(name, current);
        }
      }
    }
    return {
      domains,
      services,
      urls,
      technologies: [...technologies.values()].map((item) => ({ name: item.name, count: item.count, hostCount: item.hosts.size }))
    };
  }

  function viewHtml(view, data) {
    const techCounts = new Map(data.technologies.map((item) => [item.name || item.technology || String(item), Number(item.count || item.serviceCount || 1)]));
    if (view === "dashboard") return [
      metrics(data),
      bars("HTTP status", count(data.services, (item) => item.statusCode || item.status_code || "none")),
      bars("Top technologies", techCounts),
      bars("URL hosts", count(data.urls, (item) => item.host || safeHost(item.url) || "unknown"))
    ].join("");
    if (view === "sources") return [
      bars("Domain sources", countCsv(data.domains, (item) => item.source || "unknown")),
      bars("Service sources", countCsv(data.services, (item) => item.source || "unknown")),
      bars("URL sources", countCsv(data.urls, (item) => item.source || "unknown"))
    ].join("");
    if (view === "technologies") return [
      bars("Top technologies", techCounts),
      bars("Service hosts", count(data.services, (item) => item.host || safeHost(item.url) || "unknown")),
      table(data.technologies)
    ].join("");
    return "";
  }

  function metrics(data) {
    return `<div class="topology-metrics pane">${metric("Domains", data.domains.length)}${metric("Services", data.services.length)}${metric("URLs", data.urls.length)}${metric("Tech", data.technologies.length)}</div>`;
  }

  function metric(label, value) {
    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function bars(title, map) {
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    const max = Math.max(1, ...rows.map((row) => row[1]));
    return `<div class="pane topology-chart"><h2>${escapeHtml(title)}</h2>${rows.length ? rows.map(([label, value]) => `<div class="chart-row"><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><b style="width:${Math.max(5, value / max * 100)}%"></b><em>${escapeHtml(value)}</em></div>`).join("") : `<p class="muted">No data.</p>`}</div>`;
  }

  function table(items) {
    return `<div class="pane topology-chart"><h2>Technology summary</h2><div class="scroll"><table><thead><tr><th>Technology</th><th>Services</th><th>Hosts</th></tr></thead><tbody>${array(items).slice(0, 40).map((item) => `<tr><td>${escapeHtml(item.name || item.technology || "unknown")}</td><td>${escapeHtml(item.count || item.serviceCount || 1)}</td><td>${escapeHtml(item.hostCount || "-")}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  function pane(title, text) {
    return `<div class="pane"><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(text)}</p></div>`;
  }

  function count(items, fn) {
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
      const parts = String(fn(item) || "unknown").split(",").map((part) => part.trim()).filter(Boolean);
      for (const key of parts.length ? parts : ["unknown"]) map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }

  function activeRunId() {
    const runText = document.getElementById("runId")?.textContent?.trim();
    if (runText && runText !== "-") return runText;
    return (document.getElementById("status")?.textContent || "").match(/run\s+(\d+)/i)?.[1] || "";
  }

  function activeView() {
    return document.querySelector("[data-topology-view].active")?.dataset.topologyView || "graph";
  }

  function safeHost(value) {
    try { return new URL(value).host; } catch { return ""; }
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  window.AuraTopologyAnalytics = { render };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
