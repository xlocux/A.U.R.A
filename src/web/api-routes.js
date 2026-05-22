"use strict";

const fs = require("node:fs");
const { normalizeDomain } = require("../recon/domain-utils");
const { generateWordlistFromDb } = require("../recon/wordlist-generator");
const { checkWslEnvironment, installWslTools } = require("../recon/environment-setup");
const { callReverseWhois } = require("../recon/providers/whoisxmlapi");
const {
  DEFAULT_PASSIVE_SOURCES,
  DEFAULT_SCREENSHOT_TOOLS,
  DEFAULT_WSL_TOOLS,
  runRecon
} = require("../recon/recon-engine");
const { readJson, resolveTargetConfigPath, writeJson } = require("../core/io");
const { createDefaultTargetConfig, validateTargetConfig } = require("../core/target-config");
const { readBody, sendJson, sendNotFound } = require("./http-utils");
const { discoverTargets, inferRootDomains } = require("./target-service");

function runInBackground(task) {
  task().catch(() => {
    // Background tasks record their own run failure in the DB.
  });
}

async function handleApiRequest({ request, response, url, store }) {
  if (request.method === "GET" && url.pathname === "/api/targets") {
    const targets = discoverTargets(store).map((target) => ({
      ...target,
      root_domains: inferRootDomains(target)
    }));
    sendJson(response, { targets });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/targets") {
    await createTarget(request, response, store);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/recon-runs") {
    sendJson(response, { runs: store.listRuns(50) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/search") {
    searchSavedData(response, url, store);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/api-keys") {
    sendJson(response, { apiKeys: store.listApiKeys() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/wordlists") {
    sendJson(response, { wordlists: store.listWordlists() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/environment/check") {
    await checkEnvironment(response, url);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/api-keys") {
    await createApiKey(request, response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/wordlists") {
    await createWordlist(request, response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/wordlists/generate") {
    await generateWordlist(request, response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/environment/install") {
    await installEnvironment(request, response);
    return true;
  }

  const targetConfigMatch = url.pathname.match(/^\/api\/targets\/([^/]+)\/config$/);
  if (targetConfigMatch) {
    if (request.method === "GET") {
      getTargetConfig(response, store, decodeURIComponent(targetConfigMatch[1]));
      return true;
    }
    if (request.method === "PUT") {
      await updateTargetConfig(request, response, store, decodeURIComponent(targetConfigMatch[1]));
      return true;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/recon-runs") {
    await createReconRun(request, response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/asset-discovery/reverse-whois") {
    await runReverseWhois(request, response, store);
    return true;
  }

  if (request.method === "GET") {
    return handleReadEndpoint(response, url, store);
  }

  sendNotFound(response);
  return true;
}

async function createApiKey(request, response, store) {
  const body = await readBody(request);
  if (!body.provider || !body.label || !body.apiKey) {
    sendJson(response, { error: "provider, label, and apiKey are required" }, 400);
    return;
  }
  const apiKey = store.addApiKey({
    provider: String(body.provider).trim(),
    label: String(body.label).trim(),
    apiKey: String(body.apiKey).trim(),
    monthlyLimit: body.monthlyLimit === null || body.monthlyLimit === undefined ? null : Number(body.monthlyLimit),
    notes: body.notes || null
  });
  sendJson(response, { apiKey }, 201);
}

async function createWordlist(request, response, store) {
  const body = await readBody(request);
  if (!body.name || !body.category || !body.path) {
    sendJson(response, { error: "name, category, and path are required" }, 400);
    return;
  }
  const wordlist = store.addWordlist({
    name: String(body.name).trim(),
    category: String(body.category).trim(),
    path: String(body.path).trim(),
    status: body.status || "active",
    notes: body.notes || null
  });
  sendJson(response, { wordlist }, 201);
}

async function createTarget(request, response, store) {
  const body = await readBody(request);
  const built = buildTargetConfigFromRequest(body);
  if (built.error) {
    sendJson(response, { error: built.error }, 400);
    return;
  }
  const configPath = resolveTargetConfigPath(built.config.target_name);
  if (fs.existsSync(configPath)) {
    sendJson(response, { error: `Target already exists: ${built.config.target_name}` }, 409);
    return;
  }
  const errors = validateTargetConfig(built.config);
  if (errors.length > 0) {
    sendJson(response, { error: "Target config validation failed", errors }, 400);
    return;
  }
  writeJson(configPath, built.config);
  const target = store.upsertTarget(configPath, built.config);
  sendJson(response, { target, config: built.config, configPath }, 201);
}

async function checkEnvironment(response, url) {
  const distro = url.searchParams.get("distro") || "kali-linux";
  const result = await checkWslEnvironment({ distro });
  sendJson(response, { environment: result });
}

async function installEnvironment(request, response) {
  const body = await readBody(request);
  const result = await installWslTools({
    distro: body.distro || "kali-linux",
    toolIds: body.toolIds || null
  });
  sendJson(response, { environment: result });
}

function buildTargetConfigFromRequest(body) {
  const targetName = normalizeTargetName(body.targetName);
  if (!targetName) {
    return { error: "targetName is required and may only contain letters, numbers, dots, underscores, and dashes" };
  }
  const inScope = normalizeScopeLines(body.inScope || body.rootDomains || body.scope || []);
  if (inScope.length === 0) {
    return { error: "At least one in-scope domain, wildcard, or URL is required" };
  }
  const outOfScope = normalizeScopeLines(body.outOfScope || []);
  const config = createDefaultTargetConfig(targetName);
  config.asset_type = String(body.assetType || "webapp").trim();
  config.program_url = normalizeProgramUrl(body.programUrl, inScope);
  config.scope.in_scope = inScope;
  config.scope.out_of_scope = outOfScope;
  const notes = normalizeScopeLines(body.notes ? [body.notes] : []);
  if (notes.length > 0) config.recon.notes = notes;
  return { config };
}

function normalizeTargetName(value) {
  const targetName = String(value || "").trim();
  return /^[A-Za-z0-9._-]+$/.test(targetName) ? targetName : "";
}

function normalizeScopeLines(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return [...new Set(values.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

function normalizeProgramUrl(value, inScope) {
  const raw = String(value || "").trim();
  if (raw) return raw;
  const first = inScope[0] || "example.com";
  if (/^https?:\/\//i.test(first)) return first;
  return `https://${first.replace(/^\*\./, "")}`;
}

async function generateWordlist(request, response, store) {
  const body = await readBody(request);
  if (!body.category) {
    sendJson(response, { error: "category is required" }, 400);
    return;
  }
  const generated = generateWordlistFromDb(store, {
    targetName: body.targetName || null,
    category: String(body.category).trim(),
    name: body.name || null
  });
  const wordlist = store.addWordlist({
    name: generated.name,
    category: generated.category,
    path: generated.path,
    status: "active",
    notes: `Generated from DB (${generated.count} entries)`
  });
  sendJson(response, { wordlist, generated }, 201);
}

function getTargetConfig(response, store, targetName) {
  const configPath = resolveTargetConfigPath(targetName);
  if (!fs.existsSync(configPath)) {
    sendJson(response, { error: `Target config not found for ${targetName}` }, 404);
    return;
  }
  const config = readJson(configPath);
  store.upsertTarget(configPath, config);
  sendJson(response, { config, configPath });
}

function searchSavedData(response, url, store) {
  const query = url.searchParams.get("q") || "";
  const targetName = url.searchParams.get("target") || null;
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));
  if (!query.trim()) {
    sendJson(response, { results: [] });
    return;
  }
  sendJson(response, {
    query,
    results: store.searchAll({ query, targetName, limit })
  });
}

async function updateTargetConfig(request, response, store, targetName) {
  const body = await readBody(request);
  const config = body.config;
  const errors = validateTargetConfig(config);
  if (errors.length > 0) {
    sendJson(response, { error: "Target config validation failed", errors }, 400);
    return;
  }
  if (config.target_name !== targetName) {
    sendJson(response, { error: "target_name cannot be changed from this editor" }, 400);
    return;
  }
  const configPath = resolveTargetConfigPath(targetName);
  writeJson(configPath, config);
  const target = store.upsertTarget(configPath, config);
  sendJson(response, { target, config, configPath });
}

async function createReconRun(request, response, store) {
  const body = await readBody(request);
  if (!body.authorized) {
    sendJson(response, { error: "Authorization confirmation is required before recon" }, 400);
    return;
  }
  const targetConfigPath = resolveTargetConfigPath(body.targetName);
  const targetConfig = readJson(targetConfigPath);
  const target = store.upsertTarget(targetConfigPath, targetConfig);
  const reconMode = body.reconMode || "list";
  const rootDomains = normalizeDomainList(body.rootDomains || []);
  const modeError = validateReconMode(reconMode, rootDomains);
  if (modeError) {
    sendJson(response, { error: modeError }, 400);
    return;
  }
  if (rootDomains.length === 0) {
    sendJson(response, { error: "At least one valid root domain is required" }, 400);
    return;
  }
  const run = store.createRun({
    targetName: target.target_name,
    runType: reconMode === "full" ? "full-recon" : "recon",
    mode: reconMode,
    providerProfile: body.useWsl ? "wsl-kali" : "passive"
  });
  sendJson(response, { run }, 202);
  runInBackground(async () => {
    try {
      const domainWordlist = store.getActiveWordlist("domains");
      const rootsToScan = reconMode === "full"
        ? await expandFullReconRoots({ store, runId: run.id, targetName: target.target_name, rootDomains, fullRecon: body.fullRecon || {} })
        : rootDomains;
      await runRecon({
        store,
        runId: run.id,
        targetName: target.target_name,
        rootDomains: rootsToScan,
        passiveSources: body.passiveSources || DEFAULT_PASSIVE_SOURCES,
        wslTools: body.wslTools || DEFAULT_WSL_TOOLS,
        screenshotTools: body.screenshotTools || DEFAULT_SCREENSHOT_TOOLS,
        wslDistro: body.wslDistro || "kali-linux",
        useWsl: body.useWsl !== false,
        subdomainWordlistPath: body.subdomainWordlistPath || domainWordlist?.path || null,
        timeoutMs: Number(body.timeoutMs || 180000)
      });
    } catch (error) {
      store.appendEvent(run.id, {
        phase: "recon",
        severity: "error",
        source: "engine",
        message: error.message
      });
      store.updateRun(run.id, {
        status: "failed",
        activePhase: "failed",
        finishedAt: new Date().toISOString(),
        errorMessage: error.message
      });
    }
  });
}

function normalizeDomainList(values) {
  return [...new Set((values || []).map(normalizeDomain).filter(Boolean))];
}

function validateReconMode(mode, rootDomains) {
  if (!["single", "list", "full"].includes(mode)) {
    return "reconMode must be single, list, or full";
  }
  if (mode === "single" && rootDomains.length !== 1) {
    return "Single domain mode requires exactly one valid domain";
  }
  return null;
}

async function expandFullReconRoots({ store, runId, targetName, rootDomains, fullRecon }) {
  const include = (fullRecon.include || []).map((value) => String(value || "").trim()).filter(Boolean);
  const maxAssetLeads = Math.max(0, Math.min(5000, Number(fullRecon.maxAssetLeads || 250)));
  if (include.length === 0) {
    store.appendEvent(runId, {
      phase: "asset-discovery",
      severity: "warn",
      source: "engine",
      message: "Full recon asset discovery skipped: no Reverse WHOIS terms provided"
    });
    return rootDomains;
  }

  try {
    const selectedKey = store.getActiveApiKey("whoisxmlapi");
    const result = await callReverseWhois({
      apiKey: selectedKey?.api_key,
      include,
      exclude: fullRecon.exclude || [],
      mode: fullRecon.mode || "preview",
      searchType: fullRecon.searchType || "current"
    });
    if (selectedKey) store.markApiKeyUsed(selectedKey.id);
    const savedLeads = saveReverseWhoisResult(store, runId, targetName, result);
    const candidateDomains = result.mode === "purchase"
      ? normalizeDomainList(result.leads.map((lead) => lead.domain)).slice(0, maxAssetLeads)
      : [];
    store.appendEvent(runId, {
      phase: "asset-discovery",
      severity: "ok",
      source: "whoisxmlapi",
      message: `Full recon added ${candidateDomains.length} candidate domains to ${rootDomains.length} seeds (${savedLeads} leads saved)`
    });
    return [...new Set([...rootDomains, ...candidateDomains])];
  } catch (error) {
    store.recordAssetDiscoveryQuery(targetName, {
      runId,
      provider: "whoisxmlapi",
      queryType: "reverse-whois",
      mode: fullRecon.mode || "preview",
      includeTerms: fullRecon.include || [],
      excludeTerms: fullRecon.exclude || [],
      status: "failed",
      errorMessage: error.message
    });
    store.appendEvent(runId, {
      phase: "asset-discovery",
      severity: "warn",
      source: "whoisxmlapi",
      message: `Full recon continues without Reverse WHOIS: ${error.message}`
    });
    return rootDomains;
  }
}

async function runReverseWhois(request, response, store) {
  const body = await readBody(request);
  if (!body.authorized) {
    sendJson(response, { error: "Authorization confirmation is required before asset discovery" }, 400);
    return;
  }
  const targetConfigPath = resolveTargetConfigPath(body.targetName);
  const targetConfig = readJson(targetConfigPath);
  const target = store.upsertTarget(targetConfigPath, targetConfig);
  const run = store.createRun({
    targetName: target.target_name,
    runType: "asset-discovery",
    mode: "passive",
    providerProfile: "whoisxmlapi"
  });
  try {
    const selectedKey = store.getActiveApiKey("whoisxmlapi");
    const result = await callReverseWhois({
      apiKey: selectedKey?.api_key,
      include: body.include || [],
      exclude: body.exclude || [],
      mode: body.mode || "preview",
      searchType: body.searchType || "current"
    });
    if (selectedKey) store.markApiKeyUsed(selectedKey.id);
    const savedLeads = saveReverseWhoisResult(store, run.id, target.target_name, result);
    store.updateRun(run.id, {
      status: "completed",
      activePhase: "completed",
      finishedAt: new Date().toISOString(),
      checkpoint: { domainsCount: result.domainsCount, savedLeads }
    });
    sendJson(response, { run: store.getRun(run.id), summary: { domainsCount: result.domainsCount, savedLeads } });
  } catch (error) {
    recordReverseWhoisFailure(store, run.id, target.target_name, body, error);
    sendJson(response, { error: error.message }, 500);
  }
}

function saveReverseWhoisResult(store, runId, targetName, result) {
  const savedLeads = store.saveAssetLeads(runId, targetName, result.leads.map((lead) => ({
    leadType: "domain",
    value: lead.domain,
    source: lead.source,
    confidence: result.mode === "preview" ? "count-only" : lead.confidence,
    matchTerms: lead.matchTerms,
    metadata: lead.metadata
  })));
  store.recordAssetDiscoveryQuery(targetName, {
    runId,
    provider: "whoisxmlapi",
    queryType: "reverse-whois",
    mode: result.mode,
    includeTerms: result.include,
    excludeTerms: result.exclude,
    resultCount: result.domainsCount,
    nextPageToken: result.nextPageSearchAfter,
    status: "completed",
    raw: result.raw
  });
  store.appendEvent(runId, {
    phase: "asset-discovery",
    severity: "ok",
    source: "whoisxmlapi",
    message: `Reverse WHOIS ${result.mode} found ${result.domainsCount} matches and saved ${savedLeads} leads`
  });
  return savedLeads;
}

function recordReverseWhoisFailure(store, runId, targetName, body, error) {
  store.recordAssetDiscoveryQuery(targetName, {
    runId,
    provider: "whoisxmlapi",
    queryType: "reverse-whois",
    mode: body.mode || "preview",
    includeTerms: body.include || [],
    excludeTerms: body.exclude || [],
    status: "failed",
    errorMessage: error.message
  });
  store.updateRun(runId, {
    status: "failed",
    activePhase: "failed",
    finishedAt: new Date().toISOString(),
    errorMessage: error.message
  });
}

function handleReadEndpoint(response, url, store) {
  const runMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)$/);
  if (runMatch) {
    const run = store.getRun(Number(runMatch[1]));
    sendJson(response, run ? { run } : { error: "Run not found" }, run ? 200 : 404);
    return true;
  }

  const eventsMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/events$/);
  if (eventsMatch) {
    const after = Number(url.searchParams.get("after") || 0);
    sendJson(response, { events: store.listEvents(Number(eventsMatch[1]), after) });
    return true;
  }

  const domainsMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/domains$/);
  if (domainsMatch) {
    sendJson(response, { domains: store.listDomains({ runId: Number(domainsMatch[1]) }) });
    return true;
  }

  const leadsMatch = url.pathname.match(/^\/api\/targets\/([^/]+)\/asset-leads$/);
  if (leadsMatch) {
    sendJson(response, { leads: store.listAssetLeads({ targetName: decodeURIComponent(leadsMatch[1]) }) });
    return true;
  }

  const servicesMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/http-services$/);
  if (servicesMatch) {
    sendJson(response, { services: store.listHttpServices({ runId: Number(servicesMatch[1]) }) });
    return true;
  }

  const urlsMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/urls$/);
  if (urlsMatch) {
    sendJson(response, { urls: store.listUrls({ runId: Number(urlsMatch[1]) }) });
    return true;
  }

  const screenshotsMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/screenshots$/);
  if (screenshotsMatch) {
    sendJson(response, { screenshots: store.listScreenshots({ runId: Number(screenshotsMatch[1]) }) });
    return true;
  }

  return false;
}

module.exports = {
  buildTargetConfigFromRequest,
  handleApiRequest
};
