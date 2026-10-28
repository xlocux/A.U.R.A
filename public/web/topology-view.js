"use strict";

(function initAuraTopologyView() {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "aura.topology.smart";
  let frame = null;
  let pulse = 0;
  let graph = { nodes: [], edges: [] };
  let data = { domains: [], services: [], urls: [], screenshots: [], technologies: [], candidates: [] };
  let view = { zoom: 1, offsetX: 0, offsetY: 0 };
  let canvasSize = { width: 0, height: 0, scale: 0 };
  let drag = null;
  let fitted = false;
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
    $("fitTopology")?.addEventListener("click", fit);
    $("zoomTopologyIn")?.addEventListener("click", () => zoom(0.15));
    $("zoomTopologyOut")?.addEventListener("click", () => zoom(-0.15));
    ["topologyDomains", "topologyServices", "topologyArtifacts", "topologyCandidates"].forEach((id) => $(id)?.addEventListener("change", handleLayerToggle));
    ["topologySearch", "topologyFocus", "topologyLayout"].forEach((id) => $(id)?.addEventListener("input", handleOptionChange));
    $("topologyLabels")?.addEventListener("change", () => { options.labels = $("topologyLabels").value; saveOptions(); }); // only repaints: the animation loop draws the next frame
    $("topologyResetSmart")?.addEventListener("click", () => {
      options = { query: "", focus: "all", layout: "smart", labels: "auto" };
      saveOptions();
      syncControls();
      reset();
    });
    syncControls();
    update();
    window.addEventListener("resize", () => fit());
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
        <select id="topologyLabels" title="Node labels">
          <option value="auto">Labels: auto</option>
          <option value="all">Labels: all</option>
          <option value="none">Labels: none</option>
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
          ${legendItem("candidate", "Verified candidate", "100% confidence")}
        </div>
        <div class="topology-tip">Drag to pan, mouse wheel to zoom, click a node for details. Use focus mode when large runs get noisy.</div>
      </div>
    `);
  }

  function update(nextData = null, renderOptions = {}) {
    const camera = { ...view };
    if (nextData) {
      data = {
        domains: Array.isArray(nextData.domains) ? nextData.domains : data.domains || [],
        services: Array.isArray(nextData.services) ? nextData.services : data.services || [],
        urls: Array.isArray(nextData.urls) ? nextData.urls : data.urls || [],
        screenshots: Array.isArray(nextData.screenshots) ? nextData.screenshots : data.screenshots || [],
        technologies: Array.isArray(nextData.technologies) ? nextData.technologies : data.technologies || [],
        candidates: Array.isArray(nextData.candidates) ? nextData.candidates : Array.isArray(nextData.leads) ? nextData.leads : data.candidates || []
      };
    }
    graph = buildGraph(data);
    if (!graph.nodes.some((node) => node.id === selectedNodeId)) selectedNodeId = null;
    if ($("topologyNodeCount")) $("topologyNodeCount").textContent = graph.nodes.length;
    if ($("topologyEdgeCount")) $("topologyEdgeCount").textContent = graph.edges.length;
    updateHint();
    if (renderOptions.preserveCamera) {
      view = camera;
      render();
    } else {
      render();
      fit();
    }
  }

  function handleLayerToggle() {
    update(null, { preserveCamera: true });
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
    const candidates = filterByFocus(current.candidates || [], "candidate")
      .filter(isVerifiedCandidate)
      .filter((item) => matchQuery([item.value, item.domain, item.source, item.confidence, item.status, ...(item.matchTerms || [])].join(" "), query));
    const techFromServices = summarizeTechnologies(services);

    if ($("topologyDomains")?.checked) addDomainClusters({ rootId, nodes, edges, nodeIds, domains });
    if ($("topologyServices")?.checked) addServices({ rootId, nodes, edges, nodeIds, services });
    if (options.focus === "tech" || options.focus === "all") addTechnologies({ rootId, nodes, edges, nodeIds, technologies: techFromServices });
    if ($("topologyArtifacts")?.checked) addArtifacts({ rootId, nodes, edges, nodeIds, urls, screenshots });
    if ($("topologyCandidates")?.checked) addCandidates({ rootId, nodes, edges, nodeIds, candidates });

    const loaded = hasTopologyData(current);
    if (nodes.length > 1) return { nodes: layout(nodes, edges), edges };
    if (loaded) return { nodes: layout(nodes, edges), edges };
    const fallback = preview(rootId);
    return { nodes: fallback.nodes, edges: fallback.edges };
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

  function addCandidates({ rootId, nodes, edges, nodeIds, candidates }) {
    candidates.slice(0, options.focus === "new" ? 140 : 90).forEach((candidate) => {
      const value = candidate.value || candidate.domain;
      if (!value) return;
      const id = `candidate:${value}`;
      if (nodeIds.has(id)) return;
      const score = candidateScore(candidate);
      nodes.push({
        id,
        label: value,
        type: "candidate",
        weight: 6,
        data: candidate
      });
      nodeIds.add(id);
      const domainParent = `domain:${value}`;
      const clusterParent = `cluster:${rootForHost(value)}`;
      const parent = nodeIds.has(domainParent) ? domainParent : nodeIds.has(clusterParent) ? clusterParent : rootId;
      edges.push({ from: parent, to: id, type: "candidate" });
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

  // Fit the whole graph into the canvas: measure node bounds, then pick a zoom and offset
  // that center everything with padding. Falls back to a plain reset when there is nothing to size.
  function fit() {
    const canvas = $("topologyCanvas");
    if (!canvas || !graph.nodes.length) {
      view = { zoom: 1, offsetX: 0, offsetY: 0 };
      render();
      return;
    }
    // Layout size (not getBoundingClientRect): it must not be distorted by the fullscreen enter/exit animation.
    const rect = { width: canvas.clientWidth, height: canvas.clientHeight };
    if (rect.width < 2 || rect.height < 2) return; // Canvas not visible yet; a later render will fit.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of graph.nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
    }
    const padding = 90; // room for node radius + labels
    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    const zoom = Math.max(0.12, Math.min(1.6,
      Math.min((rect.width - padding * 2) / graphWidth, (rect.height - padding * 2) / graphHeight)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    view = { zoom, offsetX: -centerX * zoom, offsetY: -centerY * zoom };
    render();
  }

  function reset() {
    update();
    fit();
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
    const rect = { width: canvas.clientWidth, height: canvas.clientHeight };
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * scale));
    const height = Math.max(1, Math.floor(rect.height * scale));
    const wasHidden = canvasSize.width <= 2 || canvasSize.height <= 2;
    if (canvasSize.width !== width || canvasSize.height !== height || canvasSize.scale !== scale) {
      canvas.width = width;
      canvas.height = height;
      canvasSize = { width, height, scale };
    }
    // When the canvas first becomes visible (e.g. switching to the Topology tab), fit the graph once.
    if (wasHidden && width > 2 && height > 2 && graph.nodes.length && !fitted) {
      fitted = true;
      fit();
      return;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw(ctx, rect.width, rect.height);
  }

  // Theme-aware palette read from the CSS variables (refreshed every ~1.5s so theme changes apply live).
  let palCache = null;
  let palAt = -999;
  function themePalette() {
    if (palCache && pulse - palAt < 90) return palCache;
    palAt = pulse;
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
    const accent = v("--accent", "#43c59e");
    const rel = (shift, l, c) => "oklch(from " + accent + " " + l + " " + c + " calc(h + " + shift + "))";
    palCache = {
      accent,
      accent2: v("--accent-2", "#8fdcc3"),
      bad: v("--bad", "#ef6f6c"),
      ink: v("--ink", "#f0f2f5"),
      muted: v("--muted", "#9da6b5"),
      enum: rel(55, 0.8, 0.13),
      content: rel(130, 0.78, 0.14),
      analysis: rel(205, 0.8, 0.14),
      exposure: rel(285, 0.76, 0.15),
      font: v("--font-display", "'Rajdhani', 'Segoe UI', sans-serif")
    };
    return palCache;
  }

  // Canvas ignores colours it cannot parse, so set a plain fallback first and the modern colour after it.
  function paint(ctx, prop, value, fallback) { ctx[prop] = fallback; ctx[prop] = value; }
  const mix = (color, pct) => "color-mix(in srgb, " + color + " " + pct + "%, transparent)";

  function hexPath(ctx, x, y, r) {
    ctx.beginPath();
    for (let k = 0; k < 6; k += 1) {
      const a = (k * Math.PI) / 3;
      const px = x + r * Math.cos(a);
      const py = y + r * Math.sin(a);
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  function draw(ctx, width, height) {
    const pal = themePalette();
    const centerX = width / 2 + view.offsetX;
    const centerY = height / 2 + view.offsetY;
    ctx.clearRect(0, 0, width, height); // transparent: the app's animated background shows through
    const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
    const light = graph.edges.length <= 260; // packets on every edge only while the graph is small
    graph.edges.forEach((edge, index) => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) return;
      const hot = Boolean(selectedNodeId) && (edge.from === selectedNodeId || edge.to === selectedNodeId);
      drawEdge(ctx, pal, centerX + from.x * view.zoom, centerY + from.y * view.zoom, centerX + to.x * view.zoom, centerY + to.y * view.zoom, edge, from, to, hot, light, index);
    });
    for (const node of graph.nodes) {
      drawNode(ctx, pal, centerX + node.x * view.zoom, centerY + node.y * view.zoom, node, node.id === selectedNodeId);
    }
  }

  function nodeRadius(node) {
    return nodeStyle(node, themePalette()).radius + Math.min(7, Number(node.weight || 1));
  }

  // Links: steel dashes drifting slowly at rest; links of the selected node turn bright and carry packets.
  function drawEdge(ctx, pal, x1, y1, x2, y2, edge, from, to, hot, light, index) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const r1 = nodeRadius(from) * view.zoom + 3;
    const r2 = nodeRadius(to) * view.zoom + 3;
    if (len < r1 + r2 + 4) return;
    const ax = x1 + (dx / len) * r1;
    const ay = y1 + (dy / len) * r1;
    const bx = x2 - (dx / len) * r2;
    const by = y2 - (dy / len) * r2;
    const cx = (ax + bx) / 2;
    const cy = Math.min(ay, by) - 18;
    ctx.save();
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    if (hot) {
      paint(ctx, "shadowColor", pal.accent, "#43c59e");
      ctx.shadowBlur = 10;
      paint(ctx, "strokeStyle", pal.accent, "#43c59e");
      ctx.lineWidth = 1.8;
    } else {
      paint(ctx, "strokeStyle", mix(pal.ink, 38), "rgba(220,225,235,.38)");
      ctx.lineWidth = edge.type === "uses" ? 0.8 : 1;
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -pulse * 0.12;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    if (hot || light) {
      const count = hot ? 2 : 1;
      for (let k = 0; k < count; k += 1) {
        const t = (pulse * (hot ? 0.011 : 0.004) + index * 0.173 + k * 0.5) % 1;
        const u = 1 - t;
        const px = u * u * ax + 2 * u * t * cx + t * t * bx;
        const py = u * u * ay + 2 * u * t * cy + t * t * by;
        ctx.beginPath();
        ctx.arc(px, py, hot ? 2.6 : 1.6, 0, Math.PI * 2);
        paint(ctx, "shadowColor", pal.accent, "#43c59e");
        ctx.shadowBlur = hot ? 10 : 4;
        paint(ctx, "fillStyle", hot ? "#ffffff" : mix(pal.accent, 75), "#ffffff");
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Nodes: see-through hexagons with a thin outline, an inner ring and vertex dots (same language as the Flow tiles).
  function drawNode(ctx, pal, x, y, node, selected) {
    const style = nodeStyle(node, pal);
    const base = (style.radius + Math.min(7, Number(node.weight || 1))) * (selected ? 1.2 : 1);
    const r = base + (selected ? Math.sin(pulse / 9) * 1.5 : Math.sin(pulse / 26) * 0.8);
    ctx.save();
    hexPath(ctx, x, y, r);
    paint(ctx, "fillStyle", mix(style.color, selected ? 22 : 10), "rgba(255,255,255,.08)");
    paint(ctx, "shadowColor", style.color, style.fallback);
    ctx.shadowBlur = selected ? 20 : 8;
    ctx.fill();
    ctx.shadowBlur = 0;
    paint(ctx, "strokeStyle", style.color, style.fallback);
    ctx.lineWidth = selected ? 1.6 : 1.1;
    hexPath(ctx, x, y, r);
    ctx.stroke();
    paint(ctx, "strokeStyle", mix(style.color, 45), style.fallback);
    ctx.lineWidth = 0.7;
    hexPath(ctx, x, y, r * 0.66);
    ctx.stroke();
    paint(ctx, "fillStyle", style.color, style.fallback);
    for (let k = 0; k < 6; k += 1) {
      const a = (k * Math.PI) / 3;
      ctx.beginPath();
      ctx.arc(x + r * Math.cos(a), y + r * Math.sin(a), 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (selected) {
      ctx.setLineDash([3, 6]);
      ctx.lineDashOffset = -pulse * 0.5;
      ctx.lineWidth = 0.9;
      paint(ctx, "strokeStyle", pal.accent, "#43c59e");
      ctx.beginPath();
      ctx.arc(x, y, r + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const labels = options.labels || "auto"; // auto hides most labels on a crowded graph; all and none are the user's choice
    if (labels === "none") { ctx.restore(); return; }
    const dense = graph.nodes.length > 45 && labels !== "all";
    if (!selected && dense && !(["target", "cluster", "service", "tech"].includes(node.type) && view.zoom > 0.5)) { ctx.restore(); return; }
    ctx.font = (selected ? "400 12px " : "400 11px ") + pal.font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0.4px";
    paint(ctx, "fillStyle", mix(pal.ink, selected ? 96 : 82), "rgba(240,242,245,.85)");
    ctx.fillText(String(node.label || "").slice(0, selected ? 38 : dense ? 20 : 28), x + r + 8, y + 4);
    ctx.restore();
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
    openNodeModal(selected);
  }

  // ── Node info modal ──
  function ensureNodeModal() {
    let modal = document.getElementById("topologyNodeModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "topologyNodeModal";
    modal.className = "topology-node-modal hidden";
    modal.innerHTML = '<div class="topology-node-dialog" role="dialog" aria-modal="true" aria-labelledby="tnmTitle"><div id="tnmBody"></div></div>';
    document.body.appendChild(modal);
    const close = () => modal.classList.add("hidden");
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-tnm-close]")) { close(); return; }
      const link = event.target.closest("[data-tnm-node]");
      if (link) {
        const target = graph.nodes.find((node) => node.id === link.dataset.tnmNode);
        if (target) { selectedNodeId = target.id; const sel = $("topologySelection"); if (sel) sel.innerHTML = formatNode(target); render(); openNodeModal(target); }
        return;
      }
      const copy = event.target.closest("[data-tnm-copy]");
      if (copy) navigator.clipboard?.writeText(copy.dataset.tnmCopy).then(() => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy value"; }, 1200); }).catch(() => {});
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
    return modal;
  }

  function openNodeModal(node) {
    const modal = ensureNodeModal();
    const pal = themePalette();
    const style = nodeStyle(node, pal);
    const data = node.data || {};
    const value = data.url || data.domain || data.value || data.report_path || data.output_dir || data.technology || node.id;
    const neighborIds = new Set();
    for (const edge of graph.edges) {
      if (edge.from === node.id) neighborIds.add(edge.to);
      else if (edge.to === node.id) neighborIds.add(edge.from);
    }
    const neighbors = [...neighborIds].map((id) => graph.nodes.find((n) => n.id === id)).filter(Boolean);
    const links = neighbors.slice(0, 18).map((n) => '<button type="button" class="tnm-link" data-tnm-node="' + escapeHtml(n.id) + '"><i style="background:' + nodeStyle(n, pal).fallback + '"></i>' + escapeHtml(String(n.label || n.id).slice(0, 34)) + "</button>").join("");
    const open = /^https?:\/\//i.test(String(value)) ? '<a class="tnm-open" href="' + escapeHtml(value) + '" target="_blank" rel="noreferrer noopener">Open</a>' : "";
    modal.querySelector("#tnmBody").innerHTML =
      '<div class="tnm-head"><span class="tnm-tag" style="--tn:' + style.color + '">NODE // ' + escapeHtml(String(node.type || "").toUpperCase()) + '</span>' +
      '<button type="button" class="tnm-close" data-tnm-close aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<h3 id="tnmTitle" class="tnm-title">' + escapeHtml(node.label || node.id) + "</h3>" +
      '<div class="tnm-card">' + formatNode(node) + "</div>" +
      "<h4>Connections (" + neighbors.length + ")</h4>" +
      '<div class="tnm-links">' + (links || '<span class="muted">No connected nodes.</span>') + (neighbors.length > 18 ? '<span class="muted">+' + (neighbors.length - 18) + " more</span>" : "") + "</div>" +
      '<div class="tnm-actions"><button type="button" data-tnm-copy="' + escapeHtml(value) + '">Copy value</button>' + open + "</div>";
    modal.classList.remove("hidden");
  }

  function animate() {
    pulse += 1;
    render();
    frame = window.requestAnimationFrame(animate);
  }

  let optionTimer = null;
  // Debounced: every keystroke in the search box would otherwise rebuild the whole graph.
  function handleOptionChange() {
    clearTimeout(optionTimer);
    optionTimer = setTimeout(applyOptionChange, 200);
  }

  function applyOptionChange() {
    options = {
      query: $("topologySearch")?.value || "",
      focus: $("topologyFocus")?.value || "all",
      layout: $("topologyLayout")?.value || "smart",
      labels: $("topologyLabels")?.value || "auto"
    };
    saveOptions();
    update();
  }

  function syncControls() {
    if ($("topologySearch")) $("topologySearch").value = options.query || "";
    if ($("topologyFocus")) $("topologyFocus").value = options.focus || "all";
    if ($("topologyLayout")) $("topologyLayout").value = options.layout || "smart";
    if ($("topologyLabels")) $("topologyLabels").value = options.labels || "auto";
  }

  function updateHint() {
    if (!$('topologyHint')) return;
    const visible = graph.nodes.length;
    const live = (data.services || []).length;
    const domains = (data.domains || []).length;
    const verified = (data.candidates || []).filter(isVerifiedCandidate).length;
    const totalCandidates = (data.candidates || []).length;
    const candidateText = totalCandidates ? `${verified} verified candidates (100% confidence) from ${totalCandidates} review leads` : "0 verified candidates";
    $("topologyHint").textContent = `${options.focus === "all" ? "Smart" : options.focus} topology: ${visible} visible nodes from ${domains} domains, ${live} live services, and ${candidateText}. Search/focus filters reduce noise.`;
  }

  function filterByFocus(items, type) {
    if (options.focus === "all") return items;
    if (options.focus === "live") return type === "service" ? items : type === "domain" ? items.filter((item) => hasService(item.domain)) : [];
    if (options.focus === "tech") return ["service", "domain"].includes(type) ? items : [];
    if (options.focus === "new") return items.filter((item) => item.status === "new" || item.change === "added" || item.kind === "root" || candidateScore(item) >= 100);
    return items;
  }

  function isVerifiedCandidate(candidate) {
    return candidateScore(candidate) === 100;
  }

  function candidateScore(candidate) {
    const raw = candidate?.metadata?.correlationScore
      ?? candidate?.metadata?.confidence_score
      ?? candidate?.metadata?.score
      ?? candidate?.score
      ?? candidate?.confidence_score
      ?? candidate?.confidence
      ?? 0;
    if (typeof raw === "string") {
      const parsed = Number.parseFloat(raw.replace("%", ""));
      return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const normalized = raw > 0 && raw <= 1 ? raw * 100 : raw;
      return Math.max(0, Math.min(100, normalized));
    }
    return 0;
  }

  function hasTopologyData(current) {
    return [current.domains, current.services, current.urls, current.screenshots, current.technologies, current.candidates]
      .some((items) => Array.isArray(items) && items.length > 0);
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
    const buckets = { target: [], cluster: [], domain: [], service: [], tech: [], url: [], artifact: [], candidate: [], phase: [] };
    nodes.forEach((node) => (buckets[node.type] || buckets.phase).push(node));
    const placed = [];
    placed.push(...placeRing(buckets.target, 0, 0, 0));
    placed.push(...placeRing(buckets.cluster, 140, -Math.PI / 2, Math.PI / 2));
    placed.push(...placeRing(buckets.domain, 270, 0, Math.PI * 2));
    placed.push(...placeRing(buckets.service, 420, 0.2, Math.PI * 1.8));
    placed.push(...placeRing([...buckets.tech, ...buckets.candidate], 560, Math.PI, Math.PI * 2));
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
    if (node.type === "candidate") meta.push(`Source: ${data.source || "-"}`, `Score: ${candidateScore(data)}%`, "Topology visibility: 100% verified only");
    const code = data.url || data.domain || data.value || data.report_path || data.output_dir || data.technology || node.id;
    return `<div class="topology-selection-card"><strong>${title}</strong>${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}<code>${escapeHtml(code)}</code></div>`;
  }

  // Colour per node type: hue-rotated from the theme accent (like the Flow categories); vuln-like = theme "bad".
  function nodeStyle(node, pal = themePalette()) {
    const map = {
      target: [pal.accent, "#43c59e", 15],
      cluster: [pal.enum, "#7dd3fc", 12],
      domain: [pal.accent2, "#8fdcc3", 8],
      service: [pal.analysis, "#fcd34d", 8],
      tech: [pal.content, "#c4b5fd", 7],
      url: [pal.muted, "#9da6b5", 6],
      artifact: [pal.exposure, "#fb923c", 7],
      candidate: [pal.bad, "#ef6f6c", 8],
      phase: [pal.accent2, "#8fdcc3", 10]
    };
    const [color, fallback, radius] = map[node.type] || [pal.muted, "#9da6b5", 7];
    return { color, fallback, radius };
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

  window.AuraTopology = { bind, render, update, fit };
})();
