"use strict";

let targets = [];
let activeRunId = null;
let lastEventId = 0;
let poll = null;
let aiWindowDrag = null;
let topologyFrame = null;
let topologyPulse = 0;
let topologyGraph = { nodes: [], edges: [] };
let aiSettings = null;
let aiModels = [];

const $ = (id) => document.getElementById(id);
const AI_WINDOW_STORAGE_KEY = "aura.aiWindow";
const UI_SETTINGS_STORAGE_KEY = "aura.uiSettings";

function esc(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u009b[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\[\??[0-9]{1,3}(;[0-9]{1,3})*m/g, "");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await res.json();
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Authentication required");
  }
  if (!res.ok) {
    const error = new Error(data.error || "Request failed");
    error.errors = data.errors || null;
    throw error;
  }
  return data;
}

async function postAgentPrompt(prompt) {
  const data = await api("/api/agent/chat", {
    method: "POST",
    body: JSON.stringify({
      prompt,
      distro: $("setupDistro")?.value?.trim() || "kali-linux"
    })
  });
  return data.message;
}

async function loadAiSettings() {
  const data = await api("/api/ai-settings");
  aiSettings = data.settings;
  aiModels = data.models || [];
  renderAiSettings();
}

async function saveAiSettings() {
  $("saveAiSettings").disabled = true;
  $("aiSettingsStatus").textContent = "Saving AI settings...";
  try {
    const data = await api("/api/ai-settings", {
      method: "POST",
      body: JSON.stringify(readAiSettingsForm())
    });
    aiSettings = data.settings;
    renderAiSettings();
    $("aiSettingsStatus").textContent = "AI settings saved.";
    $("aiSettingsStatus").className = "notice ok";
  } catch (error) {
    $("aiSettingsStatus").textContent = error.message;
    $("aiSettingsStatus").className = "notice error";
  } finally {
    $("saveAiSettings").disabled = false;
  }
}

async function testAiSettings() {
  $("testAiSettings").disabled = true;
  $("aiSettingsStatus").textContent = "Testing AI provider...";
  try {
    await saveAiSettings();
    const message = await postAgentPrompt("Reply with one short sentence confirming that the A.U.R.A AI provider is connected.");
    $("aiSettingsStatus").textContent = message;
    $("aiSettingsStatus").className = "notice ok";
  } catch (error) {
    $("aiSettingsStatus").textContent = error.message;
    $("aiSettingsStatus").className = "notice error";
  } finally {
    $("testAiSettings").disabled = false;
  }
}

function readAiSettingsForm() {
  return {
    provider: $("aiProvider").value,
    planningModel: $("aiPlanningModel").value,
    executionModel: $("aiExecutionModel").value,
    localEndpoint: $("aiLocalEndpoint").value.trim(),
    localModel: $("aiLocalModel").value.trim(),
    autonomyLevel: Number($("aiAutonomyLevel").value || 1)
  };
}

function renderAiSettings() {
  const settings = aiSettings || {};
  fillModelSelect("aiPlanningModel", settings.planningModel);
  fillModelSelect("aiExecutionModel", settings.executionModel);
  $("aiProvider").value = settings.provider || "opencode";
  $("aiLocalEndpoint").value = settings.localEndpoint || "";
  $("aiLocalModel").value = settings.localModel || "";
  $("aiAutonomyLevel").value = String(settings.autonomyLevel ?? 1);
  updateAiAutonomyLabel();
  $("aiProviderMetric").textContent = providerLabel(settings.provider || "opencode");
  $("aiPlanningMetric").textContent = settings.planningModel || "-";
  $("aiExecutionMetric").textContent = settings.executionModel || "-";
  renderModelCards();
}

function fillModelSelect(id, selected) {
  const options = aiModels.map((model) =>
    `<option value="${esc(model.id)}">${esc(model.label)} - ${esc(model.id)}</option>`
  ).join("");
  $(id).innerHTML = options;
  if (selected && [...$(id).options].some((option) => option.value === selected)) {
    $(id).value = selected;
  }
}

function renderModelCards() {
  $("aiModelCards").innerHTML = aiModels.map((model) => {
    const active = [$("aiPlanningModel").value, $("aiExecutionModel").value].includes(model.id);
    const tags = (model.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("");
    return `<div class="model-card ${active ? "active" : ""}" data-model="${esc(model.id)}">
      <strong>${esc(model.label)}</strong>
      <span>${esc(model.id)}</span>
      <div class="model-tags">${tags}</div>
    </div>`;
  }).join("");
  document.querySelectorAll(".model-card").forEach((card) => {
    card.addEventListener("click", () => {
      $("aiPlanningModel").value = card.dataset.model;
      $("aiExecutionModel").value = card.dataset.model;
      $("aiProvider").value = "openrouter";
      updateAiSettingsPreview();
    });
  });
}

function providerLabel(provider) {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "local") return "Local model";
  return "OpenCode";
}

function updateAiAutonomyLabel() {
  const labels = [
    "Level 0 - read-only explanation",
    "Level 1 - suggestions only",
    "Level 2 - draft plans/configs",
    "Level 3 - user-confirmed execution",
    "Level 4 - guarded autopilot"
  ];
  $("aiAutonomyValue").textContent = labels[Number($("aiAutonomyLevel").value || 1)] || labels[1];
}

function updateAiSettingsPreview() {
  aiSettings = readAiSettingsForm();
  renderAiSettings();
}

function selectedValues(ids) {
  return ids.filter((id) => $(id).checked);
}

function textLines(id) {
  return $(id).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });
  if (name === "topology") renderTopology();
}

function getUiSettings() {
  try {
    return JSON.parse(localStorage.getItem(UI_SETTINGS_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveUiSettings(settings) {
  localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({ ...getUiSettings(), ...settings }));
}

function applyFontScale(value) {
  const scale = Math.min(118, Math.max(90, Number(value) || 100));
  document.documentElement.style.setProperty("--font-scale", String(scale / 100));
  $("fontScale").value = String(scale);
  $("fontScaleValue").textContent = `${scale}%`;
  saveUiSettings({ fontScale: scale });
}

function activateSettingsPanel(name) {
  document.querySelectorAll(".settings-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.settingsPanel === name);
  });
  document.querySelectorAll(".settings-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `settings-${name}`);
  });
}

async function loadTargets() {
  const data = await api("/api/targets");
  targets = data.targets;
  $("target").innerHTML = targets.map((t) => `<option value="${esc(t.target_name)}">${esc(t.target_name)}</option>`).join("");
  if (targets.length === 0) {
    $("status").textContent = "";
    $("targetValidation").textContent = "Create a target in the browser to load its config.";
    $("targetValidation").className = "notice muted";
    $("domains").value = "";
    $("leadRows").innerHTML = "";
    await refreshApiKeys();
    await refreshWordlists();
    return;
  }
  fillDomains();
  await loadTargetConfig();
  await refreshApiKeys();
  await refreshWordlists();
  await refreshLeads();
}

function fillDomains() {
  const target = targets.find((t) => t.target_name === $("target").value);
  $("domains").value = (target?.root_domains || []).join("\n");
}

function updateReconModeUi() {
  const mode = $("reconMode").value;
  $("fullReconOptions").classList.toggle("active", mode === "full");
  if (mode === "single") {
    $("domains").placeholder = "example.com";
  } else if (mode === "list") {
    $("domains").placeholder = "example.com\napp.example.com";
  } else {
    $("domains").placeholder = "Seed domains, one per line\nexample.com";
  }
}

async function loadTargetConfig() {
  const target = $("target").value;
  if (!target) return;
  const data = await api(`/api/targets/${encodeURIComponent(target)}/config`);
  $("targetValidation").textContent = [
    `Loaded ${data.configPath}`,
    "",
    `Program: ${data.config.program_url}`,
    `In scope: ${(data.config.scope?.in_scope || []).join(", ") || "none"}`,
    `Out of scope: ${(data.config.scope?.out_of_scope || []).join(", ") || "none"}`
  ].join("\n");
  $("targetValidation").className = "notice muted";
}

async function createTarget() {
  $("createTarget").disabled = true;
  $("status").textContent = "Creating target...";
  try {
    const data = await api("/api/targets", {
      method: "POST",
      body: JSON.stringify({
        targetName: $("newTargetName").value.trim(),
        programUrl: $("newProgramUrl").value.trim(),
        assetType: $("newAssetType").value,
        inScope: textLines("newInScope"),
        outOfScope: textLines("newOutOfScope")
      })
    });
    $("status").textContent = `Target created: ${data.target.target_name}`;
    $("newTargetName").value = "";
    $("newProgramUrl").value = "";
    $("newInScope").value = "";
    $("newOutOfScope").value = "";
    await loadTargets();
    $("target").value = data.target.target_name;
    fillDomains();
    await loadTargetConfig();
  } catch (error) {
    $("status").textContent = error.errors ? error.errors.join("; ") : error.message;
  } finally {
    $("createTarget").disabled = false;
  }
}

async function startRecon() {
  if (!$("target").value) {
    $("status").textContent = "Create a target before starting recon.";
    activateTab("target");
    return;
  }
  $("start").disabled = true;
  $("status").textContent = "Starting...";
  try {
    const payload = {
      targetName: $("target").value,
      reconMode: $("reconMode").value,
      rootDomains: $("domains").value.split(/\s+/).filter(Boolean),
      fullRecon: {
        include: $("fullWhoisInclude").value.split(/\n+/).map((v) => v.trim()).filter(Boolean),
        exclude: $("fullWhoisExclude").value.split(/\n+/).map((v) => v.trim()).filter(Boolean),
        mode: $("fullWhoisMode").value,
        searchType: $("fullWhoisType").value,
        maxAssetLeads: Number($("maxAssetLeads").value || 250)
      },
      passiveSources: selectedValues(["crtsh", "wayback"]),
      wslTools: selectedValues(["subfinder", "amass", "dnsx", "puredns", "shuffleDns", "gau", "httpx"])
        .map((tool) => tool === "shuffleDns" ? "shuffle-dns" : tool),
      screenshotTools: selectedValues(["aquatone", "eyewitness"]),
      useWsl: $("useWsl").checked,
      wslDistro: $("distro").value,
      timeoutMs: Number($("timeout").value || 180000),
      authorized: $("authorized").checked
    };
    const data = await api("/api/recon-runs", { method: "POST", body: JSON.stringify(payload) });
    activeRunId = data.run.id;
    lastEventId = 0;
    $("runId").textContent = activeRunId;
    $("events").innerHTML = "";
    $("domainRows").innerHTML = "";
    $("serviceRows").innerHTML = "";
    $("artifactRows").innerHTML = "";
    $("status").textContent = "Recon running";
    activateTab("runs");
    if (poll) clearInterval(poll);
    poll = setInterval(refreshRun, 1500);
    await refreshRun();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("start").disabled = false;
  }
}

async function refreshRun() {
  if (!activeRunId) return;
  const [runData, eventData, domainData, serviceData, urlData, screenshotData] = await Promise.all([
    api(`/api/recon-runs/${activeRunId}`),
    api(`/api/recon-runs/${activeRunId}/events?after=${lastEventId}`),
    api(`/api/recon-runs/${activeRunId}/domains`),
    api(`/api/recon-runs/${activeRunId}/http-services`),
    api(`/api/recon-runs/${activeRunId}/urls`),
    api(`/api/recon-runs/${activeRunId}/screenshots`)
  ]);
  $("runStatus").textContent = runData.run.status;
  for (const event of eventData.events) {
    lastEventId = Math.max(lastEventId, event.id);
    const div = document.createElement("div");
    div.className = `event ${event.severity}`;
    div.textContent = `[${event.created_at}] ${event.source || "system"}: ${event.message}`;
    $("events").appendChild(div);
  }
  $("eventCount").textContent = lastEventId;
  $("domainCount").textContent = domainData.domains.length;
  renderDomains(domainData.domains);
  renderServices(serviceData.services);
  renderArtifacts(urlData.urls, screenshotData.screenshots);
  updateTopologyGraph({ domains: domainData.domains, services: serviceData.services, urls: urlData.urls, screenshots: screenshotData.screenshots });
  if (["completed", "failed", "cancelled"].includes(runData.run.status) && poll) {
    clearInterval(poll);
    poll = null;
    $("status").textContent = `Run ${runData.run.status}`;
  }
}

function renderDomains(domains) {
  $("domainRows").innerHTML = domains.map((d) =>
    `<tr><td>${esc(d.domain)}</td><td>${esc(d.kind)}</td><td>${esc(d.source)}</td></tr>`
  ).join("");
}

function renderServices(services) {
  $("serviceRows").innerHTML = services.map((s) =>
    `<tr><td>${esc(s.url)}</td><td>${esc(s.statusCode || "")}</td><td>${esc(s.title || "")}</td><td>${esc((s.technologies || []).join(", "))}</td></tr>`
  ).join("");
}

function renderArtifacts(urls, screenshots) {
  const urlRows = urls.slice(0, 500).map((u) =>
    `<tr><td>url</td><td>${esc(u.url)}</td><td>${esc((u.params || []).join(", "))}</td></tr>`
  );
  const screenshotRows = screenshots.map((s) =>
    `<tr><td>screenshot</td><td>${esc(s.tool_name)}</td><td>${esc(s.report_path || s.output_dir)}</td></tr>`
  );
  $("artifactRows").innerHTML = screenshotRows.concat(urlRows).join("");
}

async function runSearch() {
  const query = $("searchQuery").value.trim();
  if (!query) {
    $("status").textContent = "Enter a search query.";
    return;
  }
  $("runSearch").disabled = true;
  $("status").textContent = "Searching saved data...";
  try {
    const params = new URLSearchParams({ q: query, limit: "200" });
    if ($("searchCurrentTarget").checked && $("target").value) params.set("target", $("target").value);
    const data = await api(`/api/search?${params.toString()}`);
    renderSearchResults(data.results);
    $("status").textContent = `Search returned ${data.results.length} results`;
    activateTab("search");
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("runSearch").disabled = false;
  }
}

function renderSearchResults(results) {
  $("searchRows").innerHTML = results.map((result) =>
    `<tr><td>${esc(result.result_type)}</td><td>${esc(result.target_name)}</td><td>${esc(result.value)}</td><td>${esc(result.detail || "")}</td><td>${esc(result.source || "")}</td><td>${esc(result.seen_at || "")}</td></tr>`
  ).join("");
}

function updateTopologyGraph({ domains = [], services = [], urls = [], screenshots = [] } = {}) {
  const nodes = [];
  const edges = [];
  const rootId = $("target").value || "workspace";
  nodes.push({ id: rootId, label: rootId, type: "target", x: 0, y: 0 });

  if ($("topologyDomains").checked) {
    domains.slice(0, 120).forEach((domain) => {
      nodes.push({ id: `domain:${domain.domain}`, label: domain.domain, type: "domain" });
      edges.push({ from: rootId, to: `domain:${domain.domain}`, type: domain.source || "discovered" });
    });
  }
  if ($("topologyServices").checked) {
    services.slice(0, 80).forEach((service) => {
      nodes.push({ id: `service:${service.url}`, label: service.host || service.url, type: "service" });
      edges.push({ from: `domain:${service.host}`, to: `service:${service.url}`, type: "http" });
    });
  }
  if ($("topologyArtifacts").checked) {
    urls.slice(0, 80).forEach((url) => {
      nodes.push({ id: `url:${url.url}`, label: url.path || url.url, type: "url" });
      edges.push({ from: rootId, to: `url:${url.url}`, type: "archive" });
    });
    screenshots.slice(0, 30).forEach((shot) => {
      nodes.push({ id: `screenshot:${shot.id || shot.output_dir}`, label: shot.tool_name || "screenshot", type: "artifact" });
      edges.push({ from: rootId, to: `screenshot:${shot.id || shot.output_dir}`, type: "visual" });
    });
  }

  topologyGraph = nodes.length > 1 ? { nodes: layoutTopology(nodes), edges } : previewTopology(rootId);
  $("topologyNodeCount").textContent = topologyGraph.nodes.length;
  $("topologyEdgeCount").textContent = topologyGraph.edges.length;
  renderTopology();
}

function previewTopology(rootId) {
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
  return { nodes: layoutTopology(nodes), edges };
}

function layoutTopology(nodes) {
  const radius = Math.max(120, Math.min(340, 34 * nodes.length));
  return nodes.map((node, index) => {
    if (index === 0) return { ...node, x: 0, y: 0 };
    const angle = (Math.PI * 2 * (index - 1)) / Math.max(1, nodes.length - 1);
    const ring = radius * (0.55 + ((index % 4) * 0.16));
    return { ...node, x: Math.cos(angle) * ring, y: Math.sin(angle) * ring };
  });
}

function renderTopology() {
  const canvas = $("topologyCanvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawTopology(ctx, rect.width, rect.height);
}

function drawTopology(ctx, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  ctx.clearRect(0, 0, width, height);
  drawTopologyGrid(ctx, width, height);
  const nodeMap = new Map(topologyGraph.nodes.map((node) => [node.id, node]));
  for (const edge of topologyGraph.edges) {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) continue;
    drawEdge(ctx, centerX + from.x, centerY + from.y, centerX + to.x, centerY + to.y, edge.type);
  }
  for (const node of topologyGraph.nodes) {
    drawNode(ctx, centerX + node.x, centerY + node.y, node);
  }
}

function drawTopologyGrid(ctx, width, height) {
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
    domain: ["#8fdcc3", 9],
    service: ["#f2b84b", 8],
    url: ["#9da6b5", 6],
    artifact: ["#ef6f6c", 7],
    phase: ["#8fdcc3", 10]
  };
  const [color, radius] = colors[node.type] || ["#9da6b5", 7];
  const pulse = Math.sin(topologyPulse / 18) * 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius + pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(240, 242, 245, .86)";
  ctx.font = "12px Inter, Segoe UI, sans-serif";
  ctx.fillText(node.label.slice(0, 28), x + radius + 7, y + 4);
}

function animateTopology() {
  topologyPulse += 1;
  renderTopology();
  topologyFrame = window.requestAnimationFrame(animateTopology);
}

function selectTopologyNode(event) {
  const canvas = $("topologyCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width / 2;
  const y = event.clientY - rect.top - rect.height / 2;
  const selected = topologyGraph.nodes.find((node) => Math.hypot(node.x - x, node.y - y) < 18);
  if (!selected) return;
  $("topologySelection").textContent = `${selected.type}: ${selected.label}`;
}

function resetTopology() {
  updateTopologyGraph();
}

function renderSetupTools(tools) {
  $("setupToolRows").innerHTML = tools.map((tool) => {
    const status = tool.installed ? "installed" : tool.status;
    const details = cleanText(tool.version || tool.error || tool.stderr || tool.stdout || "");
    return `<tr><td>${esc(tool.tool_id)}</td><td>${esc(status)}</td><td>${esc(details)}</td></tr>`;
  }).join("");
}

function renderAgentStatus(agent) {
  if (!agent) {
    $("agentStatus").textContent = "OpenCode has not been checked yet.";
    $("agentStatus").className = "notice muted";
    return;
  }
  $("agentStatus").textContent = agent.installed
    ? `OpenCode installed: ${agent.version || agent.binary}`
    : `OpenCode missing: ${agent.error || "not found"}`;
  $("agentStatus").className = agent.installed ? "notice ok" : "notice warn";
}

async function checkEnvironment() {
  $("checkEnvironment").disabled = true;
  $("status").textContent = "Checking environment...";
  try {
    const distro = $("setupDistro").value.trim() || "kali-linux";
    const data = await api(`/api/environment/check?distro=${encodeURIComponent(distro)}`);
    renderAgentStatus(data.environment.agent);
    renderSetupTools(data.environment.tools);
    $("setupLog").textContent = data.environment.environmentAvailable
      ? `${data.environment.mode} environment detected: ${data.environment.distroName || data.environment.distro}`
      : `${data.environment.mode} environment is not available: ${data.environment.distro}`;
    $("setupLog").className = data.environment.environmentAvailable ? "notice ok" : "notice error";
    $("status").textContent = "Environment check completed";
  } catch (error) {
    $("setupLog").textContent = error.message;
    $("setupLog").className = "notice error";
    $("status").textContent = error.message;
  } finally {
    $("checkEnvironment").disabled = false;
  }
}

async function installEnvironment() {
  $("installEnvironment").disabled = true;
  $("status").textContent = "Installing tools...";
  try {
    const data = await api("/api/environment/install", {
      method: "POST",
      body: JSON.stringify({ distro: $("setupDistro").value.trim() || "kali-linux" })
    });
    const [agent, ...tools] = data.environment.tools;
    const prerequisites = agent?.tool_id === "system-prerequisites" ? agent : null;
    const runtime = prerequisites ? tools.shift() : agent;
    renderAgentStatus({
      ...runtime,
      installed: runtime?.status === "completed",
      version: runtime?.status === "completed" ? "installed" : null
    });
    renderSetupTools(tools.map((tool) => ({
      ...tool,
      installed: tool.status === "completed",
      version: tool.status === "completed" ? "installed" : null
    })));
    $("setupLog").textContent = data.environment.tools.map((tool) => cleanText([
      `${tool.tool_id}: ${tool.status}${tool.error ? ` - ${tool.error}` : ""}`,
      tool.stdout ? `stdout:\n${tool.stdout}` : "",
      tool.stderr ? `stderr:\n${tool.stderr}` : ""
    ].filter(Boolean).join("\n"))).join("\n\n");
    $("setupLog").className = "notice muted";
    $("status").textContent = "Tool installation completed";
  } catch (error) {
    $("setupLog").textContent = error.message;
    $("setupLog").className = "notice error";
    $("status").textContent = error.message;
  } finally {
    $("installEnvironment").disabled = false;
  }
}

function appendAiMessage(role, text) {
  const message = document.createElement("div");
  message.className = `ai-message ${role}`;
  message.textContent = text;
  $("aiMessages").appendChild(message);
  $("aiMessages").scrollTop = $("aiMessages").scrollHeight;
}

function sendAiPrompt() {
  const prompt = $("aiPrompt").value.trim();
  if (!prompt) return;
  appendAiMessage("user", prompt);
  $("aiPrompt").value = "";
  postAgentPrompt(prompt)
    .then((message) => appendAiMessage("assistant", message))
    .catch((error) => appendAiMessage("assistant", error.message));
}

function getAiWindowState() {
  try {
    return JSON.parse(localStorage.getItem(AI_WINDOW_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveAiWindowState() {
  const panel = $("aiPanel");
  const rect = panel.getBoundingClientRect();
  localStorage.setItem(AI_WINDOW_STORAGE_KEY, JSON.stringify({
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    minimized: panel.classList.contains("minimized")
  }));
}

function applyAiWindowState() {
  const panel = $("aiPanel");
  const state = getAiWindowState();
  if (Number.isFinite(state.width)) panel.style.width = `${state.width}px`;
  if (Number.isFinite(state.height)) panel.style.height = `${state.height}px`;
  if (Number.isFinite(state.left)) panel.style.left = `${state.left}px`;
  if (Number.isFinite(state.top)) panel.style.top = `${state.top}px`;
  if (state.minimized) {
    panel.classList.add("minimized");
    $("aiRestore").classList.add("active");
  }
  clampAiPanel();
}

function clampAiPanel() {
  const panel = $("aiPanel");
  if (panel.classList.contains("minimized")) return;
  const margin = 16;
  const minWidth = 280;
  const minHeight = 240;
  const maxWidth = Math.max(minWidth, window.innerWidth - margin * 2);
  const maxHeight = Math.max(minHeight, window.innerHeight - margin * 2);
  const rect = panel.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width, minWidth), maxWidth);
  const height = Math.min(Math.max(rect.height, minHeight), maxHeight);
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
  const top = Math.min(Math.max(rect.top, margin), window.innerHeight - height - margin);
  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function minimizeAiPanel() {
  $("aiPanel").classList.add("minimized");
  $("aiRestore").classList.add("active");
  saveAiWindowState();
}

function restoreAiPanel() {
  $("aiPanel").classList.remove("minimized");
  $("aiRestore").classList.remove("active");
  clampAiPanel();
  saveAiWindowState();
}

function startAiDrag(event) {
  if (event.target.closest("button")) return;
  const panel = $("aiPanel");
  const rect = panel.getBoundingClientRect();
  aiWindowDrag = {
    type: "move",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
  $("aiDragHandle").setPointerCapture(event.pointerId);
}

function startAiResize(event) {
  const panel = $("aiPanel");
  const rect = panel.getBoundingClientRect();
  aiWindowDrag = {
    type: "resize",
    edge: event.target.dataset.resize,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
  event.target.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function updateAiWindow(event) {
  if (!aiWindowDrag) return;
  const panel = $("aiPanel");
  const deltaX = event.clientX - aiWindowDrag.startX;
  const deltaY = event.clientY - aiWindowDrag.startY;
  let { left, top, width, height } = aiWindowDrag;
  if (aiWindowDrag.type === "move") {
    left += deltaX;
    top += deltaY;
  } else {
    if (aiWindowDrag.edge.includes("e")) width += deltaX;
    if (aiWindowDrag.edge.includes("s")) height += deltaY;
    if (aiWindowDrag.edge.includes("w")) {
      width -= deltaX;
      left += deltaX;
    }
    if (aiWindowDrag.edge.includes("n")) {
      height -= deltaY;
      top += deltaY;
    }
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
  clampAiPanel();
}

function endAiWindowEdit() {
  if (!aiWindowDrag) return;
  aiWindowDrag = null;
  clampAiPanel();
  saveAiWindowState();
}

async function saveApiKey() {
  $("saveApiKey").disabled = true;
  $("status").textContent = "Saving API key...";
  try {
    await api("/api/api-keys", {
      method: "POST",
      body: JSON.stringify({
        provider: $("keyProvider").value.trim(),
        label: $("keyLabel").value.trim(),
        apiKey: $("apiKeyValue").value.trim(),
        monthlyLimit: $("keyMonthlyLimit").value ? Number($("keyMonthlyLimit").value) : null
      })
    });
    $("apiKeyValue").value = "";
    $("status").textContent = "API key saved";
    await refreshApiKeys();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("saveApiKey").disabled = false;
  }
}

async function saveWordlist() {
  $("saveWordlist").disabled = true;
  $("status").textContent = "Saving wordlist...";
  try {
    await api("/api/wordlists", {
      method: "POST",
      body: JSON.stringify({
        name: $("wordlistName").value.trim(),
        category: $("wordlistCategory").value,
        path: $("wordlistPath").value.trim(),
        status: $("wordlistStatus").value,
        notes: $("wordlistNotes").value.trim()
      })
    });
    $("status").textContent = "Wordlist saved";
    await refreshWordlists();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("saveWordlist").disabled = false;
  }
}

async function generateWordlist() {
  $("generateWordlist").disabled = true;
  $("status").textContent = "Generating wordlist...";
  try {
    const data = await api("/api/wordlists/generate", {
      method: "POST",
      body: JSON.stringify({
        targetName: $("target").value || null,
        name: $("generatedWordlistName").value.trim(),
        category: $("generatedWordlistCategory").value
      })
    });
    $("status").textContent = `Generated ${data.generated.count} entries`;
    await refreshWordlists();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("generateWordlist").disabled = false;
  }
}

async function refreshWordlists() {
  const data = await api("/api/wordlists");
  $("wordlistRows").innerHTML = data.wordlists.map((wordlist) =>
    `<tr><td>${esc(wordlist.name)}</td><td>${esc(wordlist.category)}</td><td>${esc(wordlist.status)}</td><td>${esc(wordlist.path)}</td></tr>`
  ).join("");
}

async function refreshApiKeys() {
  const data = await api("/api/api-keys");
  $("apiKeyRows").innerHTML = data.apiKeys.map((key) =>
    `<tr><td>${esc(key.provider)}</td><td>${esc(key.label)}</td><td>${esc(key.key_preview)}</td><td>${esc(key.status)}</td><td>${esc(key.used_count)}/${esc(key.monthly_limit || "unlimited")}</td></tr>`
  ).join("");
}

async function runReverseWhois() {
  if (!$("target").value) {
    $("status").textContent = "Create a target before running asset discovery.";
    activateTab("target");
    return;
  }
  $("reverseWhois").disabled = true;
  $("status").textContent = "Reverse WHOIS running...";
  try {
    const data = await api("/api/asset-discovery/reverse-whois", {
      method: "POST",
      body: JSON.stringify({
        targetName: $("target").value,
        include: $("whoisInclude").value.split(/\n+/).map((v) => v.trim()).filter(Boolean),
        exclude: $("whoisExclude").value.split(/\n+/).map((v) => v.trim()).filter(Boolean),
        mode: $("whoisMode").value,
        searchType: $("whoisType").value,
        authorized: $("authorized").checked
      })
    });
    $("status").textContent = `Reverse WHOIS: ${data.summary.domainsCount} matches, ${data.summary.savedLeads} saved leads`;
    await refreshLeads();
    activateTab("assetDiscovery");
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("reverseWhois").disabled = false;
  }
}

async function refreshLeads() {
  const target = $("target").value;
  if (!target) return;
  const data = await api(`/api/targets/${encodeURIComponent(target)}/asset-leads`);
  $("leadRows").innerHTML = data.leads.map((lead) =>
    `<tr><td>${esc(lead.value)}</td><td>${esc(lead.source)}</td><td>${esc(lead.confidence)}</td><td>${esc((lead.matchTerms || []).join(", "))}</td></tr>`
  ).join("");
}

$("target").addEventListener("change", () => {
  fillDomains();
  loadTargetConfig().catch((error) => {
    $("status").textContent = error.message;
  });
  refreshLeads().catch((error) => {
    $("status").textContent = error.message;
  });
});
$("reconMode").addEventListener("change", updateReconModeUi);
$("start").addEventListener("click", startRecon);
$("reverseWhois").addEventListener("click", runReverseWhois);
$("saveApiKey").addEventListener("click", saveApiKey);
$("saveWordlist").addEventListener("click", saveWordlist);
$("generateWordlist").addEventListener("click", generateWordlist);
$("runSearch").addEventListener("click", runSearch);
$("searchQuery").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});
$("createTarget").addEventListener("click", createTarget);
$("checkEnvironment").addEventListener("click", checkEnvironment);
$("installEnvironment").addEventListener("click", installEnvironment);
$("saveAiSettings").addEventListener("click", saveAiSettings);
$("testAiSettings").addEventListener("click", testAiSettings);
$("aiProvider").addEventListener("change", updateAiSettingsPreview);
$("aiPlanningModel").addEventListener("change", updateAiSettingsPreview);
$("aiExecutionModel").addEventListener("change", updateAiSettingsPreview);
$("aiAutonomyLevel").addEventListener("input", () => {
  updateAiAutonomyLabel();
  updateAiSettingsPreview();
});
$("sendAiPrompt").addEventListener("click", sendAiPrompt);
$("aiMinimize").addEventListener("click", minimizeAiPanel);
$("aiRestore").addEventListener("click", restoreAiPanel);
$("aiDragHandle").addEventListener("pointerdown", startAiDrag);
document.querySelectorAll(".ai-resize-handle").forEach((handle) => {
  handle.addEventListener("pointerdown", startAiResize);
});
window.addEventListener("pointermove", updateAiWindow);
window.addEventListener("pointerup", endAiWindowEdit);
window.addEventListener("resize", () => {
  clampAiPanel();
  saveAiWindowState();
});
$("aiPrompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    sendAiPrompt();
  }
});
$("topologyCanvas").addEventListener("click", selectTopologyNode);
$("fitTopology").addEventListener("click", resetTopology);
$("pulseTopology").addEventListener("click", renderTopology);
["topologyDomains", "topologyServices", "topologyArtifacts", "topologyCandidates"].forEach((id) => {
  $(id).addEventListener("change", resetTopology);
});
document.querySelectorAll(".settings-tab").forEach((button) => {
  button.addEventListener("click", () => activateSettingsPanel(button.dataset.settingsPanel));
});
$("fontScale").addEventListener("input", () => applyFontScale($("fontScale").value));
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

loadTargets().catch((error) => {
  $("status").textContent = error.message;
});
loadAiSettings().catch((error) => {
  $("aiSettingsStatus").textContent = error.message;
  $("aiSettingsStatus").className = "notice error";
});
updateReconModeUi();
applyAiWindowState();
applyFontScale(getUiSettings().fontScale || 100);
updateTopologyGraph();
if (!topologyFrame) animateTopology();
