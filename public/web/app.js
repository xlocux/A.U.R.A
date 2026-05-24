"use strict";

let targets = [];
let activeRunId = null;
let lastEventId = 0;
let poll = null;
let topologyFrame = null;
let topologyPulse = 0;
let topologyGraph = { nodes: [], edges: [] };
let topologyData = { domains: [], services: [], urls: [], screenshots: [] };
let topologyView = { zoom: 1, offsetX: 0, offsetY: 0 };
let latestRunActivity = "";
let aiSettings = null;
let aiModels = [];
let aiRuntimeStatus = null;

const $ = (id) => document.getElementById(id);
const UI_SETTINGS_STORAGE_KEY = "aura.uiSettings";
const ACTIVE_TARGET_STORAGE_KEY = "aura.activeTarget";
const API_KEY_PROVIDER_HINTS = {
  openrouter: {
    label: "free-models",
    placeholder: "OpenRouter API key",
    monthlyLimit: ""
  },
  shodan: {
    label: "free-api",
    placeholder: "Shodan API key",
    monthlyLimit: "100"
  },
  censys: {
    label: "free-api",
    placeholder: "Censys API ID:Secret or API token",
    monthlyLimit: "250"
  },
  securitytrails: {
    label: "free-api",
    placeholder: "SecurityTrails API key",
    monthlyLimit: "50"
  },
  chaos: {
    label: "community",
    placeholder: "ProjectDiscovery Chaos API key",
    monthlyLimit: ""
  },
  github: {
    label: "public-code-search",
    placeholder: "GitHub personal access token",
    monthlyLimit: "5000"
  },
  whoisxmlapi: {
    label: "trial",
    placeholder: "WhoisXMLAPI key",
    monthlyLimit: "50"
  },
  builtwith: {
    label: "technology-provider",
    placeholder: "BuiltWith API key",
    monthlyLimit: ""
  },
  custom: {
    label: "custom",
    placeholder: "Provider API key",
    monthlyLimit: ""
  }
};

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

window.auraApi = api;
window.getAuraAgentContext = () => ({
  targetName: $("target")?.value || "",
  runId: activeRunId,
  distro: $("setupDistro")?.value?.trim() || "kali-linux"
});

async function loadAiSettings() {
  const data = await api("/api/ai-settings");
  aiSettings = data.settings;
  aiModels = data.models || [];
  renderAiSettings();
  await loadAiRuntimeStatus();
}

async function loadAiRuntimeStatus() {
  try {
    const params = new URLSearchParams({ distro: $("setupDistro")?.value?.trim() || "kali-linux" });
    const data = await api(`/api/ai-runtime/status?${params.toString()}`);
    aiRuntimeStatus = data;
    renderAiRuntimeStatus();
  } catch (error) {
    $("aiRuntimeStatus").textContent = `Runtime status unavailable: ${error.message}`;
  }
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
    const message = await window.AuraAiAgent.ask("Reply with one short sentence confirming that the A.U.R.A AI provider is connected.");
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
  const useLocalModel = $("useLocalModel").checked;
  return {
    provider: useLocalModel ? "local" : $("aiProvider").value,
    planningModel: $("aiPlanningModel").value,
    executionModel: $("aiExecutionModel").value,
    localEndpoint: $("aiLocalEndpoint").value.trim(),
    localModel: $("aiLocalModel").value.trim(),
    autonomyLevel: Number($("aiAutonomyLevel").value || 1)
  };
}

function renderAiSettings() {
  const settings = aiSettings || {};
  const useLocalModel = settings.provider === "local";
  fillModelSelect("aiPlanningModel", settings.planningModel);
  fillModelSelect("aiExecutionModel", settings.executionModel);
  $("useLocalModel").checked = useLocalModel;
  $("aiProvider").value = useLocalModel ? "openrouter" : settings.provider || "opencode";
  $("aiProvider").disabled = useLocalModel;
  $("aiLocalEndpoint").value = settings.localEndpoint || "";
  $("aiLocalModel").value = settings.localModel || "";
  $("aiLocalEndpoint").disabled = !useLocalModel;
  $("aiLocalModel").disabled = !useLocalModel;
  $("aiAutonomyLevel").value = String(settings.autonomyLevel ?? 1);
  updateAiAutonomyLabel();
  $("aiProviderMetric").textContent = providerLabel(settings.provider || "opencode");
  $("aiPlanningMetric").textContent = settings.planningModel || "-";
  $("aiExecutionMetric").textContent = settings.executionModel || "-";
  renderModelCards();
  renderAiRuntimeStatus();
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
      $("useLocalModel").checked = false;
      $("aiProvider").value = "openrouter";
      updateAiSettingsPreview();
    });
  });
}

function providerLabel(provider) {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "codex") return "Codex CLI";
  if (provider === "claude") return "Claude Code";
  if (provider === "local") return "Local model";
  return "OpenCode";
}

function renderAiRuntimeStatus() {
  const output = $("aiRuntimeStatus");
  if (!output) return;
  if (!aiRuntimeStatus) {
    output.textContent = "Runtime status has not been loaded yet.";
    return;
  }
  const runtimes = aiRuntimeStatus.runtimes || {};
  const lines = [
    `Environment: ${aiRuntimeStatus.mode || "-"} (${aiRuntimeStatus.distro || "-"})`,
    "",
    formatRuntimeStatus("OpenCode", runtimes.opencode),
    formatRuntimeStatus("Codex CLI", runtimes.codex),
    formatRuntimeStatus("Claude Code", runtimes.claude),
    "",
    "OpenCode config:",
    aiRuntimeStatus.opencodeConfig?.detail || "No OpenCode config detail available."
  ];
  output.textContent = lines.join("\n");
}

function formatRuntimeStatus(label, runtime) {
  if (!runtime) return `${label}: unknown`;
  return `${label}: ${runtime.installed ? "installed" : "not found"}\n${runtime.detail || ""}`;
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

function applyTheme(value) {
  const theme = ["aura", "raven", "ember", "violet", "mono"].includes(value) ? value : "aura";
  document.documentElement.dataset.theme = theme === "aura" ? "" : theme;
  $("themeSelect").value = theme;
  saveUiSettings({ theme });
  window.dispatchEvent(new CustomEvent("aura:appearance-change"));
}

function applyBackgroundEffect(value) {
  const effect = value || "random";
  $("backgroundEffect").value = effect;
  saveUiSettings({ backgroundEffect: effect });
  window.dispatchEvent(new CustomEvent("aura:background-effect", { detail: { effect } }));
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
  $("deleteTarget").disabled = targets.length === 0;
  if (targets.length === 0) {
    $("status").textContent = "";
    $("targetValidation").textContent = "Create a target in Recon to load its config.";
    $("targetValidation").className = "notice muted";
    $("domains").value = "";
    $("leadRows").innerHTML = "";
    $("target").innerHTML = "";
    localStorage.removeItem(ACTIVE_TARGET_STORAGE_KEY);
    clearRunView();
    await refreshApiKeys();
    await refreshWordlists();
    return;
  }
  const savedTarget = localStorage.getItem(ACTIVE_TARGET_STORAGE_KEY);
  if (savedTarget && targets.some((target) => target.target_name === savedTarget)) {
    $("target").value = savedTarget;
  }
  fillDomains();
  await loadTargetConfig();
  await refreshApiKeys();
  await refreshWordlists();
  await refreshLeads();
  await restoreLatestRunForSelectedTarget();
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
  localStorage.setItem(ACTIVE_TARGET_STORAGE_KEY, target);
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

function clearRunView() {
  activeRunId = null;
  lastEventId = 0;
  window.AuraAiAgent.resetRunFeed(null);
  if (poll) clearInterval(poll);
  poll = null;
  $("events").innerHTML = "";
  $("domainRows").innerHTML = "";
  $("serviceRows").innerHTML = "";
  $("technologyRows").innerHTML = "";
  $("screenshotRows").innerHTML = "";
  $("artifactRows").innerHTML = "";
  $("runId").textContent = "-";
  $("runStatus").textContent = "idle";
  $("domainCount").textContent = "0";
  $("urlCount").textContent = "0";
  $("serviceCount").textContent = "0";
  $("technologyCount").textContent = "0";
  $("screenshotCount").textContent = "0";
  $("eventCount").textContent = "0";
  renderRunDelta(null);
  latestRunActivity = "";
  updateRunControlButtons("idle");
  updateTopologyGraph();
  renderRunActivity();
}

async function restoreLatestRunForSelectedTarget() {
  const target = $("target").value;
  if (!target) {
    clearRunView();
    return;
  }
  const data = await api(`/api/targets/${encodeURIComponent(target)}/latest-run`);
  if (!data.run) {
    clearRunView();
    return;
  }
  activeRunId = data.run.id;
  lastEventId = 0;
  $("runId").textContent = activeRunId;
  $("events").innerHTML = "";
  await refreshRun();
  if (!["completed", "failed", "cancelled"].includes(data.run.status)) {
    if (poll) clearInterval(poll);
    poll = setInterval(refreshRun, 1500);
  }
  $("status").textContent = `Loaded saved run ${activeRunId}`;
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
        inScope: textLines("newInScope"),
        outOfScope: textLines("newOutOfScope"),
        authorized: $("authorized").checked,
        wslDistro: $("distro").value,
        timeoutMs: Number($("timeout").value || 180000)
      })
    });
    $("status").textContent = data.bootstrapRun
      ? `Target created: ${data.target.target_name}. Bootstrap recon started.`
      : `Target created: ${data.target.target_name}`;
    $("newTargetName").value = "";
    $("newProgramUrl").value = "";
    $("newInScope").value = "";
    $("newOutOfScope").value = "";
    await loadTargets();
    $("target").value = data.target.target_name;
    fillDomains();
    await loadTargetConfig();
    if (data.bootstrapRun?.id) {
      activeRunId = data.bootstrapRun.id;
      lastEventId = 0;
      window.AuraAiAgent.resetRunFeed(activeRunId);
      $("runId").textContent = activeRunId;
      $("events").innerHTML = "";
      $("domainRows").innerHTML = "";
      $("serviceRows").innerHTML = "";
      $("artifactRows").innerHTML = "";
      localStorage.setItem(ACTIVE_TARGET_STORAGE_KEY, data.target.target_name);
      activateTab("runs");
      if (poll) clearInterval(poll);
      poll = setInterval(refreshRun, 1500);
      await refreshRun();
    }
  } catch (error) {
    $("status").textContent = error.errors ? error.errors.join("; ") : error.message;
  } finally {
    $("createTarget").disabled = false;
  }
}

async function deleteTarget() {
  const targetName = $("target").value;
  if (!targetName) {
    $("status").textContent = "Select a target to delete.";
    return;
  }
  const confirmed = window.confirm(`Delete target "${targetName}" and its local runs, observations, and artifacts?`);
  if (!confirmed) return;
  $("deleteTarget").disabled = true;
  $("status").textContent = `Deleting target: ${targetName}`;
  try {
    await api(`/api/targets/${encodeURIComponent(targetName)}`, { method: "DELETE" });
    clearRunView();
    localStorage.removeItem(ACTIVE_TARGET_STORAGE_KEY);
    $("leadRows").innerHTML = "";
    $("status").textContent = `Target deleted: ${targetName}`;
    await loadTargets();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("deleteTarget").disabled = targets.length === 0;
  }
}

async function startRecon() {
  if (!$("target").value) {
    $("status").textContent = "Create a target before starting recon.";
    activateTab("recon");
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
      screenshotTools: selectedValues(["gowitness", "aquatone", "eyewitness"]),
      useWsl: $("useWsl").checked,
      wslDistro: $("distro").value,
      timeoutMs: Number($("timeout").value || 180000),
      authorized: $("authorized").checked
    };
    const data = await api("/api/recon-runs", { method: "POST", body: JSON.stringify(payload) });
    activeRunId = data.run.id;
    lastEventId = 0;
    window.AuraAiAgent.resetRunFeed(activeRunId);
    $("runId").textContent = activeRunId;
    $("events").innerHTML = "";
    $("domainRows").innerHTML = "";
    $("serviceRows").innerHTML = "";
    $("technologyRows").innerHTML = "";
    $("screenshotRows").innerHTML = "";
    $("artifactRows").innerHTML = "";
    renderRunDelta(null);
    localStorage.setItem(ACTIVE_TARGET_STORAGE_KEY, $("target").value);
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
  const [runData, eventData, countData, domainData, serviceData, technologyData, urlData, screenshotData, deltaData] = await Promise.all([
    api(`/api/recon-runs/${activeRunId}`),
    api(`/api/recon-runs/${activeRunId}/events?after=${lastEventId}`),
    api(`/api/recon-runs/${activeRunId}/counts`),
    api(`/api/recon-runs/${activeRunId}/domains`),
    api(`/api/recon-runs/${activeRunId}/http-services`),
    api(`/api/recon-runs/${activeRunId}/technologies`),
    api(`/api/recon-runs/${activeRunId}/urls`),
    api(`/api/recon-runs/${activeRunId}/screenshots`),
    api(`/api/recon-runs/${activeRunId}/delta`)
  ]);
  $("runStatus").textContent = runData.run.status;
  updateRunControlButtons(runData.run.status);
  renderRunActivity(runData.run, eventData.events);
  for (const event of eventData.events) {
    lastEventId = Math.max(lastEventId, event.id);
    const div = document.createElement("div");
    div.className = `event ${event.severity}`;
    div.textContent = `[${event.created_at}] ${event.source || "system"}: ${event.message}`;
    $("events").appendChild(div);
  }
  const counts = countData.counts || {};
  $("eventCount").textContent = counts.events ?? lastEventId;
  $("domainCount").textContent = counts.domains ?? domainData.domains.length;
  $("urlCount").textContent = counts.urls ?? urlData.urls.length;
  $("serviceCount").textContent = counts.httpServices ?? serviceData.services.length;
  $("technologyCount").textContent = counts.technologies ?? technologyData.technologies.length;
  $("screenshotCount").textContent = counts.screenshots ?? screenshotData.screenshots.length;
  renderDomains(domainData.domains, counts.domains);
  renderServices(serviceData.services, counts.httpServices);
  renderTechnologies(technologyData.technologies, counts.technologies);
  renderScreenshots(screenshotData.screenshots, counts.screenshots);
  renderArtifacts(urlData.urls, screenshotData.screenshots);
  renderRunDelta(deltaData.delta);
  updateTopologyGraph({ domains: domainData.domains, services: serviceData.services, urls: urlData.urls, screenshots: screenshotData.screenshots });
  if (runData.run.target_name === $("target").value) {
    refreshLeads().catch(() => {});
  }
  if (["completed", "failed", "cancelled"].includes(runData.run.status) && poll) {
    clearInterval(poll);
    poll = null;
    $("status").textContent = `Run ${runData.run.status}`;
  }
  window.AuraAiAgent.publishRunInsights({
    run: runData.run,
    events: eventData.events,
    counts,
    delta: deltaData.delta,
    technologies: technologyData.technologies,
    screenshots: screenshotData.screenshots
  });
}

function renderRunActivity(run = null, newEvents = []) {
  if (!run) {
    $("runActivity").textContent = "No active run loaded.";
    return;
  }
  const latestToolEvent = [...newEvents].reverse().find((event) =>
    ["recon", "heartbeat", "whois-rdap", "bootstrap"].includes(event.phase) && event.source
  );
  if (latestToolEvent) latestRunActivity = `${latestToolEvent.source} - ${latestToolEvent.message}`;
  const checkpoint = run.checkpoint || {};
  $("runActivity").textContent = [
    `Run ${run.id}: ${run.status}`,
    `Phase: ${run.active_phase || "-"}`,
    latestRunActivity ? `Latest activity: ${latestRunActivity}` : "",
    checkpoint.rootDomains?.length ? `Seeds: ${checkpoint.rootDomains.join(", ")}` : "",
    run.error_message ? `Error: ${run.error_message}` : ""
  ].filter(Boolean).join("\n");
}

function updateRunControlButtons(status) {
  const hasRun = Boolean(activeRunId);
  $("pauseRun").disabled = !hasRun || !["queued", "running"].includes(status);
  $("resumeRun").disabled = !hasRun || status !== "paused";
  $("cancelRun").disabled = !hasRun || ["completed", "failed", "cancelled", "idle"].includes(status);
  $("runHttpFollowup").disabled = !hasRun || !["completed", "failed", "cancelled"].includes(status);
}

async function updateRunControl(action) {
  if (!activeRunId) {
    $("status").textContent = "No active run is loaded.";
    return;
  }
  $("status").textContent = `${action[0].toUpperCase()}${action.slice(1)} requested for run ${activeRunId}`;
  try {
    const data = await api(`/api/recon-runs/${activeRunId}/${action}`, { method: "POST" });
    $("runStatus").textContent = data.run.status;
    updateRunControlButtons(data.run.status);
    await refreshRun();
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runHttpFollowup() {
  if (!activeRunId) {
    $("status").textContent = "Load a completed run before starting an HTTP/tech follow-up.";
    return;
  }
  $("runHttpFollowup").disabled = true;
  $("status").textContent = `Starting HTTP/tech follow-up from run ${activeRunId}...`;
  try {
    const data = await api(`/api/recon-runs/${activeRunId}/follow-up/http`, {
      method: "POST",
      body: JSON.stringify({
        screenshotTools: selectedValues(["gowitness", "aquatone", "eyewitness"]),
        useWsl: $("useWsl").checked,
        wslDistro: $("distro").value,
        timeoutMs: Number($("timeout").value || 180000)
      })
    });
    activeRunId = data.run.id;
    lastEventId = 0;
    window.AuraAiAgent.resetRunFeed(activeRunId);
    $("runId").textContent = activeRunId;
    $("events").innerHTML = "";
    $("domainRows").innerHTML = "";
    $("serviceRows").innerHTML = "";
    $("technologyRows").innerHTML = "";
    $("screenshotRows").innerHTML = "";
    $("artifactRows").innerHTML = "";
    renderRunDelta(null);
    $("status").textContent = `HTTP/tech follow-up running for ${data.sourceDomainCount} saved domains`;
    activateTab("runs");
    if (poll) clearInterval(poll);
    poll = setInterval(refreshRun, 1500);
    await refreshRun();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    updateRunControlButtons($("runStatus").textContent);
  }
}

function renderDomains(domains, total = domains.length) {
  $("domainRowsHint").textContent = total > domains.length ? `showing ${domains.length} of ${total}` : `${domains.length} shown`;
  $("domainRows").innerHTML = domains.map((d) =>
    `<tr><td>${esc(d.domain)}</td><td>${esc(d.kind)}</td><td>${esc(d.source)}</td></tr>`
  ).join("");
}

function renderServices(services, total = services.length) {
  $("serviceRowsHint").textContent = total > services.length ? `showing ${services.length} of ${total}` : `${services.length} shown`;
  $("serviceRows").innerHTML = services.map((s) =>
    `<tr><td>${esc(s.url)}</td><td>${esc(s.statusCode || "")}</td><td>${esc(s.title || "")}</td><td>${esc((s.technologies || []).join(", "))}</td></tr>`
  ).join("");
}

function renderArtifacts(urls, screenshots) {
  const urlRows = urls.slice(0, 500).map((u) =>
    `<tr><td>url</td><td>${esc(u.url)}</td><td>${esc((u.params || []).join(", "))}</td></tr>`
  );
  $("artifactRows").innerHTML = urlRows.join("");
}

function renderTechnologies(technologies, total = technologies.length) {
  $("technologyRowsHint").textContent = total > technologies.length ? `showing ${technologies.length} of ${total}` : `${technologies.length} shown`;
  $("technologyRows").innerHTML = technologies.map((tech) =>
    `<tr><td>${esc(tech.name)}</td><td>${esc(tech.count)}</td><td>${esc(tech.hostCount)}</td><td>${esc(tech.source || "")}</td></tr>`
  ).join("");
}

function renderScreenshots(screenshots, total = screenshots.length) {
  $("screenshotRowsHint").textContent = total > screenshots.length ? `showing ${screenshots.length} of ${total}` : `${screenshots.length} shown`;
  $("screenshotRows").innerHTML = screenshots.map((shot) => {
    const count = shot.metadata?.screenshotCount ?? "-";
    const path = shot.report_path || shot.output_dir || "-";
    return `<tr><td>${esc(shot.tool_name)}</td><td>${esc(count)}</td><td>${esc(path)}</td></tr>`;
  }).join("");
}

function renderRunDelta(delta) {
  if (!delta) {
    $("runDeltaSummary").textContent = "No run comparison loaded.";
    $("deltaNewDomains").textContent = "0";
    $("deltaRemovedDomains").textContent = "0";
    $("deltaNewUrls").textContent = "0";
    $("deltaNewServices").textContent = "0";
    $("deltaRows").innerHTML = "";
    return;
  }
  if (!delta.comparedToRunId) {
    $("runDeltaSummary").textContent = "This is the first saved run for this target. Future rescans will show added and removed observations here.";
  } else {
    $("runDeltaSummary").textContent = `Compared with run ${delta.comparedToRunId} from ${delta.comparedToStartedAt || "unknown time"}. Stable domains: ${delta.domains.stableCount}.`;
  }
  $("deltaNewDomains").textContent = delta.domains.addedCount;
  $("deltaRemovedDomains").textContent = delta.domains.removedCount;
  $("deltaNewUrls").textContent = delta.urls.addedCount;
  $("deltaNewServices").textContent = delta.httpServices.addedCount;
  const rows = []
    .concat(deltaRows("added", "domain", delta.domains.added, "domain"))
    .concat(deltaRows("removed", "domain", delta.domains.removed, "domain"))
    .concat(deltaRows("added", "url", delta.urls.added, "url"))
    .concat(deltaRows("added", "http_service", delta.httpServices.added, "url"));
  $("deltaRows").innerHTML = rows.slice(0, 250).join("");
}

function deltaRows(change, type, items, valueKey) {
  return (items || []).map((item) =>
    `<tr><td><span class="delta-badge ${change}">${esc(change)}</span></td><td>${esc(type)}</td><td>${esc(item[valueKey])}</td><td>${esc(item.source || "")}</td></tr>`
  );
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

function updateTopologyGraph(data = null) {
  if (data) {
    topologyData = {
      domains: data.domains || [],
      services: data.services || [],
      urls: data.urls || [],
      screenshots: data.screenshots || []
    };
  }
  const { domains, services, urls, screenshots } = topologyData;
  const nodes = [];
  const edges = [];
  const rootId = $("target").value || "workspace";
  nodes.push({ id: rootId, label: rootId, type: "target", x: 0, y: 0 });
  const nodeIds = new Set([rootId]);

  if ($("topologyDomains").checked) {
    const grouped = groupDomainsForTopology(domains);
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
  } else {
    $("topologyHint").textContent = "Topology layers are filtered. Enable domains for the clustered domain map.";
  }
  if ($("topologyServices").checked) {
    services.slice(0, 100).forEach((service) => {
      const serviceId = `service:${service.url}`;
      nodes.push({ id: serviceId, label: service.host || service.url, type: "service", data: service });
      nodeIds.add(serviceId);
      const domainParent = `domain:${service.host}`;
      const clusterParent = `cluster:${rootForTopology(service.host || "")}`;
      const serviceParent = nodeIds.has(domainParent) ? domainParent : nodeIds.has(clusterParent) ? clusterParent : rootId;
      edges.push({ from: serviceParent, to: serviceId, type: "http" });
    });
  }
  if ($("topologyArtifacts").checked) {
    urls.slice(0, 80).forEach((url) => {
      nodes.push({ id: `url:${url.url}`, label: url.path || url.url, type: "url", data: url });
      edges.push({ from: rootId, to: `url:${url.url}`, type: "archive" });
    });
    screenshots.slice(0, 30).forEach((shot) => {
      nodes.push({ id: `screenshot:${shot.id || shot.output_dir}`, label: shot.tool_name || "screenshot", type: "artifact", data: shot });
      edges.push({ from: rootId, to: `screenshot:${shot.id || shot.output_dir}`, type: "visual" });
    });
  }

  topologyGraph = nodes.length > 1 ? { nodes: layoutTopology(nodes), edges } : previewTopology(rootId);
  $("topologyNodeCount").textContent = topologyGraph.nodes.length;
  $("topologyEdgeCount").textContent = topologyGraph.edges.length;
  renderTopology();
}

function groupDomainsForTopology(domains) {
  const groups = new Map();
  for (const domain of domains) {
    const root = domain.rootDomain || rootForTopology(domain.domain || "");
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(domain);
  }
  return [...groups.entries()]
    .map(([root, items]) => ({ root, items: items.sort((left, right) => String(left.domain).localeCompare(String(right.domain))) }))
    .sort((left, right) => right.items.length - left.items.length || left.root.localeCompare(right.root));
}

function rootForTopology(hostname) {
  const clean = String(hostname || "").split(":")[0].toLowerCase();
  const parts = clean.split(".").filter(Boolean);
  if (parts.length <= 2) return clean || "unknown";
  return parts.slice(-2).join(".");
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
  const centerX = width / 2 + topologyView.offsetX;
  const centerY = height / 2 + topologyView.offsetY;
  ctx.clearRect(0, 0, width, height);
  drawTopologyGrid(ctx, width, height);
  const nodeMap = new Map(topologyGraph.nodes.map((node) => [node.id, node]));
  for (const edge of topologyGraph.edges) {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) continue;
    drawEdge(ctx, centerX + from.x * topologyView.zoom, centerY + from.y * topologyView.zoom, centerX + to.x * topologyView.zoom, centerY + to.y * topologyView.zoom, edge.type);
  }
  for (const node of topologyGraph.nodes) {
    drawNode(ctx, centerX + node.x * topologyView.zoom, centerY + node.y * topologyView.zoom, node);
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
    cluster: ["#49d8ff", 12],
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
  const x = (event.clientX - rect.left - rect.width / 2 - topologyView.offsetX) / topologyView.zoom;
  const y = (event.clientY - rect.top - rect.height / 2 - topologyView.offsetY) / topologyView.zoom;
  const selected = topologyGraph.nodes.find((node) => Math.hypot(node.x - x, node.y - y) < 18);
  if (!selected) return;
  $("topologySelection").textContent = formatTopologyNode(selected);
}

function resetTopology() {
  topologyView = { zoom: 1, offsetX: 0, offsetY: 0 };
  updateTopologyGraph();
}

function zoomTopology(delta) {
  topologyView.zoom = Math.max(0.35, Math.min(3, topologyView.zoom + delta));
  renderTopology();
}

function formatTopologyNode(node) {
  const data = node.data || {};
  if (node.type === "domain") {
    return [`Domain: ${node.label}`, `Kind: ${data.kind || "-"}`, `Source: ${data.source || "-"}`, `Status: ${data.status || "-"}`].join("\n");
  }
  if (node.type === "cluster") {
    return [`Domain cluster: ${data.root || node.label}`, `Domains: ${data.count || "-"}`, "Expand the run table or search to inspect individual domains."].join("\n");
  }
  if (node.type === "service") {
    return [`HTTP service: ${data.url || node.label}`, `Status: ${data.statusCode || "-"}`, `Title: ${data.title || "-"}`, `Tech: ${(data.technologies || []).join(", ") || "-"}`].join("\n");
  }
  if (node.type === "url") {
    return [`URL: ${data.url || node.label}`, `Path: ${data.path || "-"}`, `Params: ${(data.params || []).join(", ") || "-"}`, `Source: ${data.source || "-"}`].join("\n");
  }
  if (node.type === "artifact") {
    return [`Artifact: ${node.label}`, `Report: ${data.report_path || "-"}`, `Output: ${data.output_dir || "-"}`].join("\n");
  }
  return `${node.type}: ${node.label}`;
}

function exportRun(format) {
  if (!activeRunId) {
    $("status").textContent = "No active run is loaded.";
    return;
  }
  window.location.href = `/api/recon-runs/${activeRunId}/export?format=${encodeURIComponent(format)}`;
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
    await refreshWordlists();
    $("status").textContent = "Tool installation completed";
  } catch (error) {
    $("setupLog").textContent = error.message;
    $("setupLog").className = "notice error";
    $("status").textContent = error.message;
  } finally {
    $("installEnvironment").disabled = false;
  }
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

function updateApiKeyProviderHints() {
  const hint = API_KEY_PROVIDER_HINTS[$("keyProvider").value] || API_KEY_PROVIDER_HINTS.custom;
  $("keyLabel").placeholder = hint.label;
  $("apiKeyValue").placeholder = hint.placeholder;
  $("keyMonthlyLimit").placeholder = hint.monthlyLimit || "optional";
  if (!$("keyLabel").value.trim()) $("keyLabel").value = hint.label;
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
    $("status").textContent = "Create a target before running provider discovery.";
    activateTab("recon");
    return;
  }
  $("reverseWhois").disabled = true;
  $("status").textContent = "Provider discovery running...";
  try {
    const data = await api("/api/recon/provider-discovery", {
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
    $("status").textContent = `Provider discovery: ${data.summary.domainsCount} matches, ${data.summary.savedLeads} saved leads`;
    await refreshLeads();
    activateTab("recon");
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("reverseWhois").disabled = false;
  }
}

async function suggestWhoisTerms() {
  if (!$("target").value) {
    $("status").textContent = "Create a target before suggesting provider search terms.";
    activateTab("recon");
    return;
  }
  $("suggestWhoisTerms").disabled = true;
  $("whoisSuggestionStatus").textContent = "Inspecting public RDAP/WHOIS records...";
  try {
    const data = await api("/api/recon/whois-term-suggestions", {
      method: "POST",
      body: JSON.stringify({
        targetName: $("target").value,
        domains: $("domains").value.split(/\s+/).filter(Boolean)
      })
    });
    if (data.includeTerms?.length) {
      $("whoisInclude").value = data.includeTerms.join("\n");
      $("fullWhoisInclude").value = data.includeTerms.join("\n");
    }
    if (data.excludeTerms?.length) {
      $("whoisExclude").value = data.excludeTerms.join("\n");
      $("fullWhoisExclude").value = data.excludeTerms.join("\n");
    }
    $("whoisSuggestionStatus").textContent = formatWhoisSuggestionStatus(data);
    $("whoisSuggestionStatus").className = data.includeTerms?.length ? "notice ok compact-notice" : "notice warn compact-notice";
  } catch (error) {
    $("whoisSuggestionStatus").textContent = error.message;
    $("whoisSuggestionStatus").className = "notice error compact-notice";
  } finally {
    $("suggestWhoisTerms").disabled = false;
  }
}

function formatWhoisSuggestionStatus(data) {
  const suggestions = (data.suggestions || [])
    .map((item) => `- ${item.value} (${item.field}, score ${item.score})`)
    .join("\n");
  const associated = (data.associatedDomains || [])
    .map((domain) => `- ${domain}`)
    .join("\n");
  const records = (data.records || [])
    .map((record) => `${record.domain}: ${record.status}${record.error ? ` - ${record.error}` : ""}`)
    .join("\n");
  return [
    data.rationale || "Suggestion complete.",
    suggestions ? `\nSuggested terms:\n${suggestions}` : "",
    associated ? `\nAssociated domains:\n${associated}` : "",
    !suggestions && !associated ? "\nNo useful WHOIS/RDAP pivots were found for this target." : "",
    data.skippedPrivate?.length ? `\nSkipped private/noisy terms: ${data.skippedPrivate.join(", ")}` : "",
    records ? `\nChecked records:\n${records}` : ""
  ].filter(Boolean).join("\n");
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
  restoreLatestRunForSelectedTarget().catch((error) => {
    $("status").textContent = error.message;
  });
});
$("reconMode").addEventListener("change", updateReconModeUi);
$("start").addEventListener("click", startRecon);
$("pauseRun").addEventListener("click", () => updateRunControl("pause"));
$("resumeRun").addEventListener("click", () => updateRunControl("resume"));
$("cancelRun").addEventListener("click", () => updateRunControl("cancel"));
$("runHttpFollowup").addEventListener("click", runHttpFollowup);
$("reverseWhois").addEventListener("click", runReverseWhois);
$("suggestWhoisTerms").addEventListener("click", suggestWhoisTerms);
$("saveApiKey").addEventListener("click", saveApiKey);
$("keyProvider").addEventListener("change", updateApiKeyProviderHints);
$("saveWordlist").addEventListener("click", saveWordlist);
$("generateWordlist").addEventListener("click", generateWordlist);
$("runSearch").addEventListener("click", runSearch);
$("searchQuery").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});
$("createTarget").addEventListener("click", createTarget);
$("deleteTarget").addEventListener("click", deleteTarget);
$("checkEnvironment").addEventListener("click", checkEnvironment);
$("installEnvironment").addEventListener("click", installEnvironment);
$("saveAiSettings").addEventListener("click", saveAiSettings);
$("testAiSettings").addEventListener("click", testAiSettings);
$("aiProvider").addEventListener("change", updateAiSettingsPreview);
$("useLocalModel").addEventListener("change", updateAiSettingsPreview);
$("aiPlanningModel").addEventListener("change", updateAiSettingsPreview);
$("aiExecutionModel").addEventListener("change", updateAiSettingsPreview);
$("aiLocalEndpoint").addEventListener("input", updateAiSettingsPreview);
$("aiLocalModel").addEventListener("input", updateAiSettingsPreview);
$("setupDistro").addEventListener("change", loadAiRuntimeStatus);
$("aiAutonomyLevel").addEventListener("input", () => {
  updateAiAutonomyLabel();
  updateAiSettingsPreview();
});
window.AuraAiAgent.bind();
$("topologyCanvas").addEventListener("click", selectTopologyNode);
$("fitTopology").addEventListener("click", resetTopology);
$("pulseTopology").addEventListener("click", renderTopology);
$("zoomTopologyIn").addEventListener("click", () => zoomTopology(0.15));
$("zoomTopologyOut").addEventListener("click", () => zoomTopology(-0.15));
$("exportJson").addEventListener("click", () => exportRun("json"));
$("exportCsv").addEventListener("click", () => exportRun("csv"));
$("exportMarkdown").addEventListener("click", () => exportRun("markdown"));
["topologyDomains", "topologyServices", "topologyArtifacts", "topologyCandidates"].forEach((id) => {
  $(id).addEventListener("change", resetTopology);
});
document.querySelectorAll(".settings-tab").forEach((button) => {
  button.addEventListener("click", () => activateSettingsPanel(button.dataset.settingsPanel));
});
$("fontScale").addEventListener("input", () => applyFontScale($("fontScale").value));
$("themeSelect").addEventListener("change", () => applyTheme($("themeSelect").value));
$("backgroundEffect").addEventListener("change", () => applyBackgroundEffect($("backgroundEffect").value));
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
updateApiKeyProviderHints();
applyTheme(getUiSettings().theme || "aura");
applyBackgroundEffect(getUiSettings().backgroundEffect || "random");
applyFontScale(getUiSettings().fontScale || 100);
updateTopologyGraph();
if (!topologyFrame) animateTopology();
