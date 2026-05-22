"use strict";

let targets = [];
let activeRunId = null;
let lastEventId = 0;
let poll = null;

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || "Request failed");
    error.errors = data.errors || null;
    throw error;
  }
  return data;
}

function selectedValues(ids) {
  return ids.filter((id) => $(id).checked);
}

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });
}

async function loadTargets() {
  const data = await api("/api/targets");
  targets = data.targets;
  $("target").innerHTML = targets.map((t) => `<option value="${esc(t.target_name)}">${esc(t.target_name)}</option>`).join("");
  if (targets.length === 0) {
    $("status").textContent = "No targets found. Create one with scripts/new-target.js first.";
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
  $("targetConfigEditor").value = JSON.stringify(data.config, null, 2);
  $("targetValidation").textContent = `Loaded ${data.configPath}`;
  $("targetValidation").className = "notice muted";
}

function formatTargetConfig() {
  try {
    const parsed = JSON.parse($("targetConfigEditor").value);
    $("targetConfigEditor").value = JSON.stringify(parsed, null, 2);
    $("targetValidation").textContent = "JSON is valid.";
    $("targetValidation").className = "notice ok";
  } catch (error) {
    $("targetValidation").textContent = error.message;
    $("targetValidation").className = "notice error";
  }
}

async function saveTargetConfig() {
  $("saveTargetConfig").disabled = true;
  $("status").textContent = "Saving target...";
  try {
    const config = JSON.parse($("targetConfigEditor").value);
    const data = await api(`/api/targets/${encodeURIComponent($("target").value)}/config`, {
      method: "PUT",
      body: JSON.stringify({ config })
    });
    $("targetValidation").textContent = `Saved ${data.configPath}`;
    $("targetValidation").className = "notice ok";
    $("status").textContent = "Target saved";
    await loadTargets();
  } catch (error) {
    $("targetValidation").textContent = error.errors ? error.errors.join("\n") : error.message;
    $("targetValidation").className = "notice error";
    $("status").textContent = error.message;
  } finally {
    $("saveTargetConfig").disabled = false;
  }
}

async function startRecon() {
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
$("formatTargetConfig").addEventListener("click", formatTargetConfig);
$("saveTargetConfig").addEventListener("click", saveTargetConfig);
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

loadTargets().catch((error) => {
  $("status").textContent = error.message;
});
updateReconModeUi();
