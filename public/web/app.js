"use strict";

let targets = [];
let activeRunId = null;
let lastEventId = 0;
let poll = null;
let refreshRunInFlight = false;
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
const ACTIVE_TAB_STORAGE_KEY = "aura.activeTab";
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
  renderAiModelCards();
  await loadAiRuntimeStatus();
}

async function loadAiRuntimeStatus() {
  try {
    const params = new URLSearchParams({ runtime: $("setupRuntime")?.value?.trim() || "linux" });
    const data = await api(`/api/ai-runtime/status?${params.toString()}`);
    aiRuntimeStatus = data;
    renderAiRuntimeStatus();
  } catch {
    // Runtime status is best-effort background context for the agent; no UI surface now.
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
    const message = await window.AuraAiAgent.ask("Reply with one short sentence confirming that the A.U.R.A AI provider is connected.", { test: true });
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
    autonomyLevel: Number($("aiAutonomyLevel").value || 1),
    deepseekToken: $("deepseekToken")?.value.trim() || ""
  };
}

// Show the DeepSeek session-token field only when the experimental DeepSeek web provider is selected.
function toggleDeepSeekRow() {
  const row = $("deepseekWebRow");
  if (row) row.classList.toggle("hidden", $("aiProvider")?.value !== "deepseek-web" || $("useLocalModel")?.checked);
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
  if ($("deepseekToken")) $("deepseekToken").value = settings.deepseekToken || "";
  toggleDeepSeekRow();
  updateAiAutonomyLabel();
  $("aiProviderMetric").textContent = useLocalModel ? "Local" : $("aiProvider").value;
  $("aiPlanningMetric").textContent = $("aiPlanningModel").value || "-";
  $("aiExecutionMetric").textContent = $("aiExecutionModel").value || "-";
  updateAiModelBadges();
}

// Short, human label of the model actually answering (provider-aware), shown in the header + chat.
function activeAiModelLabel() {
  const s = aiSettings || {};
  if (s.provider === "local") return s.localModel || "Local model";
  if (s.provider === "deepseek-web") return "DeepSeek chat";
  if (s.provider === "opencode") return s.executionModel || "OpenCode (auto)";
  return s.executionModel || s.provider || "—";
}

// Reflect the active model both in the top header badge and in the floating chat panel header.
function updateAiModelBadges() {
  const label = activeAiModelLabel();
  const badge = $("aiModelBadgeText");
  if (badge) badge.textContent = `AI: ${label}`;
  const panel = $("aiPanelModel");
  if (panel) { panel.textContent = label; panel.title = `Active AI model: ${label}`; }
}

function fillModelSelect(id, selected) {
  const select = $(id);
  const models = aiModels.length ? aiModels : [{ id: selected || "", name: selected || "default" }];
  select.innerHTML = models.map((model) => `<option value="${esc(model.id)}">${esc(model.name || model.id)}</option>`).join("");
  if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
}

// Render the free-model list; clicking a card sets it as the execution model.
function renderAiModelCards() {
  const host = $("aiModelCards");
  if (!host) return;
  if (!aiModels.length) { host.innerHTML = `<div class="notice muted compact-notice">No free models loaded. Click Refresh.</div>`; return; }
  host.innerHTML = aiModels.map((model) => `
    <button type="button" class="model-card" data-model-id="${esc(model.id)}" title="Use as execution model">
      <strong>${esc(model.label || model.name || model.id)}</strong>
      <span>${esc(model.id)}</span>
      ${(model.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}
    </button>`).join("");
  host.querySelectorAll(".model-card").forEach((card) => card.addEventListener("click", () => {
    const id = card.dataset.modelId;
    if ($("aiExecutionModel")) { if (![...$("aiExecutionModel").options].some((o) => o.value === id)) $("aiExecutionModel").add(new Option(id, id)); $("aiExecutionModel").value = id; }
    $("aiExecutionMetric").textContent = id;
    if (aiSettings) aiSettings.executionModel = id;
    updateAiModelBadges();
  }));
}

async function refreshAiModels() {
  const button = $("refreshAiModels");
  if (button) { button.disabled = true; button.textContent = "Refreshing..."; }
  try {
    const data = await api("/api/ai-models?refresh=true");
    aiModels = data.models || [];
    fillModelSelect("aiPlanningModel", aiSettings?.planningModel);
    fillModelSelect("aiExecutionModel", aiSettings?.executionModel);
    renderAiModelCards();
    $("aiSettingsStatus").textContent = `Loaded ${aiModels.length} free model(s).`;
    $("aiSettingsStatus").className = "notice ok";
  } catch (error) {
    $("aiSettingsStatus").textContent = `Model refresh failed: ${error.message}`;
    $("aiSettingsStatus").className = "notice error";
  } finally {
    if (button) { button.disabled = false; button.textContent = "Refresh"; }
  }
}

function renderAiRuntimeStatus() {
  // The raw JSON runtime panel was removed; keep the data in memory for the AI agent context only.
  const node = $("aiRuntimeStatus");
  if (node) node.textContent = JSON.stringify(aiRuntimeStatus || {}, null, 2);
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
  if (document.body.classList.contains("results-view-expanded")) exitResultsFullscreen();
  if (name === "topology") window.AuraTopology?.render?.();
  if (name === "results" || name === "recon") populateResultsProjectPicker().catch(() => {});
  if (name === "tools") window.AuraTools?.renderTiles?.();
  if (name === "flow") window.AuraReconFlow?.activate?.(activeRunId || Number($("runId")?.textContent) || null);
  else window.AuraReconFlow?.deactivate?.();
  if (name) localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, name);
}

// Restore the last-viewed tab on load (page refresh should stay put, not jump to Settings).
function restoreActiveTab() {
  const saved = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  const valid = saved && document.getElementById(`tab-${saved}`);
  activateTab(valid ? saved : "recon");
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
  if (name === "credentials") refreshApiKeys().catch(() => {});
  if (name === "storage") loadStorageUsage().catch(() => {});
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
}

const STORAGE_CATEGORY_COLORS = {
  database: "#52d391",
  artifacts: "var(--accent)",
  proxies: "#c792ea",
  wordlists: "#ffcb6b",
  targets: "#82aaff"
};

async function loadStorageUsage() {
  const host = document.getElementById("storageUsage");
  if (!host) return;
  host.innerHTML = `<div class="notice muted">Measuring local storage…</div>`;
  try {
    const { storage } = await api("/api/storage/usage");
    const total = storage.totalBytes || 0;
    const bar = storage.categories
      .filter((cat) => cat.bytes > 0)
      .map((cat) => `<span style="width:${total ? (cat.bytes / total) * 100 : 0}%;background:${STORAGE_CATEGORY_COLORS[cat.key] || "var(--accent)"}" title="${esc(cat.label)}: ${esc(formatBytes(cat.bytes))}"></span>`)
      .join("") || `<span style="width:100%;background:var(--soft-line)"></span>`;
    const cards = storage.categories.map((cat) => `
      <div class="storage-card">
        <span class="storage-card-dot" style="background:${STORAGE_CATEGORY_COLORS[cat.key] || "var(--accent)"}"></span>
        <div class="storage-card-body">
          <strong>${esc(formatBytes(cat.bytes))}</strong>
          <span>${esc(cat.label)}${cat.files != null ? ` · ${esc(cat.files)} file` : ""}</span>
          <code>${esc(cat.path)}</code>
        </div>
      </div>`).join("");
    const disk = storage.disk
      ? `<div class="storage-disk">
           <div class="storage-disk-head"><span>Disk (data drive)</span><span>${esc(formatBytes(storage.disk.used))} / ${esc(formatBytes(storage.disk.total))} used · ${esc(formatBytes(storage.disk.free))} free</span></div>
           <div class="storage-bar"><span style="width:${storage.disk.total ? (storage.disk.used / storage.disk.total) * 100 : 0}%;background:linear-gradient(90deg,var(--accent),#52d391)"></span></div>
         </div>`
      : "";
    host.innerHTML = `
      <div class="storage-summary">
        <div class="storage-total"><strong>${esc(formatBytes(total))}</strong><span>A.U.R.A local footprint · ${esc(storage.counts.runs)} run(s) · ${esc(storage.counts.targets)} target(s)</span></div>
        <div class="storage-bar storage-bar-stacked">${bar}</div>
      </div>
      <div class="storage-cards">${cards}</div>
      ${disk}
      <button type="button" id="storageRefresh" class="secondary-button">Refresh</button>`;
    document.getElementById("storageRefresh")?.addEventListener("click", () => loadStorageUsage().catch(() => {}));
  } catch (error) {
    host.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
  }
}

function activateResultsView(name) {
  document.querySelectorAll(".result-subtab").forEach((button) => {
    button.classList.toggle("active", button.dataset.resultsView === name);
  });
  document.querySelectorAll(".result-view").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `results-${name}`);
  });
}

// Opens the Results area in a fullscreen modal. The real sub-tab strip and every view node are
// moved into the modal (and back on close), so switching tables, grouping and sorting all stay
// live inside fullscreen without having to exit and reopen.
let fullscreenReturn = null;

function ensureResultsFullscreenModal() {
  let modal = document.getElementById("resultsFullscreenModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "resultsFullscreenModal";
  modal.className = "results-fullscreen-modal hidden";
  modal.innerHTML = `<div class="results-fullscreen-dialog" role="dialog" aria-modal="true" aria-label="Results"><div class="results-fullscreen-body" id="resultsFullscreenBody"></div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (event) => { if (event.target === modal) exitResultsFullscreen(); });
  return modal;
}

function toggleResultsFullscreen() {
  if (document.body.classList.contains("results-view-expanded")) {
    exitResultsFullscreen();
    return;
  }
  const strip = document.querySelector("#tab-results .result-subtabs");
  const views = [...document.querySelectorAll("#tab-results .result-view")];
  if (!strip || views.length === 0) return;
  const modal = ensureResultsFullscreenModal();
  const body = modal.querySelector("#resultsFullscreenBody");
  // One placeholder marks where the block returns; move the strip and all views in original order.
  const placeholder = document.createComment("results-fullscreen-placeholder");
  strip.parentNode.insertBefore(placeholder, strip);
  const moved = [strip, ...views];
  for (const node of moved) body.appendChild(node);
  fullscreenReturn = { placeholder, moved };
  document.body.classList.add("results-view-expanded");
  modal.classList.remove("hidden");
  const toggle = document.getElementById("resultsExpandToggle");
  if (toggle) toggle.textContent = "✕ Close";
}

function exitResultsFullscreen() {
  const modal = document.getElementById("resultsFullscreenModal");
  if (modal) modal.classList.add("hidden");
  document.body.classList.remove("results-view-expanded");
  if (fullscreenReturn) {
    const { placeholder, moved } = fullscreenReturn;
    for (const node of moved) placeholder.parentNode?.insertBefore(node, placeholder);
    placeholder.remove();
    fullscreenReturn = null;
  }
  const toggle = document.getElementById("resultsExpandToggle");
  if (toggle) toggle.textContent = "⛶ Expand";
}

function activateRunActivityView() {
  activateTab("results");
  activateResultsView("activity");
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
    rebuildReconSubmenu();
    return;
  }

  const saved = localStorage.getItem(ACTIVE_TARGET_STORAGE_KEY);
  const nextTarget = targets.some((target) => target.target_name === saved) ? saved : targets[0].target_name;
  $("target").value = nextTarget;
  await loadTargetConfig();
  await refreshLeads();
  await restoreLatestRunForSelectedTarget();
  rebuildReconSubmenu();
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
    $("target").value = data.target?.target_name || data.config?.target_name || "";
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

async function populateResultsProjectPicker() {
  const select = $("resultsProjectSelect");
  if (!select) return;
  const previous = select.value;
  const names = new Set((targets || []).map((t) => t.target_name).filter(Boolean));
  // Also surface projects that exist only as runs in the DB — e.g. a restored data/ dir whose
  // targets/ configs were not copied. This makes old scans loadable immediately, before any new run.
  try {
    const data = await api("/api/recon-runs?limit=500");
    for (const run of data.runs || []) if (run.target_name) names.add(run.target_name);
  } catch { /* fall back to targets-only list */ }
  const list = [...names].sort((a, b) => a.localeCompare(b));
  select.innerHTML = list.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  const next = list.includes(previous) ? previous : ($("target")?.value || list[0] || "");
  if (next) select.value = next;
  await populateResultsRunPicker();
}

async function populateResultsRunPicker() {
  const projectSelect = $("resultsProjectSelect");
  const runSelect = $("resultsRunSelect");
  if (!projectSelect || !runSelect) return;
  const targetName = projectSelect.value;
  if (!targetName) { runSelect.innerHTML = ""; return; }
  try {
    const data = await api(`/api/recon-runs?targetName=${encodeURIComponent(targetName)}&limit=50`);
    const runs = data.runs || [];
    runSelect.innerHTML = runs.length
      ? runs.map((run) => `<option value="${esc(run.id)}">#${esc(run.id)} · ${esc(run.status)} · ${esc(run.run_type || run.mode || "run")} · ${esc(run.started_at || "")}</option>`).join("")
      : `<option value="">No runs</option>`;
    if (runs.some((run) => run.id === activeRunId)) runSelect.value = String(activeRunId);
    $("resultsProjectHint").textContent = runs.length ? `${runs.length} run(s) for ${targetName}` : `No runs for ${targetName} yet`;
  } catch (error) {
    runSelect.innerHTML = "";
    $("resultsProjectHint").textContent = error.message;
  }
}

async function loadSelectedResultsRun() {
  const runSelect = $("resultsRunSelect");
  const runId = Number(runSelect?.value);
  if (!runId) {
    $("resultsProjectHint").textContent = "Select a run to load.";
    return;
  }
  activeRunId = runId;
  lastEventId = 0;
  window.AuraAiAgent?.resetRunFeed?.(activeRunId);
  $("runId").textContent = activeRunId;
  $("events").innerHTML = "";
  await refreshRun();
  if (poll) clearInterval(poll);
  const run = (await api(`/api/recon-runs/${activeRunId}`))?.run;
  if (run && ["queued", "running", "paused"].includes(run.status)) poll = setInterval(refreshRun, 1500);
  // The loader lives in Recon; jump to Results to show the loaded run.
  activateTab("results");
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
  if (!activeRunId || refreshRunInFlight) return;
  refreshRunInFlight = true;
  try { await _refreshRun(); } catch (err) { console.error("[refreshRun]", err); } finally { refreshRunInFlight = false; }
}

async function _refreshRun() {
  if (!activeRunId) return;
  const [runData, eventData, countsResp, domainData, artifactData, serviceData, technologyData, screenshotData, toolData, deltaData] = await Promise.all([
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
  const run = runData?.run;
  if (!run) return;
  if (["completed", "failed", "cancelled"].includes(run.status) && poll) { clearInterval(poll); poll = null; }
  const counts = countsResp?.counts || {};
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
  // Only re-render each table when its count changes — full re-render every 1.5s
  // on hundreds of rows saturates the renderer even when nothing changed.
  const prev = resultsData.totals || {};
  if (counts.domains !== prev.domains) renderDomains(domainData.domains || []);
  if (counts.urls !== prev.urls) renderArtifacts(artifactData.artifacts || []);
  if (counts.httpServices !== prev.httpServices) renderHttpServices(serviceData.services || []);
  if (counts.technologies !== prev.technologies) renderTechnologies(technologyData.technologies || []);
  if (counts.screenshots !== prev.screenshots) renderScreenshots(screenshotData.screenshots || []);
  if ((toolData.toolResults || []).length !== (resultsData.toolResults || []).length) renderToolResults(toolData.toolResults || []);
  resultsData.totals = { ...counts };
  renderRunDelta(deltaData.delta || null);
  window.AuraTopology?.update?.({
    domains: domainData.domains || [],
    services: serviceData.services || [],
    urls: (artifactData.artifacts || []).map((a) => ({ ...a, url: a.value, host: a.extra_json?.host })),
    screenshots: screenshotData.screenshots || [],
    technologies: technologyData.technologies || []
  }, { preserveCamera: true });
  window.AuraAiAgent.publishRunInsights?.({
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
  ["runUrlFollowup", "runHttpOnlyFollowup", "runTechFollowup", "runScreenshotFollowup", "runTrackerFollowup", "runFaviconFollowup", "runDirsFollowup", "runCloudFollowup", "runBypass403Followup", "runJsFollowup"].forEach((id) => {
    if ($(id)) $(id).disabled = !canFollowUp;
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
    activateRunActivityView();
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
    activateRunActivityView();
    if (poll) clearInterval(poll);
    poll = setInterval(refreshRun, 1500);
    await refreshRun();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    updateRunControlButtons($("runStatus").textContent);
  }
}

// Derives a short, filesystem-safe target name from a domain (brand label), e.g. *.acme.co.uk -> acme.
function deriveTargetName(domain) {
  const host = String(domain || "").trim().replace(/^\*+\./, "").replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
  const labels = host.split(".").filter(Boolean);
  const secondLevel = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);
  let brand = labels.length >= 2 ? labels[labels.length - 2] : labels[0] || "";
  if (labels.length >= 3 && secondLevel.has(labels[labels.length - 2])) brand = labels[labels.length - 3];
  return (brand || host).replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "target";
}

// One-field quick start: create (or reuse) a target from the pasted domains, then start recon with
// the current tool defaults. Reuses the existing createTarget/startRecon flow for full compatibility.
async function quickStart() {
  const domains = textLines("quickDomains");
  const status = $("quickStatus");
  const fail = (message) => { status.textContent = message; status.className = "notice error"; };
  if (domains.length === 0) return fail("Enter at least one domain to scan.");
  const outOfScope = textLines("quickOutOfScope");
  const name = deriveTargetName(domains[0]);
  $("quickStart").disabled = true;
  status.className = "notice muted";
  status.textContent = `Preparing scan for ${name}...`;
  try {
    const exists = (targets || []).some((t) => t.target_name === name);
    if (!exists) {
      $("newTargetName").value = name;
      $("newProgramUrl").value = "";
      $("newInScope").value = domains.join("\n");
      $("newOutOfScope").value = outOfScope.join("\n");
      await createTarget();
      if (!(targets || []).some((t) => t.target_name === name)) throw new Error("Could not create the target.");
    } else {
      $("target").value = name;
      await loadTargetConfig();
    }
    // Drive the existing recon flow with the quick-start scope.
    $("domains").value = domains.join("\n");
    $("reconMode").value = domains.length === 1 ? "single" : "list";
    updateReconModeUi();
    if ($("intelPreflight")) $("intelPreflight").checked = true;
    await startRecon();
    activateTab("results");
    status.className = "notice";
    status.textContent = `Scan started for ${name}. Follow it in Results or the flow diagram.`;
  } catch (error) {
    fail(error.message);
  } finally {
    $("quickStart").disabled = false;
  }
}

// Experimental DeepSeek web login: open a browser, poll until the session token is captured.
let deepseekLoginPoll = null;
async function startDeepSeekLogin() {
  const status = $("deepseekLoginStatus");
  const button = $("deepseekLogin");
  if (deepseekLoginPoll) { clearInterval(deepseekLoginPoll); deepseekLoginPoll = null; }
  button.disabled = true;
  status.className = "notice muted compact-notice";
  status.textContent = "Opening the browser — log in to DeepSeek...";
  try {
    await api("/api/ai/deepseek/login", { method: "POST" });
    deepseekLoginPoll = setInterval(async () => {
      try {
        const state = await api("/api/ai/deepseek/login/status");
        if (state.status === "waiting") { status.textContent = state.message || "Waiting for login..."; return; }
        clearInterval(deepseekLoginPoll); deepseekLoginPoll = null; button.disabled = false;
        if (state.status === "captured") {
          await loadAiSettings();
          status.className = "notice ok"; status.textContent = "Token captured and saved. DeepSeek chat is ready.";
        } else {
          status.className = "notice error"; status.textContent = state.message || "Login capture failed.";
        }
      } catch (error) {
        clearInterval(deepseekLoginPoll); deepseekLoginPoll = null; button.disabled = false;
        status.className = "notice error"; status.textContent = error.message;
      }
    }, 2000);
  } catch (error) {
    button.disabled = false;
    status.className = "notice error"; status.textContent = error.message;
  }
}

// Only include a tool flag when its checkbox is ticked, so an unticked box lets the scan tier decide.
function reconToolFlags() {
  const map = { ffuf: "useFfuf", cloudEnum: "useCloudEnum", bypass403: "useBypass403", getjs: "useGetJs", katana: "useKatana", tlsx: "useTlsx", subzy: "useSubzy", waymore: "useWaymore", paramspider: "useParamSpider" };
  const flags = {};
  for (const [key, id] of Object.entries(map)) if ($(id)?.checked) flags[key] = true;
  return flags;
}

// Builds the linuxTools list; appends an nmap spec (with its own port preset/custom ports) when enabled.
function buildLinuxToolSpecs() {
  const tools = selectedValues(["subfinder", "amass", "dnsx", "puredns", "shuffleDns", "gau", "httpx"]);
  if ($("useNmap")?.checked) {
    const preset = $("nmapPreset")?.value || "common";
    const spec = { name: "nmap" };
    if (preset === "custom") spec.nmapPorts = $("nmapPorts")?.value || "";
    else spec.nmapPreset = preset;
    tools.push(spec);
  }
  return tools;
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
    const reconMode = $("reconMode").value;
    const data = await api("/api/recon-runs", {
      method: "POST",
      body: JSON.stringify({
        authorized: true,
        targetName: $("target").value,
        rootDomains: domains,
        reconMode,
        fullRecon: reconMode === "full" ? {
          include: textLines("fullWhoisInclude"),
          exclude: textLines("fullWhoisExclude"),
          mode: $("fullWhoisMode").value,
          searchType: $("fullWhoisType").value,
          maxAssetLeads: Number($("maxAssetLeads").value || 250)
        } : null,
        intelPreflight: $("intelPreflight").checked,
        useLinuxRunner: $("useLinuxRunner").checked,
        linuxRuntime: $("linuxRuntime").value,
        linuxTools: buildLinuxToolSpecs(),
        // Scan tier drives which optional tools run; a ticked checkbox adds that tool on top of the tier.
        scanTier: $("scanTier")?.value || "normal",
        ...reconToolFlags(),
        timeoutMs: Number($("timeout").value || 180000),
        passiveSources: selectedValues(["crtsh", "wayback", "rapiddns", "rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx", "whoisxmlapi", "whoisfreaks"]),
        screenshotTools: selectedValues(["gowitness", "aquatone", "eyewitness"]),
        proxyUrl: activeProxyUrl()
      })
    });
    activeRunId = data.run?.id || data.runId;
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
    activateRunActivityView();
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

// Small copy + open-in-new-tab controls for a table cell. `href` is optional (domains get https://).
function rowActions(value, href) {
  const safeValue = esc(String(value ?? ""));
  const open = href
    ? `<a class="row-action" href="${esc(href)}" target="_blank" rel="noreferrer noopener" title="Open in new tab" aria-label="Open in new tab">↗</a>`
    : "";
  return `<span class="row-actions"><button type="button" class="row-action copy-value" data-copy="${safeValue}" title="Copy to clipboard" aria-label="Copy to clipboard">⧉</button>${open}</span>`;
}

function renderDomains(domains) {
  resultsData.domains = domains || [];
  const rows = [...resultsData.domains].sort((a, b) => String(a.domain).localeCompare(String(b.domain)));
  $("domainRowsHint").textContent = countBucket(rows.length, "domain");
  $("domainRows").innerHTML = renderGroupedRows(rows, $("domainGroupBy").value, (domain) => {
    const root = domain.root_domain || domain.domain?.split(".").slice(-2).join(".");
    const groupKey = $("domainGroupBy").value === "kind" ? domain.kind : $("domainGroupBy").value === "root" ? root : domain.source;
    return { groupKey, html: `<tr><td><span class="cell-value">${esc(domain.domain)}</span> ${rowActions(domain.domain, `https://${domain.domain}`)}</td><td>${esc(domain.kind || "")}</td><td>${esc(domain.source || "")}</td></tr>` };
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
    const href = /^https?:\/\//i.test(artifact.value || "") ? artifact.value : "";
    return { groupKey, html: `<tr><td>${esc(artifact.artifact_type)}</td><td class="mono wrap"><span class="cell-value">${esc(artifact.value)}</span> ${rowActions(artifact.value, href)}</td><td>${esc(JSON.stringify(artifact.extra_json || {}))}</td></tr>` };
  });
}

function renderHttpServices(services) {
  resultsData.services = services || [];
  $("serviceRowsHint").textContent = countBucket(resultsData.services.length, "service");
  $("serviceRows").innerHTML = renderGroupedRows(resultsData.services, $("serviceGroupBy").value, (service) => {
    const tech = Array.isArray(service.technologies) ? service.technologies.join(", ") : service.technologies || service.tech || "";
    const statusCode = service.statusCode ?? service.status_code ?? "";
    let groupKey = "";
    if ($("serviceGroupBy").value === "status") groupKey = String(statusCode || "unknown status");
    else if ($("serviceGroupBy").value === "tech") groupKey = tech || "unknown tech";
    else if ($("serviceGroupBy").value === "host") groupKey = hostnameOf(service.url) || "unknown host";
    else if ($("serviceGroupBy").value === "scheme") groupKey = service.url?.split(":")[0] || "unknown scheme";
    return { groupKey, html: `<tr><td class="mono wrap"><a href="${esc(service.url)}" target="_blank" rel="noreferrer noopener">${esc(service.url)}</a> ${rowActions(service.url, service.url)}</td><td>${esc(statusCode)}</td><td>${esc(service.title || "")}</td><td>${esc(tech)}</td></tr>` };
  });
}

function renderTechnologies(technologies) {
  resultsData.technologies = technologies || [];
  $("technologyRowsHint").textContent = countBucket(resultsData.technologies.length, "tech");
  $("technologyRows").innerHTML = renderGroupedRows(resultsData.technologies, $("technologyGroupBy").value, (tech) => {
    const count = tech.count ?? tech.service_count ?? 0;
    const hostCount = tech.hostCount ?? tech.host_count ?? 0;
    let groupKey = tech.source || "unknown";
    if ($("technologyGroupBy").value === "serviceCount") groupKey = bucketNumber(count, "service");
    if ($("technologyGroupBy").value === "hostCount") groupKey = bucketNumber(hostCount, "host");
    return { groupKey, html: `<tr><td>${esc(tech.name || tech.technology)}</td><td>${esc(count)}</td><td>${esc(hostCount)}</td><td>${esc(tech.source || "")}</td></tr>` };
  });
}

// Group screenshots with identical content (same hash) so a page served by many hosts shows once.
function groupScreenshotsByHash(images) {
  const groups = new Map();
  const ungrouped = [];
  for (const image of images) {
    if (!image.hash) { ungrouped.push({ representative: image, count: 1, images: [image] }); continue; }
    const group = groups.get(image.hash);
    if (group) { group.count += 1; group.images.push(image); }
    else groups.set(image.hash, { representative: image, count: 1, images: [image] });
  }
  return [...groups.values(), ...ungrouped].sort((a, b) => b.count - a.count);
}

function renderScreenshots(screenshots) {
  resultsData.screenshots = screenshots || [];
  $("screenshotRowsHint").textContent = countBucket(resultsData.screenshots.length, "screenshot run");
  $("screenshotRows").innerHTML = renderGroupedRows(resultsData.screenshots, $("screenshotGroupBy").value, (shot) => {
    let groupKey = shot.tool_name || "unknown tool";
    if ($("screenshotGroupBy").value === "status") groupKey = shot.status || "unknown status";
    const images = (shot.images || []).filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name || file.relativePath || file.url || ""));
    const count = shot.metadata?.screenshotCount ?? shot.screenshot_count ?? images.length ?? 0;
    const groups = groupScreenshotsByHash(images);
    const preview = groups.length ? `<div class="screenshot-grid">${groups.slice(0, 24).map((group) => {
      const file = group.representative;
      const url = file.url || `/api/recon-runs/${encodeURIComponent(activeRunId)}/artifacts/file?path=${encodeURIComponent(file.relativePath || file.path || "")}`;
      const badge = group.count > 1 ? `<em class="screenshot-dup">×${group.count}</em>` : "";
      const label = group.count > 1 ? `${group.count} identical` : (file.name || "screenshot");
      return `<button type="button" class="screenshot-thumb" data-image-url="${esc(url)}" data-image-name="${esc(file.name || file.relativePath || "")}"><img src="${esc(url)}" alt="${esc(file.name || "screenshot")}" loading="lazy">${badge}<span>${esc(label)}</span></button>`;
    }).join("")}</div>` : "";
    const uniqueNote = groups.length && groups.length !== images.length ? ` (${groups.length} unique)` : "";
    return { groupKey, html: `<tr><td>${statusBadgeHtml(shot.tool_name || "screenshot")}</td><td>${esc(count)}${esc(uniqueNote)}${preview}</td><td>${artifactLinks(shot)}</td></tr>` };
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
  $("runDeltaSummary").textContent = delta.comparedToRunId ? `Compared with run ${delta.comparedToRunId}` : "First run for this target.";
  // Surface the delta compactly in the Explorer (the standalone Delta subtab was consolidated away).
  const explorerDelta = $("explorerDeltaSummary");
  if (explorerDelta) {
    explorerDelta.textContent = delta.comparedToRunId
      ? `vs run ${delta.comparedToRunId}: +${delta.domains?.addedCount || 0} domains, +${delta.urls?.addedCount || 0} URLs, +${delta.httpServices?.addedCount || 0} services (−${delta.domains?.removedCount || 0} domains removed)`
      : "First run for this target — no delta to compare.";
  }
  $("deltaNewDomains").textContent = delta.domains?.addedCount || 0;
  $("deltaRemovedDomains").textContent = delta.domains?.removedCount || 0;
  $("deltaNewUrls").textContent = delta.urls?.addedCount || 0;
  $("deltaNewServices").textContent = delta.httpServices?.addedCount || 0;
  const rows = [];
  // Each delta set exposes { added:[], removed:[] } arrays of observation rows.
  const sets = [["domain", delta.domains], ["url", delta.urls], ["service", delta.httpServices]];
  for (const [type, set] of sets) {
    for (const item of set?.added || []) rows.push(`<tr><td>added</td><td>${type}</td><td class="mono wrap">${esc(item.domain || item.url || "")}</td><td>${esc(item.source || "")}</td></tr>`);
    for (const item of set?.removed || []) rows.push(`<tr><td>removed</td><td>${type}</td><td class="mono wrap">${esc(item.domain || item.url || "")}</td><td>${esc(item.source || "")}</td></tr>`);
  }
  $("deltaRows").innerHTML = rows.join("") || `<tr><td colspan="4" class="muted">No changes versus the previous run.</td></tr>`;
}

function countBucket(count, noun) {
  const n = Number(count) || 0;
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// Generic, data-agnostic column sorting for any rendered table. Clicking a header sorts the data
// rows by that column (numeric-aware), toggling asc/desc; group separators are dropped while sorted.
function sortTableByColumn(table, columnIndex, direction) {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const rows = [...tbody.rows].filter((row) => !row.classList.contains("group-row") && row.cells.length > columnIndex);
  const cellText = (row) => (row.cells[columnIndex]?.innerText || row.cells[columnIndex]?.textContent || "").trim();
  const numeric = rows.every((row) => { const t = cellText(row).replace(/[,%]/g, ""); return t === "" || !Number.isNaN(Number(t)); });
  rows.sort((a, b) => {
    const x = cellText(a);
    const y = cellText(b);
    const cmp = numeric ? (Number(x.replace(/[,%]/g, "")) || 0) - (Number(y.replace(/[,%]/g, "")) || 0) : x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
    return direction === "desc" ? -cmp : cmp;
  });
  // Drop group separators so the sort is global, then re-append in order.
  tbody.querySelectorAll(".group-row").forEach((row) => row.remove());
  for (const row of rows) tbody.appendChild(row);
}

// Builds collapsible tree submenus in the sidebar for nav sections that otherwise show a row of
// buttons in the main panel (Settings, Logs). The submenu mirrors the live in-panel section buttons.
function buildSidebarSubmenus() {
  buildSidebarSubmenu({
    id: "settingsSubmenu",
    tabName: "settings",
    sourceSelector: "#tab-settings .settings-tab",
    valueOf: (button) => button.dataset.settingsPanel,
    hideSelector: "#tab-settings .settings-tabs",
    onSelect: (value) => { activateTab("settings"); activateSettingsPanel(value); }
  });
  // The Logs tab/subtabs are injected at runtime; build its submenu once it appears.
  const nav = document.getElementById("workspaceNav");
  const tryLogs = () => buildSidebarSubmenu({
    id: "logsSubmenu",
    tabName: "logs",
    sourceSelector: "#tab-logs .logs-subtabs [data-log-subtab]",
    valueOf: (button) => button.dataset.logSubtab,
    hideSelector: null,
    onSelect: (value) => {
      nav?.querySelector('.tab[data-tab="logs"]')?.click();
      document.querySelector(`#tab-logs [data-log-subtab="${value}"]`)?.click();
    }
  });
  // Topology view tabs (Graph/Dashboard/Sources/Technologies) are injected at runtime too.
  const tryTopology = () => buildSidebarSubmenu({
    id: "topologySubmenu",
    tabName: "topology",
    sourceSelector: "#tab-topology .topology-view-tabs [data-topology-view]",
    valueOf: (button) => button.dataset.topologyView,
    hideSelector: "#tab-topology .topology-view-tabs",
    onSelect: (value) => {
      nav?.querySelector('.tab[data-tab="topology"]')?.click();
      document.querySelector(`#tab-topology .topology-view-tabs [data-topology-view="${value}"]`)?.click();
    }
  });
  const logsReady = tryLogs();
  const topoReady = tryTopology();
  if (!logsReady || !topoReady) {
    const observer = new MutationObserver(() => {
      const done = tryLogs() && tryTopology();
      if (done) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 60000);
  }
}

// Creates one tree submenu under the given nav tab; returns true once built.
function buildSidebarSubmenu({ id, tabName, sourceSelector, valueOf, hideSelector, onSelect }) {
  const nav = document.getElementById("workspaceNav");
  const navTab = nav?.querySelector(`.tab[data-tab="${tabName}"]`);
  const sources = [...document.querySelectorAll(sourceSelector)];
  if (!nav || !navTab || sources.length === 0) return false;
  if (document.getElementById(id)) return true;

  const submenu = document.createElement("div");
  submenu.id = id;
  submenu.className = "nav-submenu";
  submenu.setAttribute("role", "group");

  let collapsed = !navTab.classList.contains("active");
  let suppressToggle = false;
  const activeValueOf = () => valueOf(document.querySelector(`${sourceSelector}.active`) || sources.find((s) => s.classList.contains("active")));
  const apply = () => {
    const open = submenu.querySelectorAll(".nav-subitem").length > 0 && !collapsed;
    submenu.classList.toggle("open", open);
    if (open) syncSidebarSubmenu(submenu, activeValueOf());
  };

  for (const source of sources) {
    const value = valueOf(source);
    if (!value) continue;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "nav-subitem";
    item.dataset.submenuValue = value;
    item.textContent = source.textContent.trim();
    item.addEventListener("click", () => {
      // A child selection must never collapse the tree, even if onSelect clicks the parent tab.
      suppressToggle = true;
      onSelect(value);
      suppressToggle = false;
      collapsed = false;
      apply();
      syncSidebarSubmenu(submenu, value);
    });
    submenu.appendChild(item);
  }
  navTab.insertAdjacentElement("afterend", submenu);
  if (hideSelector) document.querySelector(hideSelector)?.classList.add("hidden");

  // Only a direct click on the parent toggles the tree; programmatic activation (from a child) does not.
  navTab.addEventListener("click", () => {
    if (suppressToggle) { setTimeout(apply, 0); return; }
    collapsed = submenu.classList.contains("open"); // open -> collapse; closed -> expand
    setTimeout(apply, 0);
  });
  // Switching to a different section collapses this submenu but resets it so it reopens next visit.
  nav.querySelectorAll(`.tab:not([data-tab="${tabName}"])`).forEach((tab) => tab.addEventListener("click", () => {
    collapsed = false;
    submenu.classList.remove("open");
  }));
  apply();
  return true;
}

function syncSidebarSubmenu(submenu, value) {
  submenu.querySelectorAll(".nav-subitem").forEach((item) => item.classList.toggle("active", item.dataset.submenuValue === value));
}

// Moves the utility tabs (Logs, Settings, Guide) and their submenus to the bottom of the sidebar,
// just above the collapse toggle. Idempotent: it does nothing once the order is already correct, so
// it can be driven by a MutationObserver (Guide/Logs tabs and the Logs submenu are injected late)
// without churn.
function reorderNav() {
  const nav = document.getElementById("workspaceNav");
  const toggle = document.getElementById("sidebarToggle");
  if (!nav || !toggle) return;
  const order = ["logs", "settings", "guide"];
  const desired = [];
  for (const name of order) {
    const tab = nav.querySelector(`.tab[data-tab="${name}"]`);
    if (!tab) continue;
    desired.push(tab);
    const submenu = document.getElementById(`${name}Submenu`);
    if (submenu && submenu.parentElement === nav) desired.push(submenu);
  }
  // Just order the items (utilities last) as one continuous list — no separate bottom zone.
  const sequence = [...desired, toggle];
  const tail = [...nav.children].slice(-sequence.length);
  const inPlace = tail.length === sequence.length && tail.every((el, index) => el === sequence[index]);
  if (!inPlace) {
    for (const el of sequence) if (el !== toggle) nav.insertBefore(el, toggle);
  }
}

// Recon sidebar submenu: a quick loader for saved / suspended projects, living under the Recon tab.
// Rebuilt whenever the targets list changes. The parent-toggle wiring is attached only once.
function applyReconSubmenu(submenu) {
  const open = submenu.querySelectorAll(".nav-subitem").length > 0 && !submenu._collapsed;
  submenu.classList.toggle("open", open);
}
function rebuildReconSubmenu() {
  const nav = document.getElementById("workspaceNav");
  const reconTab = nav?.querySelector('.tab[data-tab="recon"]');
  if (!nav || !reconTab) return;
  let submenu = document.getElementById("reconSubmenu");
  if (!submenu) {
    submenu = document.createElement("div");
    submenu.id = "reconSubmenu";
    submenu.className = "nav-submenu";
    submenu.setAttribute("role", "group");
    reconTab.insertAdjacentElement("afterend", submenu);
    submenu._collapsed = !reconTab.classList.contains("active");
    // Parent toggles the tree (programmatic activation from a child does not — see _suppressToggle).
    reconTab.addEventListener("click", () => {
      if (submenu._suppressToggle) { setTimeout(() => applyReconSubmenu(submenu), 0); return; }
      submenu._collapsed = submenu.classList.contains("open");
      setTimeout(() => applyReconSubmenu(submenu), 0);
    });
    // Navigating to any other top-level tab collapses the tree (delegated so late-injected tabs count).
    nav.addEventListener("click", (event) => {
      const tab = event.target.closest(".tab");
      if (!tab || tab.dataset.tab === "recon" || event.target.closest(".nav-submenu")) return;
      submenu._collapsed = true;
      submenu.classList.remove("open");
    });
  }

  const current = document.getElementById("target")?.value || "";
  submenu.innerHTML = "";
  const addItem = (label, value, handler, { active = false, isNew = false } = {}) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "nav-subitem" + (isNew ? " nav-subitem-new" : "");
    item.dataset.submenuValue = value;
    item.textContent = label;
    item.classList.toggle("active", active);
    item.addEventListener("click", () => {
      submenu._suppressToggle = true;
      handler();
      submenu._suppressToggle = false;
      submenu._collapsed = false;
      applyReconSubmenu(submenu);
      submenu.querySelectorAll(".nav-subitem").forEach((el) => el.classList.toggle("active", el === item));
    });
    submenu.appendChild(item);
  };

  // "New scan" returns to the one-field quick start.
  addItem("+ New scan", "__new__", () => {
    activateTab("recon");
    document.getElementById("tab-recon")?.classList.add("quick-only");
    const toggle = document.getElementById("quickAdvancedToggle");
    if (toggle) toggle.textContent = "Advanced options ▸";
  }, { isNew: true });

  // One entry per saved project: loads its config, leads, and restores its latest (possibly paused) run.
  for (const target of (targets || [])) {
    const name = target.target_name;
    if (!name) continue;
    addItem(name, name, () => {
      activateTab("recon");
      document.getElementById("tab-recon")?.classList.remove("quick-only"); // reveal target + run controls
      const toggle = document.getElementById("quickAdvancedToggle");
      if (toggle) toggle.textContent = "Advanced options ▾";
      const select = document.getElementById("target");
      if (select) {
        select.value = name;
        select.dispatchEvent(new Event("change")); // loads config + leads + restores the latest run
      }
    }, { active: name === current });
  }

  applyReconSubmenu(submenu);
}

function enableTableSorting() {
  document.addEventListener("click", (event) => {
    const th = event.target.closest("thead th");
    if (!th) return;
    const table = th.closest("table");
    const headRow = th.parentElement;
    if (!table || !headRow || !table.tBodies[0]) return;
    const columnIndex = [...headRow.children].indexOf(th);
    if (columnIndex < 0) return;
    const direction = th.getAttribute("aria-sort") === "ascending" ? "desc" : "asc";
    for (const sibling of headRow.children) sibling.removeAttribute("aria-sort");
    th.setAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
    sortTableByColumn(table, columnIndex, direction);
  });
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

async function runSearch() {
  const query = $("searchQuery").value.trim();
  const rows = $("searchRows");
  if (!query) {
    rows.innerHTML = `<tr><td colspan="6" class="muted">Enter a query to search saved recon data.</td></tr>`;
    return;
  }
  const params = new URLSearchParams({ q: query });
  if ($("searchCurrentTarget")?.checked && $("target").value) params.set("target", $("target").value);
  rows.innerHTML = `<tr><td colspan="6" class="muted">Searching…</td></tr>`;
  try {
    const data = await api(`/api/search?${params.toString()}`);
    const results = data.results || [];
    if (results.length === 0) {
      rows.innerHTML = `<tr><td colspan="6" class="muted">No matches for "${esc(query)}".</td></tr>`;
      return;
    }
    rows.innerHTML = results.map((item) => `<tr>
      <td>${esc(item.result_type || "")}</td>
      <td>${esc(item.target_name || "")}</td>
      <td class="mono wrap">${esc(item.value || "")}</td>
      <td>${esc(item.detail || "")}</td>
      <td>${esc(item.source || "")}</td>
      <td>${esc(item.seen_at || "")}</td>
    </tr>`).join("");
  } catch (error) {
    rows.innerHTML = `<tr><td colspan="6" class="danger-text">Search failed: ${esc(error.message)}</td></tr>`;
  }
}

// Shared lightweight viewer modal for screenshots and tool logs.
function ensureViewerModal() {
  let modal = document.getElementById("auraViewerModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "auraViewerModal";
  modal.className = "aura-viewer-modal hidden";
  modal.innerHTML = `
    <div class="aura-viewer" role="dialog" aria-modal="true" aria-labelledby="auraViewerTitle">
      <header class="aura-viewer-head">
        <h3 id="auraViewerTitle"></h3>
        <button type="button" id="auraViewerClose" class="aura-viewer-close" aria-label="Close">&times;</button>
      </header>
      <div class="aura-viewer-body" id="auraViewerBody"></div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.classList.add("hidden");
  modal.querySelector("#auraViewerClose").addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  return modal;
}

function ensureToolLogModal() {
  return ensureViewerModal();
}

function openImageModal(url, name, gallery = []) {
  const modal = ensureViewerModal();
  modal.querySelector("#auraViewerTitle").textContent = name || "Screenshot";
  const strip = gallery.length > 1
    ? `<div class="aura-viewer-strip">${gallery.map((image) => `<img src="${esc(image.url)}" alt="${esc(image.name || "")}" data-url="${esc(image.url)}" data-name="${esc(image.name || "")}">`).join("")}</div>`
    : "";
  const body = modal.querySelector("#auraViewerBody");
  body.innerHTML = `<img class="aura-viewer-image" src="${esc(url)}" alt="${esc(name || "screenshot")}">${strip}`;
  body.querySelectorAll(".aura-viewer-strip img").forEach((thumb) => {
    thumb.addEventListener("click", () => openImageModal(thumb.dataset.url, thumb.dataset.name, gallery));
  });
  modal.classList.remove("hidden");
}

async function openToolLogModal(toolResultId, stream) {
  const modal = ensureViewerModal();
  modal.querySelector("#auraViewerTitle").textContent = `Tool log (${stream})`;
  const body = modal.querySelector("#auraViewerBody");
  body.innerHTML = `<pre class="aura-viewer-log muted">Loading…</pre>`;
  modal.classList.remove("hidden");
  try {
    const data = await api(`/api/recon-tool-results/${encodeURIComponent(toolResultId)}/log?stream=${encodeURIComponent(stream)}`);
    modal.querySelector("#auraViewerTitle").textContent = `${data.toolName || "tool"} — ${stream}${data.truncated ? " (truncated)" : ""}`;
    body.innerHTML = `<pre class="aura-viewer-log">${esc(data.content || "(empty)")}</pre>`;
  } catch (error) {
    body.innerHTML = `<pre class="aura-viewer-log danger-text">${esc(error.message)}</pre>`;
  }
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
    const data = await api(`/api/environment/check?runtime=${encodeURIComponent($("setupRuntime").value || "linux")}`);
    renderEnvironment(data.environment || data);
  } catch (error) {
    $("setupLog").textContent = error.message;
    $("status").textContent = error.message;
  } finally {
    $("checkEnvironment").disabled = false;
  }
}

function renderEnvironment(data) {
  const env = data?.environment || data || {};
  const lines = [];
  if (env.aiSetupAssessment) lines.push(env.aiSetupAssessment);
  if (env.terminal?.detail || env.terminal?.message) lines.push(env.terminal.detail || env.terminal.message);
  if (env.agent) lines.push(`AI agent (${env.agent.tool_id || "opencode"}): ${env.agent.installed ? "installed" : "missing"}`);
  $("setupLog").textContent = lines.filter(Boolean).join("\n");
  const tools = [env.agent, ...(env.tools || [])].filter(Boolean);
  $("setupToolRows").innerHTML = tools.map((item) => `<tr><td>${esc(item.tool_id || item.binary || "")}</td><td>${statusBadgeHtml(item.installed ? "completed" : item.status || "missing")}</td><td>${esc(item.version || item.error || "")}</td></tr>`).join("");
}

async function installEnvironment() {
  $("installEnvironment").disabled = true;
  $("setupLog").textContent = "Installing/updating tools...";
  try {
    const data = await api("/api/environment/install", { method: "POST", body: JSON.stringify({ runtime: $("setupRuntime").value }) });
    renderEnvironment(data.environment || data);
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
  const modal = ensureViewerModal();
  const title = modal.querySelector("#auraViewerTitle");
  const body = modal.querySelector("#auraViewerBody");
  title.textContent = "Loading wordlist…";
  body.innerHTML = `<pre class="aura-viewer-log muted">Loading…</pre>`;
  modal.classList.remove("hidden");
  try {
    const data = await api(`/api/wordlists/${encodeURIComponent(id)}/preview`);
    title.textContent = `${data.wordlist?.name || "wordlist"} (${data.sizeBytes || 0} bytes${data.truncated ? ", truncated" : ""})`;
    body.innerHTML = `<pre class="aura-viewer-log">${esc(data.content || "(empty wordlist)")}</pre>`;
  } catch (error) {
    title.textContent = "Wordlist unavailable";
    body.innerHTML = `<pre class="aura-viewer-log danger-text">${esc(error.message)}</pre>`;
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
    const data = await api("/api/recon/whois-term-suggestions", { method: "POST", body: JSON.stringify({ targetName: $("target").value }) });
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
  loadTargetConfig().catch((error) => {
    $("status").textContent = error.message;
  });
  refreshLeads().catch((error) => {
    $("status").textContent = error.message;
  });
  restoreLatestRunForSelectedTarget().catch((error) => {
    $("status").textContent = error.message;
  });
  // Keep the Recon sidebar project list in sync with the dropdown selection.
  const value = $("target").value;
  document.querySelectorAll("#reconSubmenu .nav-subitem").forEach((el) => el.classList.toggle("active", el.dataset.submenuValue === value));
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
$("runDirsFollowup")?.addEventListener("click", () => runFocusedFollowup("dirs", "directory discovery (ffuf)"));
$("runCloudFollowup")?.addEventListener("click", () => runFocusedFollowup("cloud", "cloud resource enumeration"));
$("runBypass403Followup")?.addEventListener("click", () => runFocusedFollowup("bypass403", "403/401 access bypass"));
$("runJsFollowup")?.addEventListener("click", () => runFocusedFollowup("js", "JavaScript discovery"));
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
document.addEventListener("click", async (event) => {
  const copyButton = event.target.closest(".copy-value");
  if (!copyButton) return;
  const value = copyButton.dataset.copy || "";
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    const original = copyButton.textContent;
    copyButton.textContent = "✓";
    copyButton.classList.add("copied");
    setTimeout(() => { copyButton.textContent = original; copyButton.classList.remove("copied"); }, 1000);
  } catch {
    copyButton.title = "Copy failed";
  }
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
  deleteApiKey(button.dataset.apiKeyId).catch((error) => {
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
$("setupLogExpand")?.addEventListener("click", () => {
  const log = $("setupLog");
  const expanded = log.classList.toggle("expanded");
  $("setupLogExpand").textContent = expanded ? "Collapse" : "Expand";
});
$("saveAiSettings").addEventListener("click", saveAiSettings);
$("testAiSettings").addEventListener("click", testAiSettings);
$("aiProvider").addEventListener("change", updateAiSettingsPreview);
$("useLocalModel").addEventListener("change", updateAiSettingsPreview);
$("refreshAiModels")?.addEventListener("click", refreshAiModels);
$("deepseekLogin")?.addEventListener("click", startDeepSeekLogin);
$("deepseekTokenToggle")?.addEventListener("click", () => {
  const input = $("deepseekToken");
  const toggle = $("deepseekTokenToggle");
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  toggle.setAttribute("aria-pressed", String(show));
  toggle.setAttribute("aria-label", show ? "Hide token" : "Show token");
  toggle.classList.toggle("active", show);
});
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
// Assets sub-navigation (Domains / Services / URLs / Tech merged into one Results view).
document.addEventListener("click", (event) => {
  const tab = event.target.closest(".assets-tab");
  if (!tab) return;
  const asset = tab.dataset.asset;
  document.querySelectorAll(".assets-tab").forEach((node) => node.classList.toggle("active", node === tab));
  document.querySelectorAll(".asset-view").forEach((view) => view.classList.toggle("active", view.id === `asset-${asset}`));
});
// Add an "Expand" control to the Results sub-tab strip that opens the active view fullscreen.
(function addResultsExpandButton() {
  const strip = document.querySelector("#tab-results .result-subtabs");
  if (!strip || document.getElementById("resultsExpandToggle")) return;
  const button = document.createElement("button");
  button.id = "resultsExpandToggle";
  button.type = "button";
  button.className = "result-subtab result-expand-toggle";
  button.title = "Open the current table fullscreen";
  button.textContent = "⛶ Expand";
  button.addEventListener("click", toggleResultsFullscreen);
  strip.appendChild(button);
})();
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("results-view-expanded")) exitResultsFullscreen();
});
$("resultsProjectSelect")?.addEventListener("change", () => populateResultsRunPicker().catch(() => {}));
$("resultsLoadRun")?.addEventListener("click", () => {
  loadSelectedResultsRun().catch((error) => {
    $("resultsProjectHint").textContent = error.message;
  });
});
["deltaGroupBy", "domainGroupBy", "serviceGroupBy", "urlGroupBy", "technologyGroupBy", "screenshotGroupBy"].forEach((id) => {
  $(id)?.addEventListener("change", renderAllResultTables);
});
$("fontScale").addEventListener("input", () => applyFontScale($("fontScale").value));
$("themeSelect").addEventListener("change", () => applyTheme($("themeSelect").value));
$("backgroundEffect").addEventListener("change", () => applyBackgroundEffect($("backgroundEffect").value));
document.querySelectorAll(".tab").forEach((button) => {
  if (button.dataset.navAction) return; // action buttons (e.g. Flow) handle their own click
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});
// "Flow" is now a regular workspace tab (data-tab="flow"); activateTab renders its panel.
bindDashboardShellActions();
enableTableSorting();
// Restore the saved tab BEFORE building submenus so each tree's collapsed state matches the active tab
// (otherwise the Settings submenu builds open because Settings is the default-active tab in the markup).
restoreActiveTab();
buildSidebarSubmenus();
rebuildReconSubmenu();
reorderNav();
// Guide/Logs tabs and the Logs submenu are injected after boot; keep the bottom cluster ordered.
(function observeNavOrder() {
  const nav = document.getElementById("workspaceNav");
  if (!nav) return;
  const observer = new MutationObserver(() => reorderNav());
  observer.observe(nav, { childList: true });
  setTimeout(() => observer.disconnect(), 20000);
})();
// Guide/Logs panels are injected after boot; retry the restore once if the saved tab was one of them.
if (localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) && !document.getElementById(`tab-${localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)}`)) {
  setTimeout(restoreActiveTab, 600);
}
$("nmapPreset")?.addEventListener("change", () => {
  $("nmapPorts")?.classList.toggle("hidden", $("nmapPreset").value !== "custom");
});
$("quickStart")?.addEventListener("click", quickStart);
$("quickAdvancedToggle")?.addEventListener("click", () => {
  const recon = document.getElementById("tab-recon");
  const collapsed = recon.classList.toggle("quick-only");
  $("quickAdvancedToggle").textContent = collapsed ? "Advanced options ▸" : "Advanced options ▾";
});
$("quickDomains")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) quickStart();
});

loadTargets()
  .then(() => populateResultsProjectPicker().catch(() => {}))
  .catch((error) => {
    $("status").textContent = error.message;
  });
loadAiSettings().catch((error) => {
  $("aiSettingsStatus").textContent = error.message;
  $("aiSettingsStatus").className = "notice error";
});
refreshApiKeys().catch(() => {});
window.AuraProxySettings?.bind?.();
window.AuraTopology?.bind?.();
updateReconModeUi();
updateApiKeyProviderHints();
applyTheme(getUiSettings().theme || "aura");
applyBackgroundEffect(getUiSettings().backgroundEffect || "random");
applyFontScale(getUiSettings().fontScale || 100);
