"use strict";

(function initAuraTopologyView() {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "aura.topology.smart";
  let frame = null;
  let pulse = 0;
  let graph = { nodes: [], edges: [] };
  let data = { domains: [], services: [], urls: [], screenshots: [], technologies: [] };
  let view = { zoom: 1, offsetX: 0, offsetY: 0 };
  let drag = null;
  let selectedNodeId = null;
  let options = loadOptions();

  injectStylesheet("/topology-smart.css", "aura-topology-smart-css");

  function bind() {
    upgradeControls();
    const canvas = $("topologyCanvas");
    canvas?.addEventListener("click", selectNode);
    canvas?.addEventListener("wheel", onWheel, { passive: false });
    canvas?.addEventListener("pointerdown", startPan);
    canvas?.addEventListener("pointermove", movePan);
    canvas?.addEventListener("pointerup", endPan);
    canvas?.addEventListener("pointerleave", endPan);
    $("fitTopology")?.addEventListener("click", reset);
    $("pulseTopology")?.addEventListener("click", render);
    $("zoomTopologyIn")?.addEventListener("click", () => zoom(0.15));
    $("zoomTopologyOut")?.addEventListener("click", () => zoom(-0.15));
    ["topologyDomains", "topologyServices", "topologyArtifacts", "topologyCandidates"].forEach((id) => $(id)?.addEventListener("change", update));
    ["topologySearch", "topologyFocus", "topologyLayout"].forEach((id) => $(id)?.addEventListener("input", handleOptionChange));
    $("topologyResetSmart")?.addEventListener("click", () => {
      options = { query: "", focus: "all", layout: "smart" };
      saveOptions();
      syncControls();
      reset();
    });
    syncControls();
    update();
    if (!frame) animate();
  }

  function upgradeControls() {
    const main = document.querySelector(".topology-main");
    if (!main || $("topologySearch")) return;
    const head = main.querySelector(".topology-head");
    head?.insertAdjacentHTML("afterend", `
      <div class="topology-smartbar">
        <input id="topologySearch" type="search" placeholder="Search domain, URL, technology, title">
        <select id="topologyFocus">
          <option value="all">All nodes</option>
          <option value="live">Live services</option>
          <option value="tech">Technologies</option>
          <option value="new">New/high-signal</option>
        </select>
        <select id="topologyLayout">
          <option value="smart">Smart layout</option>
          <option value="rings">Rings</option>
          <option value="radial">Radial</option>
        </select>
        <button id="topologyResetSmart" type="button">Reset View</button>
      </div>
    `);
    const side = document.querySelector(".topology-side");
    side?.insertAdjacentHTML("beforeend", `
      <div class="pane">
        <h2>Legend</h2>
        <div class="topology-legend">
          ${legendItem("target", "Target", "root")}
          ${legendItem("cluster", "Domain group", "root cluster")}
          ${legendItem("domain", "Domain", "asset")}
          ${legendItem("service", "HTTP service", "live endpoint")}
          ${legendItem("tech", "Technology", "stack")}
          ${legendItem("artifact", "Artifact", "screenshots")}
          ${legendItem("url", "URL", "archive")}
        </div>
        <div class="topology-tip">Drag to pan, mouse wheel to zoom, click a node for details. Use focus mode when large runs get noisy.</div>
      </div>
    `);
  }

  function update(nextData = null) {
    if (nextData) {
      data = {
        domains: nextData.domains || [],
        services: nextData.services || [],
        urls: nextData.urls || [],
        screenshots: nextData.screenshots || [],
        technologies: nextData.technologies || []
      };
    }
    graph = buildGraph(data);
    if ($("topologyNodeCount")) $("topologyNodeCount").textContent = graph.nodes.length;
    if ($("topologyEdgeCount")) $("topologyEdgeCount").textContent = graph.edges.length;
    updateHint();
    render();
  }

  function buildGraph(current) {
    const rootId = $("target")?.value || "workspace";
    const nodes = [{ id: rootId, label: rootId, type: "target", weight: 8, x: 0, y: 0 }];
    const edges = [];
    const nodeIds = new Set([rootId]);
    const query = options.query.toLowerCase();

    const domains = filterByFocus(current.domains || [], "domain").filter((item) => matchQuery(item.domain, query) || matchQuery(item.source, query));
    const services = filterByFocus(current.services || [], "service").filter((item) => matchQuery([item.url, item.host, item.title, ...(item.technologies || [])].join(" "), query));
    const urls = filterByFocus(current.urls || [], "url").filter((item) => matchQuery([item.url, item.path, ...(item.params || [])].join(" "), query));
    const screenshots = filterByFocus(current.screenshots || [], "artifact");
    const techFromServices = summarizeTechnologies(services);

    if ($("topologyDomains")?.checked) addDomainClusters({ rootId, nodes, edges, nodeIds, domains });
    if ($("topologyServices")?.checked) addServices({ rootId, nodes, edges, nodeIds, services });
    if (options.focus === "tech" || options.focus === "all") addTechnologies({ rootId, nodes, edges, nodeIds, technologies: techFromServices });
    if ($("topologyArtifacts")?.checked) addArtifacts({ rootId, nodes, edges, nodeIds, urls, screenshots });

    const finalNodes = nodes.length > 1 ? nodes : preview(rootId).nodes;
    const finalEdges = nodes.length > 1 ? edges : preview(rootId).edges;
    return { nodes: layout(finalNodes, finalEdges), edges: finalEdges };
  }

  function addDomainClusters({ rootId, nodes, edges, nodeIds, domains }) {
    const grouped = groupDomains(domains);
    let shownDomains = 0;
    const maxDomains = options.focus === "live" ? 80 : 180;
    for (const group of grouped.slice(0, 20)) {
      const clusterId = `cluster:${group.root}`;
      nodes.push({ id: clusterId, label: `${group.root} (${group.items.length})`, type: "cluster", weight: Math.min(8, 2 + group.items.length / 12), data: { root: group.root, count: group.items.length } });
      nodeIds.add(clusterId);
      edges.push({ from: rootId, to: clusterId, type: "contains" });
      const perGroup = Math.max(3, Math.floor(maxDomains / Math.max(1, grouped.length)));
      for (const domain of group.items.slice(0, perGroup)) {
        if (shownDomains >= maxDomains) break;
        const domainId = `domain:${domain.domain}`;
        nodes.push({ id: domainId, label: domain.domain, type: "domain", weight: domain.kind === "root" ? 4 : 2, data: domain });
        nodeIds.add(domainId);
        edges.push({ from: clusterId, to: domainId, type: domain.source || "discovered" });
        shownDomains += 1;
      }
      if (shownDomains >= maxDomains) break;
    }
  }

  function addServices({ rootId, nodes, edges, nodeIds, services }) {
    services.slice(0, 140).forEach((service) => {
      const serviceId = `service:${service.url}`;
      nodes.push({ id: serviceId, label: service.host || service.url, type: "service", weight: service.statusCode ? 4 : 2, data: service });
      nodeIds.add(serviceId);
      const domainParent = `domain:${service.host}`;
      const clusterParent = `cluster:${rootForHost(service.host || "")}`;
      const parent = nodeIds.has(domainParent) ? domainParent : nodeIds.has(clusterParent) ? clusterParent : rootId;
      edges.push({ from: parent, to: serviceId, type: "http" });
      for (const tech of (service.technologies || []).slice(0, 8)) {
        const techId = `tech:${tech}`;
        if (!nodeIds.has(techId)) {
          nodes.push({ id: techId, label: tech, type: "tech", weight: 3, data: { technology: tech } });
          nodeIds.add(techId);
        }
        edges.push({ from: serviceId, to: techId, type: "uses" });
      }
    });
  }

  function addTechnologies({ rootId, nodes, edges, nodeIds, technologies }) {
    technologies.slice(0, 30).forEach((tech) => {
      const techId = `tech:${tech.name}`;
      if (!nodeIds.has(techId)) {
        nodes.push({ id: techId, label: tech.name, type: "tech", weight: Math.min(9, 2 + tech.count), data: tech });
        nodeIds.add(techId);
        edges.push({ from: rootId, to: techId, type: "technology" });
      }
    });
  }

  function addArtifacts({ rootId, nodes, edges, nodeIds, urls, screenshots }) {
    urls.slice(0, options.focus === "all" ? 80 : 35).forEach((url) => {
      const id = `url:${url.url}`;
      nodes.push({ id, label: url.path || url.url, type: "url", weight: url.params?.length ? 3 : 1, data: url });
      nodeIds.add(id);
      const parent = nodeIds.has(`domain:${url.host}`) ? `domain:${url.host}` : rootId;
      edges.push({ from: parent, to: id, type: "archive" });
    });
    screenshots.slice(0, 40).forEach((shot) => {
      const id = `screenshot:${shot.id || shot.output_dir}`;
      nodes.push({ id, label: shot.tool_name || "screenshot", type: "artifact", weight: 3, data: shot });
      nodeIds.add(id);
      edges.push({ from: rootId, to: id, type: "visual" });
    });
  }

  function reset() {
    view = { zoom: 1, offsetX: 0, offsetY: 0 };
    update();
  }

  function zoom(delta) {
    view.zoom = Math.max(0.25, Math.min(3.5, view.zoom + delta));
    render();
  }

  function onWheel(event) {
    event.preventDefault();
    zoom(event.deltaY > 0 ? -0.08 : 0.08);
  }

  function startPan(event) {
    drag = { x: event.clientX, y: event.clientY, offsetX: view.offsetX, offsetY: view.offsetY };
  }

  function movePan(event) {
    if (!drag) return;
    view.offsetX = drag.offsetX + event.clientX - drag.x;
    view.offsetY = drag.offsetY + event.clientY - drag.y;
    render();
  }

  function endPan() {
    drag = null;
  }

  function render() {
    const canvas = $("topologyCanvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw(ctx, rect.width, rect.height);
  }

  function draw(ctx, width, height) {
    const centerX = width / 2 + view.offsetX;
    const centerY = height / 2 + view.offsetY;
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
    const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const edge of graph.edges) {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) continue;
      drawEdge(ctx, centerX + from.x * view.zoom, centerY + from.y * view.zoom, centerX + to.x * view.zoom, centerY + to.y * view.zoom, edge);
    }
    for (const node of graph.nodes) {
      drawNode(ctx, centerX + node.x * view.zoom, centerY + node.y * view.zoom, node, node.id === selectedNodeId);
    }
  }

  function drawGrid(ctx, width, height) {
    ctx.strokeStyle = "rgba(67, 197, 158, .07)";
    ctx.lineWidth = 1;
    const gap = 36 * view.zoom;
    for (let x = view.offsetX % gap; x < width; x += gap) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = view.offsetY % gap; y < height; y += gap) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
  }

  function drawEdge(ctx, x1, y1, x2, y2, edge) {
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, "rgba(67, 197, 158, .40)");
    gradient.addColorStop(1, "rgba(143, 220, 195, .16)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = edge.type === "uses" ? 0.9 : 1.25;
    ctx.beginPath();
    const midX = (x1 + x2) / 2;
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(midX, Math.min(y1, y2) - 18, x2, y2);
    ctx.stroke();
  }

  function drawNode(ctx, x, y, node, selected) {
    const style = nodeStyle(node);
    const radius = (style.radius + Math.min(7, Number(node.weight || 1))) * (selected ? 1.25 : 1);
    const pulseRadius = selected ? Math.sin(pulse / 9) * 2.5 : Math.sin(pulse / 22) * 1.4;
    ctx.shadowColor = style.color;
    ctx.shadowBlur = selected ? 26 : 14;
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(x, y, radius + pulseRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (selected) {
      ctx.strokeStyle = "rgba(255,255,255,.82)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(240, 242, 245, .88)";
    ctx.font = selected ? "700 12px Inter, Segoe UI, sans-serif" : "12px Inter, Segoe UI, sans-serif";
    ctx.fillText(String(node.label || "").slice(0, selected ? 38 : 28), x + radius + 8, y + 4);
  }

  function selectNode(event) {
    if (drag && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 3) return;
    const canvas = $("topologyCanvas");
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left - rect.width / 2 - view.offsetX) / view.zoom;
    const y = (event.clientY - rect.top - rect.height / 2 - view.offsetY) / view.zoom;
    const selected = graph.nodes.find((node) => Math.hypot(node.x - x, node.y - y) < 24);
    if (!selected) return;
    selectedNodeId = selected.id;
    const selection = $("topologySelection");
    if (selection) selection.innerHTML = formatNode(selected);
    render();
  }

  function animate() {
    pulse += 1;
    render();
    frame = window.requestAnimationFrame(animate);
  }

  function handleOptionChange() {
    options = {
      query: $("topologySearch")?.value || "",
      focus: $("topologyFocus")?.value || "all",
      layout: $("topologyLayout")?.value || "smart"
    };
    saveOptions();
    update();
  }

  function syncControls() {
    if ($("topologySearch")) $("topologySearch").value = options.query || "";
    if ($("topologyFocus")) $("topologyFocus").value = options.focus || "all";
    if ($("topologyLayout")) $("topologyLayout").value = options.layout || "smart";
  }

  function updateHint() {
    if (!$('topologyHint')) return;
    const visible = graph.nodes.length;
    const live = (data.services || []).length;
    const domains = (data.domains || []).length;
    $("topologyHint").textContent = `${options.focus === "all" ? "Smart" : options.focus} topology: ${visible} visible nodes from ${domains} domains and ${live} live services. Search/focus filters reduce noise.`;
  }

  function filterByFocus(items, type) {
    if (options.focus === "all") return items;
    if (options.focus === "live") return type === "service" ? items : type === "domain" ? items.filter((item) => hasService(item.domain)) : [];
    if (options.focus === "tech") return ["service", "domain"].includes(type) ? items : [];
    if (options.focus === "new") return items.filter((item) => item.status === "new" || item.change === "added" || item.kind === "root" || Number(item.score || 0) >= 75);
    return items;
  }

  function hasService(domain) {
    return (data.services || []).some((service) => service.host === domain);
  }

  function groupDomains(domains) {
    const groups = new Map();
    for (const domain of domains) {
      const root = domain.rootDomain || rootForHost(domain.domain || "");
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(domain);
    }
    return [...groups.entries()].map(([root, items]) => ({ root, items: items.sort((left, right) => String(left.domain).localeCompare(String(right.domain))) })).sort((left, right) => right.items.length - left.items.length || left.root.localeCompare(right.root));
  }

  function summarizeTechnologies(services) {
    const counts = new Map();
    services.forEach((service) => (service.technologies || []).forEach((tech) => counts.set(tech, (counts.get(tech) || 0) + 1)));
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function rootForHost(hostname) {
    const clean = String(hostname || "").split(":")[0].toLowerCase();
    const parts = clean.split(".").filter(Boolean);
    if (parts.length <= 2) return clean || "unknown";
    return parts.slice(-2).join(".");
  }

  function preview(rootId) {
    const nodes = [
      { id: rootId, label: rootId, type: "target", weight: 8 },
      { id: "phase:passive", label: "Passive recon", type: "phase", weight: 3 },
      { id: "phase:dns", label: "DNS resolution", type: "phase", weight: 3 },
      { id: "phase:http", label: "HTTP probing", type: "phase", weight: 3 },
      { id: "phase:graph", label: "Correlation graph", type: "phase", weight: 3 }
    ];
    const edges = [
      { from: rootId, to: "phase:passive", type: "feeds" },
      { from: "phase:passive", to: "phase:dns", type: "validates" },
      { from: "phase:dns", to: "phase:http", type: "probes" },
      { from: "phase:http", to: "phase:graph", type: "correlates" }
    ];
    return { nodes: layout(nodes, edges), edges };
  }

  function layout(nodes, edges) {
    if (options.layout === "radial") return radialLayout(nodes);
    if (options.layout === "rings") return ringLayout(nodes);
    return smartLayout(nodes, edges);
  }

  function smartLayout(nodes) {
    const buckets = { target: [], cluster: [], domain: [], service: [], tech: [], url: [], artifact: [], phase: [] };
    nodes.forEach((node) => (buckets[node.type] || buckets.phase).push(node));
    const placed = [];
    placed.push(...placeRing(buckets.target, 0, 0, 0));
    placed.push(...placeRing(buckets.cluster, 140, -Math.PI / 2, Math.PI / 2));
    placed.push(...placeRing(buckets.domain, 270, 0, Math.PI * 2));
    placed.push(...placeRing(buckets.service, 420, 0.2, Math.PI * 1.8));
    placed.push(...placeRing(buckets.tech, 560, Math.PI, Math.PI * 2));
    placed.push(...placeRing([...buckets.url, ...buckets.artifact, ...buckets.phase], 650, 0, Math.PI * 2));
    return placed;
  }

  function ringLayout(nodes) {
    return placeRing(nodes, Math.max(140, Math.min(680, 28 * nodes.length)), 0, Math.PI * 2);
  }

  function radialLayout(nodes) {
    return nodes.map((node, index) => {
      if (index === 0) return { ...node, x: 0, y: 0 };
      const angle = (Math.PI * 2 * (index - 1)) / Math.max(1, nodes.length - 1);
      const radius = 110 + 46 * (index % 9);
      return { ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
  }

  function placeRing(nodes, radius, startAngle, arc) {
    if (!nodes.length) return [];
    if (radius === 0) return nodes.map((node) => ({ ...node, x: 0, y: 0 }));
    return nodes.map((node, index) => {
      const angle = startAngle + (arc * index) / Math.max(1, nodes.length);
      return { ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
  }

  function formatNode(node) {
    const data = node.data || {};
    const title = escapeHtml(node.label || node.id);
    const meta = [`Type: ${node.type}`];
    if (node.type === "domain") meta.push(`Kind: ${data.kind || "-"}`, `Source: ${data.source || "-"}`);
    if (node.type === "service") meta.push(`Status: ${data.statusCode || "-"}`, `Title: ${data.title || "-"}`);
    if (node.type === "tech") meta.push(`Services: ${data.count || 1}`);
    if (node.type === "cluster") meta.push(`Domains: ${data.count || "-"}`);
    if (node.type === "url") meta.push(`Params: ${(data.params || []).join(", ") || "-"}`);
    if (node.type === "artifact") meta.push(`Tool: ${data.tool_name || "-"}`);
    const code = data.url || data.domain || data.report_path || data.output_dir || data.technology || node.id;
    return `<div class="topology-selection-card"><strong>${title}</strong>${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}<code>${escapeHtml(code)}</code></div>`;
  }

  function nodeStyle(node) {
    const colors = {
      target: ["#43c59e", 15],
      cluster: ["#49d8ff", 12],
      domain: ["#8fdcc3", 8],
      service: ["#f2b84b", 8],
      tech: ["#a78bfa", 7],
      url: ["#9da6b5", 6],
      artifact: ["#ef6f6c", 7],
      phase: ["#8fdcc3", 10]
    };
    const [color, radius] = colors[node.type] || ["#9da6b5", 7];
    return { color, radius };
  }

  function legendItem(type, label, hint) {
    return `<div class="topology-legend-item"><span><i class="topology-dot ${type}"></i>${label}</span><em>${hint}</em></div>`;
  }

  function matchQuery(value, query) {
    if (!query) return true;
    return String(value || "").toLowerCase().includes(query);
  }

  function loadOptions() {
    try { return { query: "", focus: "all", layout: "smart", ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; } catch { return { query: "", focus: "all", layout: "smart" }; }
  }

  function saveOptions() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  }

  function injectStylesheet(href, id) {
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  window.AuraTopology = { bind, render, update };
})();
