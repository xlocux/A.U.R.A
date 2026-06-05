"use strict";

let targets = [];
let activeRunId = null;
let lastEventId = 0;
let poll = null;
let latestRunActivity = "";
let aiSettings = null;
let aiModels = [];
let aiRuntimeStatus = null;
let apiKeysData = [];
let apiKeySort = { key: "provider", direction: "asc" };
let resultsData = {
  domains: [],
  services: [],
  technologies: [],
  urls: [],
  screenshots: [],
  leads: [],
  toolResults: [],
  delta: null,
  totals: {}
};
let imagePreviewGallery = [];
let imagePreviewIndex = 0;

const $ = (id) => document.getElementById(id);
const UI_SETTINGS_STORAGE_KEY = "aura.uiSettings";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "aura.sidebarCollapsed";
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
    placeholder: "Censys API ID:Secret",
    monthlyLimit: "250"
  },
  hunterio: { label: "domain-search", placeholder: "Hunter.io API key", monthlyLimit: "" },
  binaryedge: { label: "dns-intel", placeholder: "BinaryEdge API key", monthlyLimit: "" },
  certspotter: { label: "ct-logs", placeholder: "Cert Spotter API key", monthlyLimit: "" },
  passivetotal: { label: "passive-dns", placeholder: "PassiveTotal user:api_key", monthlyLimit: "" },
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
    label: "code-search",
    placeholder: "GitHub token",
    monthlyLimit: ""
  },
  urlscan: {
    label: "public-api",
    placeholder: "urlscan.io API key",
    monthlyLimit: ""
  },
  virustotal: {
    label: "public-api",
    placeholder: "VirusTotal API key",
    monthlyLimit: "500"
  },
  whoisxmlapi: {
    label: "reverse-whois",
    placeholder: "WhoisXMLAPI key",
    monthlyLimit: "500"
  },
  whoisfreaks: {
    label: "history",
    placeholder: "WhoisFreaks API key",
    monthlyLimit: ""
  },
  custom: {
    label: "custom",
    placeholder: "API key",
    monthlyLimit: ""
  }
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  let data = {};
  try { data = await res.json(); } catch {}
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
  linuxRuntime: $("setupRuntime")?.value?.trim() || "linux"
});

function activeProxyUrl() {
  return window.AuraProxySettings?.activeProxyUrl?.() || "";
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
    const params = new URLSearchParams({ runtime: $("setupRuntime")?.value?.trim() || "linux" });
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
  $("aiAutonomyLevel").value = settings.autonomyLevel || 1;
  updateAiAutonomyLabel();
  $("aiProviderMetric").textContent = useLocalModel ? "Local" : $("aiProvider").value;
  $("aiPlanningMetric").textContent = $("aiPlanningModel").value || "-";
  $("aiExecutionMetric").textContent = $("aiExecutionModel").value || "-";
}

function fillModelSelect(id, selected) {
  const select = $(id);
  const models = aiModels.length ? aiModels : [{ id: selected || "", name: selected || "default" }];
  select.innerHTML = models.map((model) => `<option value="${esc(model.id)}">${esc(model.name || model.id)}</option>`).join("");
  if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
}

function renderAiRuntimeStatus() {
  $("aiRuntimeStatus").textContent = JSON.stringify(aiRuntimeStatus || {}, null, 2);
}

function updateAiAutonomyLabel() {
  const labels = [
    "Level 0 - disabled",
    "Level 1 - suggestions only",
    "Level 2 - assisted actions",
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
  if (name === "topology") window.AuraTopology?.render?.();
}

function bindDashboardShellActions() {
  document.querySelectorAll("[data-dashboard-tab]").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.dashboardTab));
  });
  const sidebarToggle = $("sidebarToggle");
  const savedSidebarState = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  applySidebarCollapsed(savedSidebarState);
  sidebarToggle?.addEventListener("click", () => {
    applySidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
  });
  $("dashboardQuickSearch")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const query = event.currentTarget.value.trim();
    $("searchQuery").value = query;
    activateTab("search");
    if (query) runSearch();
  });
}

function applySidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  $("sidebarToggle")?.setAttribute("aria-expanded", String(!collapsed));
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
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
    return;
  }

  const saved = localStorage.getItem(ACTIVE_TARGET_STORAGE_KEY);
  const nextTarget = targets.some((target) => target.target_name === saved) ? saved : targets[0].target_name;
  $("target").value = nextTarget;
  await loadTargetConfig();
  await refreshLeads();
  await restoreLatestRunForSelectedTarget();
}

async function loadTargetConfig() {
  const name = $("target").value;
  if (!name) return;
  localStorage.setItem(ACTIVE_TARGET_STORAGE_KEY, name);
  const data = await api(`/api/targets/${encodeURIComponent(name)}`);
  const config = data.config || {};
  $("domains").value = (config.inScope || []).join("\n");
  $("targetValidation").textContent = `${(config.inScope || []).length} in-scope rule(s), ${(config.outOfScope || []).length} out-of-scope rule(s)`;
  $("targetValidation").className = "notice ok";
}

async function createTarget() {
  const payload = {
    targetName: $("newTargetName").value.trim(),
    programUrl: $("newProgramUrl").value.trim(),
    inScope: textLines("newInScope"),
    outOfScope: textLines("newOutOfScope")
  };
  const errors = [];
  if (!payload.targetName) errors.push("Target name is required.");
  if (payload.inScope.length === 0) errors.push("At least one in-scope domain or URL is required.");
  if (errors.length) {
    $("targetValidation").innerHTML = `<strong>Target not created.</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`;
    $("targetValidation").className = "notice error";
    return;
  }
  try {
    const data = await api("/api/targets", { method: "POST", body: JSON.stringify(payload) });
    $("status").textContent = `Target ${data.targetName} created`;
    $("newTargetName").value = "";
    $("newProgramUrl").value = "";
    $("newInScope").value = "";
    $("newOutOfScope").value = "";
    await loadTargets();
    $("target").value = data.targetName;
    await loadTargetConfig();
    await refreshLeads();
  } catch (error) {
    $("targetValidation").textContent = error.message;
    $("targetValidation").className = "notice error";
  }
}

async function deleteTarget() {
  const targetName = $("target").value;
  if (!targetName) return;
  const confirmed = await window.AuraDialogs.confirm({
    tone: "danger",
    title: "Delete target",
    message: `Delete target ${targetName}? This removes its configuration and saved data views from the local database.`,
    confirmLabel: "Delete target"
  });
  if (!confirmed) return;
  try {
    await api(`/api/targets/${encodeURIComponent(targetName)}`, { method: "DELETE" });
    $("status").textContent = `Target ${targetName} deleted`;
    await loadTargets();
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function refreshLeads() {
  if (!$("target").value) return;
  try {
    const data = await api(`/api/targets/${encodeURIComponent($("target").value)}/leads`);
    const leads = data.leads || [];
    $("leadRows").innerHTML = leads.map((lead) => `<tr><td>${esc(lead.lead_type || lead.type || "domain")}</td><td>${esc(lead.value || "")}</td><td>${leadStatusBadge(lead.status || "review")}</td><td>${leadScoreBar(normalizeLeadScore(lead.confidence_score ?? lead.score))}</td><td>${esc(lead.evidence || lead.rationale || "")}</td></tr>`).join("");
  } catch (error) {
    $("leadRows").innerHTML = `<tr><td colspan="5" class="muted">${esc(error.message)}</td></tr>`;
  }
}

function clearRunView() {
  activeRunId = null;
  lastEventId = 0;
  $("runId").textContent = "-";
  $("runStatus").textContent = "idle";
  $("domainCount").textContent = "0";
  $("urlCount").textContent = "0";
  $("serviceCount").textContent = "0";
  $("technologyCount").textContent = "0";
  $("screenshotCount").textContent = "0";
  $("eventCount").textContent = "0";
  $("events").innerHTML = "";
  $("runActivity").textContent = "No active run loaded.";
  updateRunControlButtons("idle");
}

async function restoreLatestRunForSelectedTarget() {
  if (!$("target").value) return;
  try {
    const data = await api(`/api/recon-runs?targetName=${encodeURIComponent($("target").value)}&limit=1`);
    const run = data.runs?.[0];
    if (!run) {
      clearRunView();
      return;
    }
    activeRunId = run.id;
    lastEventId = 0;
    $("runId").textContent = activeRunId;
    await refreshRun();
    if (poll) clearInterval(poll);
    if (["queued", "running", "paused"].includes(run.status)) poll = setInterval(refreshRun, 1500);
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function refreshRun() {
  if (!activeRunId) return;
  const [runData, eventData, counts, domainData, artifactData, serviceData, technologyData, screenshotData, toolData, deltaData] = await Promise.all([
    api(`/api/recon-runs/${activeRunId}`),
    api(`/api/recon-runs/${activeRunId}/events?after=${lastEventId}`),
    api(`/api/recon-runs/${activeRunId}/counts`),
    api(`/api/recon-runs/${activeRunId}/domains`),
    api(`/api/recon-runs/${activeRunId}/artifacts`),
    api(`/api/recon-runs/${activeRunId}/http-services`),
    api(`/api/recon-runs/${activeRunId}/technologies`),
    api(`/api/recon-runs/${activeRunId}/screenshots`),
    api(`/api/recon-runs/${activeRunId}/tool-results`),
    api(`/api/recon-runs/${activeRunId}/delta`)
  ]);
  const run = runData.run;
  $("runStatus").textContent = run.status;
  updateRunControlButtons(run.status);
  $("domainCount").textContent = counts.domains;
  $("urlCount").textContent = counts.urls;
  $("serviceCount").textContent = counts.httpServices;
  $("technologyCount").textContent = counts.technologies;
  $("screenshotCount").textContent = counts.screenshots;
  $("eventCount").textContent = counts.events;
  renderRunActivity(run, eventData.events);
  for (const event of eventData.events) {
    lastEventId = Math.max(lastEventId, event.id);
    const div = document.createElement("div");
    div.className = `event ${event.severity || "info"}`;
    div.textContent = `[${event.created_at}] ${event.phase || "-"} ${event.source || "-"}: ${event.message}`;
    $("events").prepend(div);
  }
  renderDomains(domainData.domains || []);
  renderArtifacts(artifactData.artifacts || []);
  renderHttpServices(serviceData.services || []);
  renderTechnologies(technologyData.technologies || []);
  renderScreenshots(screenshotData.screenshots || []);
  renderToolResults(toolData.results || []);
  renderRunDelta(deltaData.delta || null);
  window.AuraAiAgent.onRunUpdate?.({
    run,
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
  const canFollowUp = hasRun && ["completed", "failed", "cancelled"].includes(status);
  $("pauseRun").disabled = !hasRun || !["queued", "running"].includes(status);
  $("resumeRun").disabled = !hasRun || status !== "paused";
  $("cancelRun").disabled = !hasRun || ["completed", "failed", "cancelled", "idle"].includes(status);
  $("runHttpFollowup").disabled = !canFollowUp;
  ["runUrlFollowup", "runHttpOnlyFollowup", "runTechFollowup", "runScreenshotFollowup", "runTrackerFollowup", "runFaviconFollowup"].forEach((id) => {
    $(id).disabled = !canFollowUp;
  });
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
        useLinuxRunner: $("useLinuxRunner").checked,
        linuxRuntime: $("linuxRuntime").value,
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

async function runFocusedFollowup(phase, label) {
  if (!activeRunId) {
    $("status").textContent = `Load a completed run before starting ${label}.`;
    return;
  }
  ["runUrlFollowup", "runHttpOnlyFollowup", "runTechFollowup", "runScreenshotFollowup", "runTrackerFollowup", "runFaviconFollowup"].forEach((id) => {
    $(id).disabled = true;
  });
  $("status").textContent = `Starting ${label} from run ${activeRunId}...`;
  try {
    const data = await api(`/api/recon-runs/${activeRunId}/follow-up/${phase}`, {
      method: "POST",
      body: JSON.stringify({
        screenshotTools: selectedValues(["gowitness", "aquatone", "eyewitness"]),
        useLinuxRunner: $("useLinuxRunner").checked,
        linuxRuntime: $("linuxRuntime").value,
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
    $("status").textContent = `${label} running for ${data.sourceDomainCount || 0} saved domains`;
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

async function startRecon() {
  if (!$("target").value) {
    $("status").textContent = "Create a target before starting recon.";
    return;
  }
  const domains = textLines("domains");
  if (domains.length === 0) {
    $("status").textContent = "Add at least one authorized seed domain.";
    return;
  }
  $("start").disabled = true;
  $("status").textContent = "Starting recon...";
  try {
    const data = await api("/api/recon/start", {
      method: "POST",
      body: JSON.stringify({
        targetName: $("target").value,
        domains,
        mode: $("reconMode").value,
        providerDiscovery: $("reconMode").value === "full" ? {
          include: textLines("fullWhoisInclude"),
          exclude: textLines("fullWhoisExclude"),
          mode: $("fullWhoisMode").value,
          searchType: $("fullWhoisType").value,
          maxAssetLeads: Number($("maxAssetLeads").value || 250)
        } : null,
        intelPreflight: $("intelPreflight").checked,
        useLinuxRunner: $("useLinuxRunner").checked,
        linuxRuntime: $("linuxRuntime").value,
        timeoutMs: Number($("timeout").value || 180000),
        tools: selectedValues(["subfinder", "amass", "dnsx", "puredns", "shuffleDns", "gau", "httpx"]),
        passiveSources: selectedValues(["crtsh", "wayback", "rapiddns", "rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx", "whoisxmlapi", "whoisfreaks"]),
        screenshotTools: selectedValues(["gowitness", "aquatone", "eyewitness"]),
        proxyUrl: activeProxyUrl()
      })
    });
    activeRunId = data.runId;
    lastEventId = 0;
    latestRunActivity = "";
    window.AuraAiAgent.resetRunFeed(activeRunId);
    $("runId").textContent = activeRunId;
    $("runStatus").textContent = "queued";
    $("events").innerHTML = "";
    $("domainRows").innerHTML = "";
    $("serviceRows").innerHTML = "";
    $("technologyRows").innerHTML = "";
    $("screenshotRows").innerHTML = "";
    $("artifactRows").innerHTML = "";
    $("toolLogRows").innerHTML = "";
    renderRunDelta(null);
    updateRunControlButtons("queued");
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

function renderAllResultTables() {
  renderDomains(resultsData.domains);
  renderArtifacts(resultsData.urls);
  renderHttpServices(resultsData.services);
  renderTechnologies(resultsData.technologies);
  renderScreenshots(resultsData.screenshots);
  renderToolResults(resultsData.toolResults);
}

function renderDomains(domains) {
  resultsData.domains = domains || [];
  const rows = [...resultsData.domains].sort((a, b) => String(a.domain).localeCompare(String(b.domain)));
  $("domainRowsHint").textContent = countBucket(rows.length, "domain");
  $("domainRows").innerHTML = renderGroupedRows(rows, $("domainGroupBy").value, (domain) => {
    const root = domain.root_domain || domain.domain?.split(".").slice(-2).join(".");
    const groupKey = $("domainGroupBy").value === "kind" ? domain.kind : $("domainGroupBy").value === "root" ? root : domain.source;
    return { groupKey, html: `<tr><td>${esc(domain.domain)}</td><td>${esc(domain.kind || "")}</td><td>${esc(domain.source || "")}</td></tr>` };
  });
}

function renderArtifacts(artifacts) {
  resultsData.urls = artifacts || [];
  $("artifactRows").innerHTML = renderGroupedRows(resultsData.urls, $("urlGroupBy").value, (artifact) => {
    let groupKey = "";
    if ($("urlGroupBy").value === "host") groupKey = hostnameOf(artifact.value) || "unknown host";
    else if ($("urlGroupBy").value === "params") groupKey = artifact.extra_json?.params?.length ? "with params" : "without params";
    else if ($("urlGroupBy").value === "source") groupKey = artifact.source || "unknown source";
    else if ($("urlGroupBy").value === "path") groupKey = pathPrefixOf(artifact.value);
    return { groupKey, html: `<tr><td>${esc(artifact.artifact_type)}</td><td class="mono wrap">${esc(artifact.value)}</td><td>${esc(JSON.stringify(artifact.extra_json || {}))}</td></tr>` };
  });
}

function renderHttpServices(services) {
  resultsData.services = services || [];
  $("serviceRowsHint").textContent = countBucket(resultsData.services.length, "service");
  $("serviceRows").innerHTML = renderGroupedRows(resultsData.services, $("serviceGroupBy").value, (service) => {
    const tech = Array.isArray(service.tech) ? service.tech.join(", ") : service.tech || "";
    let groupKey = "";
    if ($("serviceGroupBy").value === "status") groupKey = String(service.status_code || "unknown status");
    else if ($("serviceGroupBy").value === "tech") groupKey = tech || "unknown tech";
    else if ($("serviceGroupBy").value === "host") groupKey = hostnameOf(service.url) || "unknown host";
    else if ($("serviceGroupBy").value === "scheme") groupKey = service.url?.split(":")[0] || "unknown scheme";
    return { groupKey, html: `<tr><td class="mono wrap"><a href="${esc(service.url)}" target="_blank" rel="noreferrer">${esc(service.url)}</a></td><td>${esc(service.status_code || "")}</td><td>${esc(service.title || "")}</td><td>${esc(tech)}</td></tr>` };
  });
}

function renderTechnologies(technologies) {
  resultsData.technologies = technologies || [];
  $("technologyRowsHint").textContent = countBucket(resultsData.technologies.length, "tech");
  $("technologyRows").innerHTML = renderGroupedRows(resultsData.technologies, $("technologyGroupBy").value, (tech) => {
    let groupKey = tech.source || "unknown";
    if ($("technologyGroupBy").value === "serviceCount") groupKey = bucketNumber(tech.service_count, "service");
    if ($("technologyGroupBy").value === "hostCount") groupKey = bucketNumber(tech.host_count, "host");
    return { groupKey, html: `<tr><td>${esc(tech.technology)}</td><td>${esc(tech.service_count || 0)}</td><td>${esc(tech.host_count || 0)}</td><td>${esc(tech.source || "")}</td></tr>` };
  });
}

function renderScreenshots(screenshots) {
  resultsData.screenshots = screenshots || [];
  $("screenshotRowsHint").textContent = countBucket(resultsData.screenshots.length, "screenshot run");
  $("screenshotRows").innerHTML = renderGroupedRows(resultsData.screenshots, $("screenshotGroupBy").value, (shot) => {
    let groupKey = shot.tool_name || "unknown tool";
    if ($("screenshotGroupBy").value === "status") groupKey = shot.status || "unknown status";
    const images = (shot.files || []).filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name || file.path || ""));
    const preview = images.length ? `<div class="screenshot-grid">${images.slice(0, 12).map((file) => {
      const url = `/api/recon-runs/${encodeURIComponent(activeRunId)}/artifacts/file?path=${encodeURIComponent(file.path)}`;
      return `<button type="button" class="screenshot-thumb" data-image-url="${esc(url)}" data-image-name="${esc(file.name || file.path)}"><img src="${esc(url)}" alt="${esc(file.name || "screenshot")}" loading="lazy"><span>${esc(file.name || "screenshot")}</span></button>`;
    }).join("")}</div>` : "";
    return { groupKey, html: `<tr><td>${statusBadgeHtml(shot.tool_name || "screenshot")}</td><td>${esc(shot.screenshot_count || images.length || 0)}${preview}</td><td>${artifactLinks(shot)}</td></tr>` };
  });
}

function renderToolResults(results) {
  resultsData.toolResults = results || [];
  $("toolLogRowsHint").textContent = countBucket(resultsData.toolResults.length, "tool result");
  $("toolLogRows").innerHTML = renderGroupedRows(resultsData.toolResults, $("toolLogGroupBy")?.value || "tool", (result) => {
    let groupKey = result.tool_name || "unknown tool";
    if (($("toolLogGroupBy")?.value || "tool") === "status") groupKey = result.status || "unknown status";
    return { groupKey, html: `<tr><td>${esc(result.tool_name)}</td><td>${statusBadgeHtml(result.status || "unknown")}</td><td>${esc(result.exit_code ?? "")}</td><td>${esc(result.started_at || "")}</td><td>${toolLogButtons(result)}</td></tr>` };
  });
}

function renderRunDelta(delta) {
  resultsData.delta = delta;
  if (!delta) {
    $("runDeltaSummary").textContent = "No previous run comparison loaded.";
    $("deltaNewDomains").textContent = "0";
    $("deltaRemovedDomains").textContent = "0";
    $("deltaNewUrls").textContent = "0";
    $("deltaNewServices").textContent = "0";
    $("deltaRows").innerHTML = "";
    return;
  }
  $("runDeltaSummary").textContent = delta.previousRunId ? `Compared with ${delta.previousRunId}` : "First run for this target.";
  $("deltaNewDomains").textContent = delta.summary?.newDomains || 0;
  $("deltaRemovedDomains").textContent = delta.summary?.removedDomains || 0;
  $("deltaNewUrls").textContent = delta.summary?.newUrls || 0;
  $("deltaNewServices").textContent = delta.summary?.newServices || 0;
  const rows = [];
  for (const change of ["new", "removed"]) {
    for (const domain of delta.domains?.[change] || []) rows.push(`<tr><td>${change}</td><td>domain</td><td>${esc(domain)}</td><td>-</td></tr>`);
    for (const artifact of delta.artifacts?.[change] || []) rows.push(`<tr><td>${change}</td><td>${esc(artifact.artifact_type)}</td><td>${esc(artifact.value)}</td><td>${esc(artifact.source || "")}</td></tr>`);
  }
  $("deltaRows").innerHTML = rows.join("");
}

function renderGroupedRows(items, groupBy, mapper) {
  const rows = [];
  let lastGroup = null;
  for (const item of items) {
    const mapped = mapper(item);
    if (groupBy && groupBy !== "none" && mapped.groupKey !== lastGroup) {
      rows.push(`<tr class="group-row"><td colspan="99">${esc(mapped.groupKey || "Other")}</td></tr>`);
      lastGroup = mapped.groupKey;
    }
    rows.push(mapped.html);
  }
  return rows.join("");
}

function artifactLinks(shot) {
  const links = [];
  if (shot.report_path) links.push(`<a href="/api/recon-runs/${encodeURIComponent(activeRunId)}/artifacts/file?path=${encodeURIComponent(shot.report_path)}" target="_blank">Report</a>`);
  if (shot.output_path) links.push(`<a href="/api/recon-runs/${encodeURIComponent(activeRunId)}/artifacts/file?path=${encodeURIComponent(shot.output_path)}" target="_blank">Output</a>`);
  for (const file of (shot.files || []).filter((item) => !/\.(png|jpe?g|webp)$/i.test(item.name || item.path || "")).slice(0, 5)) {
    links.push(`<a href="/api/recon-runs/${encodeURIComponent(activeRunId)}/artifacts/file?path=${encodeURIComponent(file.path)}" target="_blank">${esc(file.name || "artifact")}</a>`);
  }
  return links.join(" ") || "-";
}

function toolLogButtons(result) {
  const buttons = [];
  if (result.stdout_path) buttons.push(`<button type="button" class="tool-log-button" data-tool-result-id="${esc(result.id)}" data-log-stream="stdout">stdout</button>`);
  if (result.stderr_path) buttons.push(`<button type="button" class="tool-log-button" data-tool-result-id="${esc(result.id)}" data-log-stream="stderr">stderr</button>`);
  return buttons.join(" ") || "-";
}

function hostnameOf(value) {
  try { return new URL(value).hostname; } catch { return ""; }
}

function pathPrefixOf(value) {
  try {
    const path = new URL(value).pathname || "/";
    const parts = path.split("/").filter(Boolean);
    return parts.length ? `/${parts[0]}` : "/";
  } catch {
    return "/";
  }
}

function bucketNumber(value, label) {
  const count = Number(value || 0);
  if (count === 0) return `0 ${label}s`;
  if (count === 1) return `1 ${label}`;
  if (count < 5) return `2-4 ${label}s`;
  if (count < 20) return `5-19 ${label}s`;
  return `20+ ${label}s`;
}

function statusBadgeHtml(status, options = {}) {
  if (window.AuraStatusBadges?.badge) return window.AuraStatusBadges.badge(status, options);
  return esc(status);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function exportRun(format) {
  if (!activeRunId) return;
  window.location.href = `/api/recon-runs/${encodeURIComponent(activeRunId)}/export/${format}`;
}

async function checkEnvironment() {
  $("checkEnvironment").disabled = true;
  $("setupLog").textContent = "Checking environment...";
  try {
    const data = await api("/api/environment/check", { method: "POST", body: JSON.stringify({ runtime: $("setupRuntime").value }) });
    renderEnvironment(data);
  } catch (error) {
    $("setupLog").textContent = error.message;
    $("status").textContent = error.message;
  } finally {
    $("checkEnvironment").disabled = false;
  }
}

function renderEnvironment(data) {
  $("setupLog").textContent = data.log || "";
  const rows = [];
  for (const item of data.tools || []) {
    rows.push(`<tr><td>${esc(item.tool)}</td><td>${statusBadgeHtml(item.status || (item.ok ? "ok" : "missing"))}</td><td>${esc(item.version || item.error || "")}</td></tr>`);
  }
  $("setupToolRows").innerHTML = rows.join("");
}

async function installEnvironment() {
  $("installEnvironment").disabled = true;
  $("setupLog").textContent = "Installing/updating tools...";
  try {
    const data = await api("/api/environment/install", { method: "POST", body: JSON.stringify({ runtime: $("setupRuntime").value }) });
    renderEnvironment(data);
  } catch (error) {
    $("setupLog").textContent = error.message;
    $("status").textContent = error.message;
  } finally {
    $("installEnvironment").disabled = false;
  }
}

async function saveApiKey() {
  $("saveApiKey").disabled = true;
  $("status").textContent = "Saving API key...";
  setApiPreflightState("running", "Testing provider...", "Checking auth method and a lightweight API endpoint.");
  try {
    const data = await api("/api/api-keys", {
      method: "POST",
      body: JSON.stringify({
        provider: $("keyProvider").value.trim(),
        label: $("keyLabel").value.trim(),
        apiKey: $("apiKeyValue").value.trim(),
        monthlyLimit: $("keyMonthlyLimit").value ? Number($("keyMonthlyLimit").value) : null
      })
    });
    $("apiKeyValue").value = "";
    const ok = data.preflight?.ok !== false;
    setApiPreflightState(ok ? "ok" : "failed", ok ? "API preflight passed" : "API preflight failed", data.preflight?.message || "");
    $("status").textContent = ok ? "API key saved and validated" : "API key saved as failed; check provider auth format";
    await refreshApiKeys();
  } catch (error) {
    setApiPreflightState("failed", "API preflight failed", error.message);
    $("status").textContent = error.message;
  } finally {
    $("saveApiKey").disabled = false;
  }
}

function setApiPreflightState(state, title, detail) {
  const node = $("apiPreflightStatus");
  node.className = `api-preflight ${state}`;
  node.querySelector("strong").textContent = title;
  node.querySelector("small").textContent = detail || "";
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
    `<tr>
      <td>${esc(wordlist.name)}</td>
      <td>${esc(wordlist.category)}</td>
      <td>${wordlistStatusBadge(wordlist.status)}</td>
      <td>${esc(wordlist.path)}</td>
      <td class="row-actions">
        <button type="button" data-wordlist-preview="${esc(wordlist.id)}">View</button>
        <button type="button" data-wordlist-download="${esc(wordlist.id)}">Download</button>
        <button type="button" class="danger-button" data-wordlist-delete="${esc(wordlist.id)}">Delete</button>
      </td>
    </tr>`
  ).join("");
}

function wordlistStatusBadge(status) {
  const value = String(status || "unknown");
  return statusBadgeHtml(value);
}

async function openWordlistPreview(id) {
  const modal = ensureToolLogModal();
  $("toolLogModalTitle").textContent = "Loading wordlist...";
  $("toolLogModalBody").textContent = "";
  modal.classList.remove("hidden");
  try {
    const data = await api(`/api/wordlists/${encodeURIComponent(id)}/preview`);
    $("toolLogModalTitle").textContent = `${data.wordlist?.name || "wordlist"} (${data.sizeBytes || 0} bytes${data.truncated ? ", truncated" : ""})`;
    $("toolLogModalBody").textContent = data.content || "(empty wordlist)";
  } catch (error) {
    $("toolLogModalTitle").textContent = "Wordlist unavailable";
    $("toolLogModalBody").textContent = error.message;
  }
}

function downloadWordlist(id) {
  window.location.href = `/api/wordlists/${encodeURIComponent(id)}/download`;
}

async function deleteWordlist(id) {
  const confirmed = await window.AuraDialogs.confirm({
    tone: "danger",
    title: "Delete wordlist",
    message: "Delete this wordlist entry? Generated files under data/wordlists/generated are removed too.",
    confirmLabel: "Delete wordlist"
  });
  if (!confirmed) return;
  $("status").textContent = "Deleting wordlist...";
  try {
    const data = await api(`/api/wordlists/${encodeURIComponent(id)}`, { method: "DELETE" });
    $("status").textContent = data.fileDeleted ? "Generated wordlist deleted" : "Wordlist entry deleted";
    await refreshWordlists();
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function refreshApiKeys() {
  const data = await api("/api/api-keys");
  apiKeysData = data.apiKeys || [];
  renderApiKeys();
}

function renderApiKeys() {
  const rows = [...apiKeysData].sort(compareApiKeys);
  renderApiKeyAlerts(rows);
  $("apiKeyRows").innerHTML = rows.map((key) =>
    `<tr><td>${esc(key.provider)}</td><td>${esc(key.label)}</td><td>${esc(key.key_preview)}</td><td>${apiStatusBadge(key.status)}</td><td>${apiUsageProgress(key)}</td><td><button class="api-key-delete danger-button" type="button" data-api-key-id="${esc(key.id)}">Delete</button></td></tr>`
  ).join("");
  renderApiKeyTableSummary(rows);
  document.querySelectorAll("[data-api-sort]").forEach((button) => {
    const active = button.dataset.apiSort === apiKeySort.key;
    button.classList.toggle("active", active);
    button.textContent = `${button.textContent.replace(/\s+[<>]$/, "")}${active ? apiKeySort.direction === "asc" ? " <" : " >" : ""}`;
  });
}

function apiUsageProgress(key) {
  const used = Number(key.used_count || 0);
  const limit = Number(key.monthly_limit || 0);
  const hasLimit = Number.isFinite(limit) && limit > 0;
  const percent = hasLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const label = hasLimit ? `${used}/${limit}` : `${used}/unlimited`;
  const tone = hasLimit && percent >= 95 ? "danger" : hasLimit && percent >= 75 ? "warning" : "ok";
  return `<div class="api-usage-cell" title="${esc(label)}">`
    + `<div class="api-usage-top"><span>${esc(label)}</span><span>${hasLimit ? `${percent}%` : "unlimited"}</span></div>`
    + `<div class="api-usage-progress ${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="${hasLimit ? esc(limit) : "0"}" aria-valuenow="${esc(used)}" aria-label="API usage for ${esc(key.provider)}">`
    + `<span style="width:${percent}%"></span></div></div>`;
}

function renderApiKeyTableSummary(keys) {
  const target = document.getElementById("apiKeyTableSummary");
  if (!target) return;
  const active = keys.filter((key) => String(key.status || "").toLowerCase() === "active").length;
  const limited = keys.filter((key) => Number(key.monthly_limit || 0) > 0).length;
  target.textContent = `${keys.length} provider key${keys.length === 1 ? "" : "s"} · ${active} active · ${limited} metered`;
}

function compareApiKeys(left, right) {
  const direction = apiKeySort.direction === "desc" ? -1 : 1;
  if (apiKeySort.key === "usage") {
    return direction * (Number(left.used_count || 0) - Number(right.used_count || 0));
  }
  return direction * String(left[apiKeySort.key] || "").localeCompare(String(right[apiKeySort.key] || ""), undefined, { numeric: true });
}

function apiStatusBadge(status) {
  const normalized = String(status || "unknown").toLowerCase();
  const safe = ["active", "failed", "disabled", "exhausted"].includes(normalized) ? normalized : "unknown";
  return statusBadgeHtml(status || "unknown", { className: `api-status-badge ${safe}` });
}

function renderApiKeyAlerts(keys) {
  const exhausted = keys.filter((key) => String(key.status || "").toLowerCase() === "exhausted");
  if (!exhausted.length) return;
  setApiPreflightState(
    "failed",
    `${exhausted.length} API key${exhausted.length === 1 ? "" : "s"} need attention`,
    exhausted.map((key) => `${key.provider}/${key.label}: replace the key, enable a paid/free plan, or delete/disable the provider.`).join(" ")
  );
}

function sortApiKeys(key) {
  apiKeySort = {
    key,
    direction: apiKeySort.key === key && apiKeySort.direction === "asc" ? "desc" : "asc"
  };
  renderApiKeys();
}

async function testAllApiKeys() {
  $("testAllApiKeys").disabled = true;
  $("saveApiKey").disabled = true;
  setApiPreflightState("running", "Testing all API keys...", "Running provider-specific preflight checks.");
  try {
    const data = await api("/api/api-keys/preflight-all", { method: "POST" });
    const okCount = (data.results || []).filter((result) => result.preflight?.ok).length;
    const total = (data.results || []).length;
    setApiPreflightState(okCount === total ? "ok" : "failed", `API preflight finished: ${okCount}/${total} active`, "Badges updated in the API key table.");
    await refreshApiKeys();
  } catch (error) {
    setApiPreflightState("failed", "API preflight failed", error.message);
  } finally {
    $("testAllApiKeys").disabled = false;
    $("saveApiKey").disabled = false;
  }
}

async function deleteApiKey(id) {
  if (!id) return;
  const row = apiKeysData.find((key) => String(key.id) === String(id));
  const confirmed = await window.AuraDialogs.confirm({
    tone: "danger",
    title: "Delete API key",
    message: `Delete API key ${row?.provider || id}/${row?.label || ""}?`,
    confirmLabel: "Delete key"
  });
  if (!confirmed) return;
  await api(`/api/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  setApiPreflightState("ok", "API key deleted", "The key was removed from local storage.");
  await refreshApiKeys();
}

function exportApiKeys() {
  window.location.href = "/api/api-keys/export";
}

function importApiKeys() {
  $("apiKeyImportFile").click();
}

async function handleApiKeyImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  setApiPreflightState("running", "Importing API keys...", "Parsing JSON and running provider preflights.");
  try {
    const payload = JSON.parse(await file.text());
    const data = await api("/api/api-keys/import", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const okCount = (data.results || []).filter((result) => result.preflight?.ok).length;
    setApiPreflightState("ok", `Imported ${data.imported || 0} API keys`, `${okCount}/${data.imported || 0} passed preflight.`);
    await refreshApiKeys();
  } catch (error) {
    setApiPreflightState("failed", "API key import failed", error.message);
  } finally {
    event.target.value = "";
  }
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
         authorized: true
      })
    });
    $("status").textContent = `Provider discovery: ${data.summary.domainsCount} matches, ${data.summary.savedLeads} saved leads`;
    await refreshLeads();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("reverseWhois").disabled = false;
  }
}

async function suggestWhoisTerms() {
  if (!$("target").value) return;
  $("whoisSuggestionStatus").textContent = "Suggesting terms...";
  try {
    const data = await api(`/api/targets/${encodeURIComponent($("target").value)}/whois-suggestions`, { method: "POST" });
    $("whoisInclude").value = data.include.join("\n");
    $("whoisExclude").value = data.exclude.join("\n");
    $("whoisSuggestionStatus").textContent = "Suggestions loaded from public WHOIS/RDAP signals.";
  } catch (error) {
    $("whoisSuggestionStatus").textContent = error.message;
  }
}

function normalizeLeadScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

function leadScoreTone(score) {
  if (score == null) return "empty";
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function leadScoreBar(score) {
  const tone = leadScoreTone(score);
  const width = score == null ? 0 : Math.max(4, score);
  const label = score == null ? "n/a" : `${score}`;
  const title = score == null ? "No score recorded" : `Correlation score ${score}/100`;
  return `<div class="lead-score-cell lead-score-${tone}" title="${esc(title)}" aria-label="${esc(title)}">
    <div class="lead-score-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(score ?? 0)}">
      <span style="width:${esc(width)}%"></span>
    </div>
    <strong>${esc(label)}</strong>
  </div>`;
}

function leadStatusBadge(status) {
  if (window.AuraStatusBadges?.badge) return window.AuraStatusBadges.badge(status, { className: "lead-status-badge" });
  return `<span class="lead-status-text">${esc(status)}</span>`;
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
function updateReconModeUi() {
  const mode = $("reconMode")?.value;
  const fullOptions = $("fullReconOptions");
  if (fullOptions) fullOptions.style.display = mode === "full" ? "" : "none";
}
$("reconMode").addEventListener("change", updateReconModeUi);
$("start").addEventListener("click", startRecon);
$("pauseRun").addEventListener("click", () => updateRunControl("pause"));
$("resumeRun").addEventListener("click", () => updateRunControl("resume"));
$("cancelRun").addEventListener("click", () => updateRunControl("cancel"));
$("runHttpFollowup").addEventListener("click", runHttpFollowup);
$("runUrlFollowup").addEventListener("click", () => runFocusedFollowup("urls", "URL/parameter follow-up"));
$("runHttpOnlyFollowup").addEventListener("click", () => runFocusedFollowup("http-only", "HTTP-only follow-up"));
$("runTechFollowup").addEventListener("click", () => runFocusedFollowup("tech", "technology follow-up"));
$("runScreenshotFollowup").addEventListener("click", () => runFocusedFollowup("screenshots", "screenshot follow-up"));
$("runTrackerFollowup").addEventListener("click", () => runFocusedFollowup("trackers", "analytics/pixel follow-up"));
$("runFaviconFollowup").addEventListener("click", () => runFocusedFollowup("favicons", "favicon follow-up"));
$("reverseWhois").addEventListener("click", runReverseWhois);
$("suggestWhoisTerms").addEventListener("click", suggestWhoisTerms);
$("saveApiKey").addEventListener("click", saveApiKey);
$("testAllApiKeys").addEventListener("click", testAllApiKeys);
$("exportApiKeys").addEventListener("click", exportApiKeys);
$("importApiKeys").addEventListener("click", importApiKeys);
$("apiKeyImportFile").addEventListener("change", handleApiKeyImportFile);
document.querySelectorAll("[data-api-sort]").forEach((button) => {
  button.addEventListener("click", () => sortApiKeys(button.dataset.apiSort));
});
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
document.addEventListener("click", (event) => {
  const button = event.target.closest(".api-key-delete");
  if (!button) return;
  deleteApiKey(button.datasetApiKeyId).catch((error) => {
    setApiPreflightState("failed", "Delete failed", error.message);
  });
});
document.addEventListener("click", (event) => {
  const preview = event.target.closest("[data-wordlist-preview]");
  if (preview) {
    openWordlistPreview(preview.dataset.wordlistPreview);
    return;
  }
  const download = event.target.closest("[data-wordlist-download]");
  if (download) {
    downloadWordlist(download.dataset.wordlistDownload);
    return;
  }
  const remove = event.target.closest("[data-wordlist-delete]");
  if (remove) {
    deleteWordlist(remove.dataset.wordlistDelete);
  }
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
$("setupRuntime").addEventListener("change", loadAiRuntimeStatus);
$("aiAutonomyLevel").addEventListener("input", () => {
  updateAiAutonomyLabel();
  updateAiSettingsPreview();
});
window.AuraAiAgent?.bind?.();
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
bindDashboardShellActions();

loadTargets().catch((error) => {
  $("status").textContent = error.message;
});
loadAiSettings().catch((error) => {
  $("aiSettingsStatus").textContent = error.message;
  $("aiSettingsStatus").className = "notice error";
});
window.AuraProxySettings?.bind?.();
window.AuraTopology?.bind?.();
updateReconModeUi();
updateApiKeyProviderHints();
applyTheme(getUiSettings().theme || "aura");
applyBackgroundEffect(getUiSettings().backgroundEffect || "random");
applyFontScale(getUiSettings().fontScale || 100);
