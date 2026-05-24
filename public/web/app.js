"use strict";

let targets = [];
let activeRunId = null;
let lastEventId = 0;
let poll = null;
let latestRunActivity = "";
let aiSettings = null;
let aiModels = [];
let aiRuntimeStatus = null;
let resultsData = {
  domains: [],
  services: [],
  technologies: [],
  urls: [],
  screenshots: [],
  toolResults: [],
  delta: null,
  totals: {}
};
let imagePreviewGallery = [];
let imagePreviewIndex = 0;

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
  rapid7: {
    label: "open-data",
    placeholder: "Rapid7 Open Data user key",
    monthlyLimit: "30 download URL requests / 24h"
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

function activeProxyUrl() {
  return window.AuraProxySettings?.activeProxyUrl() || "";
}

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
  if (name === "topology") window.AuraTopology?.render();
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

function activateResultsView(name) {
  document.querySelectorAll(".result-subtab").forEach((button) => {
    button.classList.toggle("active", button.dataset.resultsView === name);
  });
  document.querySelectorAll(".result-view").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `results-${name}`);
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
  window.AuraTopology?.update();
  window.AuraAiLog.refresh(null);
  window.AuraResultsExplorer.refresh(null);
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
        timeoutMs: Number($("timeout").value || 180000),
        proxyUrl: activeProxyUrl()
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
      intelPreflight: $("intelPreflight").checked,
      passiveSources: selectedValues(["crtsh", "wayback", "rapid7"]),
      wslTools: selectedValues(["subfinder", "amass", "dnsx", "puredns", "shuffleDns", "gau", "httpx"])
        .map((tool) => tool === "shuffleDns" ? "shuffle-dns" : tool),
      screenshotTools: selectedValues(["gowitness", "aquatone", "eyewitness"]),
      useWsl: $("useWsl").checked,
      wslDistro: $("distro").value,
      timeoutMs: Number($("timeout").value || 180000),
      authorized: $("authorized").checked,
      proxyUrl: activeProxyUrl()
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
    $("toolLogRows").innerHTML = "";
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
  const [runData, eventData, countData, domainData, serviceData, technologyData, urlData, screenshotData, toolResultData, deltaData] = await Promise.all([
    api(`/api/recon-runs/${activeRunId}`),
    api(`/api/recon-runs/${activeRunId}/events?after=${lastEventId}`),
    api(`/api/recon-runs/${activeRunId}/counts`),
    api(`/api/recon-runs/${activeRunId}/domains`),
    api(`/api/recon-runs/${activeRunId}/http-services`),
    api(`/api/recon-runs/${activeRunId}/technologies`),
    api(`/api/recon-runs/${activeRunId}/urls`),
    api(`/api/recon-runs/${activeRunId}/screenshots`),
    api(`/api/recon-runs/${activeRunId}/tool-results`),
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
  resultsData = {
    domains: domainData.domains,
    services: serviceData.services,
    technologies: technologyData.technologies,
    urls: urlData.urls,
    screenshots: screenshotData.screenshots,
    toolResults: toolResultData.toolResults,
    delta: deltaData.delta,
    totals: counts
  };
  $("eventCount").textContent = counts.events ?? lastEventId;
  $("domainCount").textContent = counts.domains ?? domainData.domains.length;
  $("urlCount").textContent = counts.urls ?? urlData.urls.length;
  $("serviceCount").textContent = counts.httpServices ?? serviceData.services.length;
  $("technologyCount").textContent = counts.technologies ?? technologyData.technologies.length;
  $("screenshotCount").textContent = counts.screenshots ?? screenshotData.screenshots.length;
  renderAllResultTables();
  window.AuraTopology?.update({ domains: domainData.domains, services: serviceData.services, urls: urlData.urls, screenshots: screenshotData.screenshots });
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
  window.AuraAiLog.refresh(activeRunId);
  window.AuraResultsExplorer.refresh(activeRunId);
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
        timeoutMs: Number($("timeout").value || 180000),
        proxyUrl: activeProxyUrl()
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
    $("toolLogRows").innerHTML = "";
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
  const rows = domains.map((domain) => ({
    item: domain,
    group: resultGroupValue("domain", domain),
    html: `<tr><td>${esc(domain.domain)}</td><td>${esc(domain.kind)}</td><td>${esc(domain.source)}</td></tr>`
  }));
  $("domainRows").innerHTML = groupedRows(rows, 3);
}

function renderServices(services, total = services.length) {
  $("serviceRowsHint").textContent = total > services.length ? `showing ${services.length} of ${total}` : `${services.length} shown`;
  const rows = services.map((service) => ({
    item: service,
    group: resultGroupValue("service", service),
    html: `<tr><td>${esc(service.url)}</td><td>${esc(service.statusCode || "")}</td><td>${esc(service.title || "")}</td><td>${esc((service.technologies || []).join(", "))}</td></tr>`
  }));
  $("serviceRows").innerHTML = groupedRows(rows, 4);
}

function renderArtifacts(urls, screenshots) {
  const rows = urls.slice(0, 500).map((url) => ({
    item: url,
    group: resultGroupValue("url", url),
    html: `<tr><td>url</td><td>${esc(url.url)}</td><td>${esc((url.params || []).join(", "))}</td></tr>`
  }));
  $("artifactRows").innerHTML = groupedRows(rows, 3);
}

function renderTechnologies(technologies, total = technologies.length) {
  $("technologyRowsHint").textContent = total > technologies.length ? `showing ${technologies.length} of ${total}` : `${technologies.length} shown`;
  const rows = technologies.map((tech) => ({
    item: tech,
    group: resultGroupValue("technology", tech),
    html: `<tr><td>${esc(tech.name)}</td><td>${esc(tech.count)}</td><td>${esc(tech.hostCount)}</td><td>${esc(tech.source || "")}</td></tr>`
  }));
  $("technologyRows").innerHTML = groupedRows(rows, 4);
}

function renderScreenshots(screenshots, total = screenshots.length) {
  const imageTotal = screenshots.reduce((sum, shot) => sum + ((shot.images || []).length || Number(shot.metadata?.screenshotCount || 0)), 0);
  $("screenshotRowsHint").textContent = imageTotal
    ? `${imageTotal} images captured across ${screenshots.length} screenshot run${screenshots.length === 1 ? "" : "s"}`
    : total > screenshots.length ? `showing ${screenshots.length} of ${total}` : `${screenshots.length} shown`;
  const rows = screenshots.map((shot) => {
    const count = shot.metadata?.screenshotCount ?? "-";
    const path = shot.report_path || shot.output_dir || "-";
    const images = screenshotPreview(shot);
    return {
      item: shot,
      group: resultGroupValue("screenshot", shot),
      html: `<tr><td>${esc(shot.tool_name)}</td><td>${esc(count)}</td><td>${images || `<span class="muted">No image files found.</span>`}<span class="artifact-path">${esc(path)}</span></td></tr>`
    };
  });
  $("screenshotRows").innerHTML = groupedRows(rows, 3) || `<tr><td colspan="3" class="muted">No screenshot runs recorded for this run.</td></tr>`;
}

function renderToolLogs(toolResults, total = toolResults.length) {
  $("toolLogRowsHint").textContent = total > toolResults.length ? `showing ${toolResults.length} of ${total}` : `${toolResults.length} shown`;
  const rows = toolResults.map((result) => ({
    item: result,
    group: resultGroupValue("toolLog", result),
    html: `<tr><td>${esc(result.toolName)}</td><td>${esc(result.status)}</td><td>${esc(result.exitCode ?? "")}</td><td>${esc(result.startedAt || "")}</td><td>${toolLogButtons(result)}</td></tr>`
  }));
  $("toolLogRows").innerHTML = groupedRows(rows, 5) || `<tr><td colspan="5" class="muted">No tool results for this run.</td></tr>`;
}

function toolLogButtons(result) {
  const buttons = [];
  if (result.stdoutPath) buttons.push(`<button class="tool-log-button" type="button" data-tool-result-id="${esc(result.id)}" data-log-stream="stdout">stdout</button>`);
  if (result.stderrPath) buttons.push(`<button class="tool-log-button" type="button" data-tool-result-id="${esc(result.id)}" data-log-stream="stderr">stderr</button>`);
  if (!buttons.length && result.errorMessage) return `<span class="muted">${esc(result.errorMessage)}</span>`;
  return buttons.join(" ") || `<span class="muted">No log artifact</span>`;
}

function renderAllResultTables() {
  renderDomains(resultsData.domains, resultsData.totals.domains);
  renderServices(resultsData.services, resultsData.totals.httpServices);
  renderTechnologies(resultsData.technologies, resultsData.totals.technologies);
  renderScreenshots(resultsData.screenshots, resultsData.totals.screenshots);
  renderToolLogs(resultsData.toolResults, resultsData.totals.toolResults);
  renderArtifacts(resultsData.urls, resultsData.screenshots);
  renderRunDelta(resultsData.delta);
}

function resultGroupValue(type, item) {
  const mode = $(`${type}GroupBy`)?.value || "none";
  if (mode === "none") return "";
  if (type === "domain") {
    if (mode === "kind") return item.kind || "unknown kind";
    if (mode === "root") return item.root_domain || rootLabel(item.domain);
    if (mode === "source") return item.source || "unknown source";
  }
  if (type === "service") {
    if (mode === "status") return item.statusCode ? String(item.statusCode) : "no status";
    if (mode === "tech") return (item.technologies || [])[0] || "no tech";
    if (mode === "host") return item.host || hostFromUrl(item.url) || "unknown host";
    if (mode === "scheme") return item.scheme || schemeFromUrl(item.url) || "unknown scheme";
  }
  if (type === "url") {
    if (mode === "host") return item.host || hostFromUrl(item.url) || "unknown host";
    if (mode === "params") return (item.params || []).length ? "has parameters" : "no parameters";
    if (mode === "source") return item.source || "unknown source";
    if (mode === "path") return pathPrefix(item.path || item.url);
  }
  if (type === "technology") {
    if (mode === "source") return item.source || "unknown source";
    if (mode === "serviceCount") return countBucket(item.count, "service");
    if (mode === "hostCount") return countBucket(item.hostCount, "host");
  }
  if (type === "screenshot") {
    if (mode === "tool") return item.tool_name || "unknown tool";
    if (mode === "status") return item.metadata?.status || "unknown status";
  }
  if (type === "toolLog") {
    if (mode === "tool") return item.toolName || "unknown tool";
    if (mode === "status") return item.status || "unknown status";
  }
  if (type === "delta") {
    if (mode === "change") return item.change;
    if (mode === "type") return item.type;
  }
  return "";
}

function groupedRows(rows, colSpan) {
  const hasGroups = rows.some((row) => row.group);
  if (!hasGroups) return rows.map((row) => row.html).join("");
  const groups = new Map();
  for (const row of rows) {
    const key = row.group || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([group, groupRows]) => `<tr class="group-row"><td colspan="${colSpan}">${esc(group)} <span>${groupRows.length}</span></td></tr>${groupRows.map((row) => row.html).join("")}`)
    .join("");
}

function screenshotPreview(shot) {
  const images = (shot.images || []).slice(0, 12);
  if (!images.length) return "";
  return `<div class="screenshot-grid">${images.map((image) =>
    `<button class="screenshot-thumb" type="button" data-image-url="${esc(image.url)}" data-image-name="${esc(image.name)}"><img src="${esc(image.url)}" alt="${esc(image.name)}" loading="lazy"></button>`
  ).join("")}</div>`;
}

function ensureImageModal() {
  let modal = $("imagePreviewModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "imagePreviewModal";
  modal.className = "image-modal hidden";
  modal.innerHTML = `
    <div class="image-modal-dialog" role="dialog" aria-modal="true" aria-label="Screenshot preview">
      <button class="image-modal-close" type="button" aria-label="Close preview">&times;</button>
      <button class="image-modal-nav image-modal-prev" type="button" aria-label="Previous screenshot">&#8249;</button>
      <img id="imagePreviewModalImg" alt="">
      <button class="image-modal-nav image-modal-next" type="button" aria-label="Next screenshot">&#8250;</button>
      <div id="imagePreviewModalCaption" class="image-modal-caption"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".image-modal-close")) closeImageModal();
    if (event.target.closest(".image-modal-prev")) showImageAt(imagePreviewIndex - 1);
    if (event.target.closest(".image-modal-next")) showImageAt(imagePreviewIndex + 1);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeImageModal();
    if ($("imagePreviewModal")?.classList.contains("hidden")) return;
    if (event.key === "ArrowLeft") showImageAt(imagePreviewIndex - 1);
    if (event.key === "ArrowRight") showImageAt(imagePreviewIndex + 1);
  });
  return modal;
}

function openImageModal(url, name, gallery = []) {
  const modal = ensureImageModal();
  imagePreviewGallery = gallery.length ? gallery : [{ url, name }];
  imagePreviewIndex = Math.max(0, imagePreviewGallery.findIndex((image) => image.url === url));
  showImageAt(imagePreviewIndex);
  modal.classList.remove("hidden");
}

function showImageAt(index) {
  if (!imagePreviewGallery.length) return;
  imagePreviewIndex = (index + imagePreviewGallery.length) % imagePreviewGallery.length;
  const image = imagePreviewGallery[imagePreviewIndex];
  $("imagePreviewModalImg").src = image.url;
  $("imagePreviewModalImg").alt = image.name || "Screenshot preview";
  $("imagePreviewModalCaption").textContent = imagePreviewGallery.length > 1
    ? `${image.name || ""} (${imagePreviewIndex + 1}/${imagePreviewGallery.length})`
    : image.name || "";
  const navHidden = imagePreviewGallery.length <= 1;
  $("imagePreviewModal").classList.toggle("single-image", navHidden);
}

function closeImageModal() {
  const modal = $("imagePreviewModal");
  if (!modal) return;
  modal.classList.add("hidden");
  const image = $("imagePreviewModalImg");
  if (image) image.src = "";
  imagePreviewGallery = [];
  imagePreviewIndex = 0;
}

function ensureToolLogModal() {
  let modal = $("toolLogModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "toolLogModal";
  modal.className = "tool-log-modal hidden";
  modal.innerHTML = `
    <div class="tool-log-dialog" role="dialog" aria-modal="true" aria-label="Tool log">
      <button class="tool-log-close" type="button" aria-label="Close log">&times;</button>
      <div id="toolLogModalTitle" class="tool-log-title"></div>
      <pre id="toolLogModalBody"></pre>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".tool-log-close")) closeToolLogModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeToolLogModal();
  });
  return modal;
}

async function openToolLogModal(toolResultId, stream) {
  const modal = ensureToolLogModal();
  $("toolLogModalTitle").textContent = `Loading ${stream || "log"}...`;
  $("toolLogModalBody").textContent = "";
  modal.classList.remove("hidden");
  try {
    const data = await api(`/api/recon-tool-results/${encodeURIComponent(toolResultId)}/log?stream=${encodeURIComponent(stream || "stdout")}`);
    $("toolLogModalTitle").textContent = `${data.toolName || "tool"} ${data.stream || stream}`;
    $("toolLogModalBody").textContent = data.content || "(empty log)";
  } catch (error) {
    $("toolLogModalTitle").textContent = "Log unavailable";
    $("toolLogModalBody").textContent = error.message;
  }
}

function closeToolLogModal() {
  const modal = $("toolLogModal");
  if (!modal) return;
  modal.classList.add("hidden");
}

function countBucket(value, label) {
  const count = Number(value || 0);
  if (count === 0) return `0 ${label}s`;
  if (count === 1) return `1 ${label}`;
  if (count < 5) return `2-4 ${label}s`;
  if (count < 20) return `5-19 ${label}s`;
  return `20+ ${label}s`;
}

function rootLabel(domain) {
  const parts = String(domain || "").split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : String(domain || "unknown root");
}

function hostFromUrl(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function schemeFromUrl(value) {
  try {
    return new URL(value).protocol.replace(":", "");
  } catch {
    return "";
  }
}

function pathPrefix(value) {
  const pathValue = String(value || "/").split("?")[0];
  const parts = pathValue.split("/").filter(Boolean);
  return parts[0] ? `/${parts[0]}` : "/";
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
  $("deltaRows").innerHTML = groupedRows(rows.slice(0, 250), 4);
}

function deltaRows(change, type, items, valueKey) {
  return (items || []).map((item) => ({
    item: { ...item, change, type },
    group: resultGroupValue("delta", { ...item, change, type }),
    html: `<tr><td><span class="delta-badge ${change}">${esc(change)}</span></td><td>${esc(type)}</td><td>${esc(item[valueKey])}</td><td>${esc(item.source || "")}</td></tr>`
  }));
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
  $("leadRows").innerHTML = data.leads.map((lead) => {
    const score = lead.metadata?.correlationScore ?? "";
    const rationale = lead.metadata?.correlationRationale || [];
    return `<tr><td>${esc(lead.value)}</td><td>${esc(lead.source)}</td><td>${esc(lead.status || lead.confidence)}</td><td>${esc(score)}</td><td>${esc(rationale.join("; "))}</td><td>${esc((lead.matchTerms || []).join(", "))}</td></tr>`;
  }).join("");
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
document.addEventListener("click", (event) => {
  const thumb = event.target.closest(".screenshot-thumb");
  if (!thumb) return;
  const gallery = [...thumb.closest(".screenshot-grid").querySelectorAll(".screenshot-thumb")]
    .map((node) => ({ url: node.dataset.imageUrl, name: node.dataset.imageName }))
    .filter((image) => image.url);
  openImageModal(thumb.dataset.imageUrl, thumb.dataset.imageName, gallery);
});
document.addEventListener("click", (event) => {
  const button = event.target.closest(".tool-log-button");
  if (!button) return;
  openToolLogModal(button.dataset.toolResultId, button.dataset.logStream);
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
$("exportJson").addEventListener("click", () => exportRun("json"));
$("exportCsv").addEventListener("click", () => exportRun("csv"));
$("exportMarkdown").addEventListener("click", () => exportRun("markdown"));
document.querySelectorAll(".settings-tab").forEach((button) => {
  button.addEventListener("click", () => activateSettingsPanel(button.dataset.settingsPanel));
});
document.querySelectorAll(".result-subtab").forEach((button) => {
  button.addEventListener("click", () => activateResultsView(button.dataset.resultsView));
});
["deltaGroupBy", "domainGroupBy", "serviceGroupBy", "urlGroupBy", "technologyGroupBy", "screenshotGroupBy"].forEach((id) => {
  $(id)?.addEventListener("change", renderAllResultTables);
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
window.AuraProxySettings?.bind();
window.AuraTopology?.bind();
updateReconModeUi();
updateApiKeyProviderHints();
applyTheme(getUiSettings().theme || "aura");
applyBackgroundEffect(getUiSettings().backgroundEffect || "random");
applyFontScale(getUiSettings().fontScale || 100);
