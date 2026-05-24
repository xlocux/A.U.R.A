"use strict";

(function initAuraTopologyView() {
  const $ = (id) => document.getElementById(id);
  let frame = null;
  let pulse = 0;
  let graph = { nodes: [], edges: [] };
  let data = { domains: [], services: [], urls: [], screenshots: [] };
  let view = { zoom: 1, offsetX: 0, offsetY: 0 };

  function bind() {
    $("topologyCanvas")?.addEventListener("click", selectNode);
    $("fitTopology")?.addEventListener("click", reset);
    $("pulseTopology")?.addEventListener("click", render);
    $("zoomTopologyIn")?.addEventListener("click", () => zoom(0.15));
    $("zoomTopologyOut")?.addEventListener("click", () => zoom(-0.15));
    ["topologyDomains", "topologyServices", "topologyArtifacts", "topologyCandidates"].forEach((id) => {
      $(id)?.addEventListener("change", reset);
    });
    update();
    if (!frame) animate();
  }

  function update(nextData = null) {
    if (nextData) {
      data = {
        domains: nextData.domains || [],
        services: nextData.services || [],
        urls: nextData.urls || [],
        screenshots: nextData.screenshots || []
      };
    }
    const { domains, services, urls, screenshots } = data;
    const nodes = [];
    const edges = [];
    const rootId = $("target")?.value || "workspace";
    nodes.push({ id: rootId, label: rootId, type: "target", x: 0, y: 0 });
    const nodeIds = new Set([rootId]);

    if ($("topologyDomains")?.checked) {
      const grouped = groupDomains(domains);
      let shownDomains = 0;
      for (const group of grouped.slice(0, 18)) {
        const clusterId = `cluster:${group.root}`;
        nodes.push({ id: clusterId, label: `${group.root} (${group.items.length})`, type: "cluster", data: { root: group.root, count: group.items.length } });
        nodeIds.add(clusterId);
        edges.push({ from: rootId, to: clusterId, type: "domain cluster" });
        for (const domain of group.items.slice(0, Math.max(4, Math.floor(120 / Math.max(1, grouped.length))))) {
          if (shownDomains >= 160) break;
          const domainId = `domain:${domain.domain}`;
          nodes.push({ id: domainId, label: domain.domain, type: "domain", data: domain });
          nodeIds.add(domainId);
          edges.push({ from: clusterId, to: domainId, type: domain.source || "discovered" });
          shownDomains += 1;
        }
        if (shownDomains >= 160) break;
      }
      $("topologyHint").textContent = `Clustered topology. Showing ${Math.min(shownDomains, domains.length)} of ${domains.length} domains plus services and artifacts for the loaded run.`;
    } else if ($("topologyHint")) {
      $("topologyHint").textContent = "Topology layers are filtered. Enable domains for the clustered domain map.";
    }

    if ($("topologyServices")?.checked) {
      services.slice(0, 100).forEach((service) => {
        const serviceId = `service:${service.url}`;
        nodes.push({ id: serviceId, label: service.host || service.url, type: "service", data: service });
        nodeIds.add(serviceId);
        const domainParent = `domain:${service.host}`;
        const clusterParent = `cluster:${rootForHost(service.host || "")}`;
        const serviceParent = nodeIds.has(domainParent) ? domainParent : nodeIds.has(clusterParent) ? clusterParent : rootId;
        edges.push({ from: serviceParent, to: serviceId, type: "http" });
      });
    }

    if ($("topologyArtifacts")?.checked) {
      urls.slice(0, 80).forEach((url) => {
        nodes.push({ id: `url:${url.url}`, label: url.path || url.url, type: "url", data: url });
        edges.push({ from: rootId, to: `url:${url.url}`, type: "archive" });
      });
      screenshots.slice(0, 30).forEach((shot) => {
        nodes.push({ id: `screenshot:${shot.id || shot.output_dir}`, label: shot.tool_name || "screenshot", type: "artifact", data: shot });
        edges.push({ from: rootId, to: `screenshot:${shot.id || shot.output_dir}`, type: "visual" });
      });
    }

    graph = nodes.length > 1 ? { nodes: layout(nodes), edges } : preview(rootId);
    if ($("topologyNodeCount")) $("topologyNodeCount").textContent = graph.nodes.length;
    if ($("topologyEdgeCount")) $("topologyEdgeCount").textContent = graph.edges.length;
    render();
  }

  function reset() {
    view = { zoom: 1, offsetX: 0, offsetY: 0 };
    update();
  }

  function zoom(delta) {
    view.zoom = Math.max(0.35, Math.min(3, view.zoom + delta));
    render();
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
      drawEdge(ctx, centerX + from.x * view.zoom, centerY + from.y * view.zoom, centerX + to.x * view.zoom, centerY + to.y * view.zoom);
    }
    for (const node of graph.nodes) {
      drawNode(ctx, centerX + node.x * view.zoom, centerY + node.y * view.zoom, node);
    }
  }

  function drawGrid(ctx, width, height) {
    ctx.strokeStyle = "rgba(67, 197, 158, .08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 36) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  function drawEdge(ctx, x1, y1, x2, y2) {
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, "rgba(67, 197, 158, .42)");
    gradient.addColorStop(1, "rgba(143, 220, 195, .18)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawNode(ctx, x, y, node) {
    const colors = {
      target: ["#43c59e", 15],
      cluster: ["#49d8ff", 12],
      domain: ["#8fdcc3", 9],
      service: ["#f2b84b", 8],
      url: ["#9da6b5", 6],
      artifact: ["#ef6f6c", 7],
      phase: ["#8fdcc3", 10]
    };
    const [color, radius] = colors[node.type] || ["#9da6b5", 7];
    const pulseRadius = Math.sin(pulse / 18) * 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius + pulseRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(240, 242, 245, .86)";
    ctx.font = "12px Inter, Segoe UI, sans-serif";
    ctx.fillText(String(node.label || "").slice(0, 28), x + radius + 7, y + 4);
  }

  function selectNode(event) {
    const canvas = $("topologyCanvas");
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left - rect.width / 2 - view.offsetX) / view.zoom;
    const y = (event.clientY - rect.top - rect.height / 2 - view.offsetY) / view.zoom;
    const selected = graph.nodes.find((node) => Math.hypot(node.x - x, node.y - y) < 18);
    if (!selected) return;
    $("topologySelection").textContent = formatNode(selected);
  }

  function animate() {
    pulse += 1;
    render();
    frame = window.requestAnimationFrame(animate);
  }

  function groupDomains(domains) {
    const groups = new Map();
    for (const domain of domains) {
      const root = domain.rootDomain || rootForHost(domain.domain || "");
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(domain);
    }
    return [...groups.entries()]
      .map(([root, items]) => ({ root, items: items.sort((left, right) => String(left.domain).localeCompare(String(right.domain))) }))
      .sort((left, right) => right.items.length - left.items.length || left.root.localeCompare(right.root));
  }

  function rootForHost(hostname) {
    const clean = String(hostname || "").split(":")[0].toLowerCase();
    const parts = clean.split(".").filter(Boolean);
    if (parts.length <= 2) return clean || "unknown";
    return parts.slice(-2).join(".");
  }

  function preview(rootId) {
    const nodes = [
      { id: rootId, label: rootId, type: "target" },
      { id: "phase:passive", label: "Passive recon", type: "phase" },
      { id: "phase:dns", label: "DNS resolution", type: "phase" },
      { id: "phase:http", label: "HTTP probing", type: "phase" },
      { id: "phase:graph", label: "Correlation graph", type: "phase" }
    ];
    const edges = [
      { from: rootId, to: "phase:passive", type: "feeds" },
      { from: "phase:passive", to: "phase:dns", type: "validates" },
      { from: "phase:dns", to: "phase:http", type: "probes" },
      { from: "phase:http", to: "phase:graph", type: "correlates" }
    ];
    return { nodes: layout(nodes), edges };
  }

  function layout(nodes) {
    const radius = Math.max(120, Math.min(340, 34 * nodes.length));
    return nodes.map((node, index) => {
      if (index === 0) return { ...node, x: 0, y: 0 };
      const angle = (Math.PI * 2 * (index - 1)) / Math.max(1, nodes.length - 1);
      const ring = radius * (0.55 + ((index % 4) * 0.16));
      return { ...node, x: Math.cos(angle) * ring, y: Math.sin(angle) * ring };
    });
  }

  function formatNode(node) {
    const nodeData = node.data || {};
    if (node.type === "domain") {
      return [`Domain: ${node.label}`, `Kind: ${nodeData.kind || "-"}`, `Source: ${nodeData.source || "-"}`, `Status: ${nodeData.status || "-"}`].join("\n");
    }
    if (node.type === "cluster") {
      return [`Domain cluster: ${nodeData.root || node.label}`, `Domains: ${nodeData.count || "-"}`, "Expand the run table or search to inspect individual domains."].join("\n");
    }
    if (node.type === "service") {
      return [`HTTP service: ${nodeData.url || node.label}`, `Status: ${nodeData.statusCode || "-"}`, `Title: ${nodeData.title || "-"}`, `Tech: ${(nodeData.technologies || []).join(", ") || "-"}`].join("\n");
    }
    if (node.type === "url") {
      return [`URL: ${nodeData.url || node.label}`, `Path: ${nodeData.path || "-"}`, `Params: ${(nodeData.params || []).join(", ") || "-"}`, `Source: ${nodeData.source || "-"}`].join("\n");
    }
    if (node.type === "artifact") {
      return [`Artifact: ${node.label}`, `Report: ${nodeData.report_path || "-"}`, `Output: ${nodeData.output_dir || "-"}`].join("\n");
    }
    return `${node.type}: ${node.label}`;
  }

  window.AuraTopology = {
    bind,
    render,
    update
  };
})();
