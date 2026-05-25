"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeDomain, rootForDomain } = require("../recon/domain-utils");
const { CORRELATION_TECHNIQUES, runCandidateCorrelation } = require("../recon/candidate-correlation");
const { buildResultTree } = require("../recon/result-tree");
const { GENERATED_DIR, generateWordlistFromDb } = require("../recon/wordlist-generator");
const { checkWslEnvironment, createEnvironmentRunner, installWslTools } = require("../recon/environment-setup");
const { suggestReverseWhoisTerms } = require("../recon/providers/rdap-suggestions");
const { callReverseWhois } = require("../recon/providers/whoisxmlapi");
const { callWhoisFreaksHistorical } = require("../recon/providers/whoisfreaks");
const { classifyApiFailure, providerCatalog, validateProviderKey } = require("../recon/provider-apis");
const {
  DEFAULT_PASSIVE_SOURCES,
  DEFAULT_SCREENSHOT_TOOLS,
  DEFAULT_WSL_TOOLS,
  isRunControlError,
  runFocusedFollowup,
  runHttpFollowup,
  runRecon
} = require("../recon/recon-engine");
const { normalizeProxyUrl } = require("../recon/wsl-tools");
const { readJson, resolveTargetConfigPath, writeJson } = require("../core/io");
const { createDefaultTargetConfig, validateTargetConfig } = require("../core/target-config");
const { readBody, sendFile, sendJson, sendNotFound } = require("./http-utils");
const proxyRoutes = require("./proxy-routes");
const { discoverTargets, inferRootDomains } = require("./target-service");

const DEFAULT_WORDLISTS = [
  {
    name: "SecLists DNS Top 5K",
    category: "domains",
    path: "/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt",
    notes: "Default Kali/SecLists DNS discovery wordlist"
  },
  {
    name: "SecLists Web Common",
    category: "paths",
    path: "/usr/share/seclists/Discovery/Web-Content/common.txt",
    notes: "Default Kali/SecLists web content wordlist"
  },
  {
    name: "SecLists RAFT Small Words",
    category: "paths",
    path: "/usr/share/seclists/Discovery/Web-Content/raft-small-words.txt",
    notes: "Default Kali/SecLists compact content discovery wordlist"
  }
];
const DEFAULT_ALTERNATE_TLDS = [
  "com",
  "net",
  "org",
  "info",
  "biz",
  "io",
  "co",
  "app",
  "dev",
  "cloud",
  "ai",
  "tech",
  "site",
  "online",
  "store",
  "shop",
  "me",
  "tv",
  "xyz",
  "security",
  "it",
  "uk",
  "us",
  "ca",
  "au",
  "de",
  "fr",
  "es",
  "nl",
  "ch",
  "se",
  "no",
  "dk",
  "fi",
  "pl",
  "br",
  "mx",
  "in",
  "jp",
  "kr",
  "cn"
];

function runInBackground(task) {
  task().catch(() => {
    // Background tasks record their own run failure in the DB.
  });
}

async function handleApiRequest({ request, response, url, store }) {
  if (url.pathname.startsWith("/api/proxies")) {
    return proxyRoutes.handleApiRequest({ request, response, url, store });
  }

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
    sendJson(response, { apiKeys: store.listApiKeys(), providers: providerCatalog() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/api-keys/export") {
    exportApiKeys(response, store);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/ai-settings") {
    sendJson(response, { settings: store.getAiSettings(), models: await listOpenRouterFreeModels() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/ai-runtime/status") {
    await getAiRuntimeStatus(response, url);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/wordlists") {
    ensureDefaultWordlists(store);
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

  if (request.method === "POST" && url.pathname === "/api/api-keys/preflight-all") {
    await preflightAllApiKeys(response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/api-keys/import") {
    await importApiKeys(request, response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/ai-settings") {
    await saveAiSettings(request, response, store);
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

  const wordlistMatch = url.pathname.match(/^\/api\/wordlists\/(\d+)\/(preview|download)$/);
  if (wordlistMatch && request.method === "GET") {
    serveWordlistArtifact(response, store, Number(wordlistMatch[1]), wordlistMatch[2]);
    return true;
  }

  const deleteWordlistMatch = url.pathname.match(/^\/api\/wordlists\/(\d+)$/);
  if (deleteWordlistMatch && request.method === "DELETE") {
    deleteWordlist(response, store, Number(deleteWordlistMatch[1]));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/environment/install") {
    await installEnvironment(request, response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/chat") {
    await agentChat(request, response, store);
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

  const targetMatch = url.pathname.match(/^\/api\/targets\/([^/]+)$/);
  if (targetMatch && request.method === "DELETE") {
    deleteTarget(response, store, decodeURIComponent(targetMatch[1]));
    return true;
  }

  const apiKeyMatch = url.pathname.match(/^\/api\/api-keys\/(\d+)$/);
  if (apiKeyMatch && request.method === "DELETE") {
    deleteApiKey(response, store, Number(apiKeyMatch[1]));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/recon-runs") {
    await createReconRun(request, response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/asset-discovery/reverse-whois") {
    await runReverseWhois(request, response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/recon/provider-discovery") {
    await runReverseWhois(request, response, store);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/recon/whois-term-suggestions") {
    await suggestWhoisTerms(request, response, store);
    return true;
  }

  const runActionMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/(pause|resume|cancel)$/);
  if (runActionMatch && request.method === "POST") {
    updateRunControl(response, store, Number(runActionMatch[1]), runActionMatch[2]);
    return true;
  }

  const httpFollowupMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/follow-up\/http$/);
  if (httpFollowupMatch && request.method === "POST") {
    await createHttpFollowupRun(request, response, store, Number(httpFollowupMatch[1]));
    return true;
  }

  const focusedFollowupMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/follow-up\/(urls|http-only|tech|screenshots|trackers|favicons)$/);
  if (focusedFollowupMatch && request.method === "POST") {
    await createFocusedFollowupRun(request, response, store, Number(focusedFollowupMatch[1]), focusedFollowupMatch[2]);
    return true;
  }

  const tldDiscoveryMatch = url.pathname.match(/^\/api\/v1\/runs\/(\d+)\/phases\/domain_intelligence\/tld-discovery$/);
  if (tldDiscoveryMatch && request.method === "POST") {
    await runTldDiscoveryPhase(request, response, store, Number(tldDiscoveryMatch[1]));
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
  const provider = String(body.provider).trim();
  const preflight = await validateProviderKey(provider, String(body.apiKey).trim());
  const status = preflight.ok ? "active" : preflight.status || "failed";
  const apiKey = store.addApiKey({
    provider,
    label: String(body.label).trim(),
    apiKey: String(body.apiKey).trim(),
    status,
    monthlyLimit: body.monthlyLimit === null || body.monthlyLimit === undefined ? null : Number(body.monthlyLimit),
    notes: preflight.message
  });
  sendJson(response, { apiKey, preflight, alert: apiKeyAlert(apiKey, preflight) }, preflight.ok ? 201 : 202);
}

async function runTldDiscoveryPhase(request, response, store, runId) {
  const run = store.getRun(runId);
  if (!run) {
    sendJson(response, { error: "run not found" }, 404);
    return;
  }
  const body = await readBody(request);
  const target = store.getTarget(run.target_name);
  if (!target) {
    sendJson(response, { error: "target not found for run" }, 404);
    return;
  }
  const rootDomains = normalizeDomainList(body.root_domains || body.rootDomains || inferRootDomains(target));
  const label = String(body.registrable_label || body.registrableLabel || "").trim().toLowerCase();
  const strategies = Array.isArray(body.strategies) && body.strategies.length
    ? body.strategies
    : ["certificate_transparency", "dns_validation"];
  const syntheticRoots = label && /^[a-z0-9-]{3,63}$/.test(label)
    ? [`${label}.com`]
    : rootDomains;
  const candidates = generateAlternateTldLeads({ rootDomains: syntheticRoots, config: target })
    .map((lead) => ({
      ...lead,
      leadType: "domain_tld_candidate",
      metadata: {
        ...(lead.metadata || {}),
        observationType: "domain_tld_candidate",
        correlationSettings: {
          enabled: body.correlation_engine_enabled !== false,
          autoPromotionEnabled: body.auto_promotion_enabled !== false,
          reviewThreshold: Number(body.confidence_threshold_for_review || 60)
        }
      }
    }));
  if (candidates.length > 0) store.saveAssetLeads(runId, target.target_name, candidates);
  const scored = body.correlation_engine_enabled === false ? candidates : runCandidateCorrelation({
    store,
    runId,
    targetName: target.target_name,
    rootDomains,
    leads: candidates,
    config: target,
    autoPromote: body.auto_promotion_enabled !== false
  });
  const jobsQueued = strategies.map((strategy) => store.createJob({
    runId,
    targetName: target.target_name,
    phase: "domain_intelligence",
    type: "tld_discovery",
    toolId: `tld_discovery_${strategy}`,
    priority: 80,
    maxAttempts: 1,
    payload: {
      target_name: body.target_name || target.target_name,
      registrable_label: label || null,
      strategy,
      correlation_engine_enabled: body.correlation_engine_enabled !== false,
      auto_promotion_enabled: body.auto_promotion_enabled !== false,
      correlation_sources: body.correlation_sources || [
        "whois_data",
        "dns_records",
        "ip_addresses",
        "favicon_hashes",
        "nameserver_records",
        "certificate_sans",
        "rdap_records",
        "cidr_blocks"
      ],
      confidence_threshold_for_review: Number(body.confidence_threshold_for_review || 60)
    }
  }));
  store.appendEvent(runId, {
    phase: "domain_intelligence",
    severity: "ok",
    source: "tld-correlation",
    message: `TLD discovery correlation evaluated ${candidates.length} candidates; ${jobsQueued.length} strategy jobs queued for evidence collection.`,
    payload: {
      candidates: candidates.length,
      jobsQueued: jobsQueued.map((job) => job.id),
      autoPromotionEnabled: body.auto_promotion_enabled !== false
    }
  });
  sendJson(response, {
    jobs_queued: jobsQueued.map((job) => ({ job_id: String(job.id), tool_id: job.tool_id, status: job.status })),
    correlation_settings: {
      enabled: body.correlation_engine_enabled !== false,
      auto_promotion_threshold: 100,
      review_threshold: Number(body.confidence_threshold_for_review || 60)
    },
    candidates_evaluated: scored.length,
    correlation_results: scored.map((lead) => ({
      value: lead.value,
      status: lead.status,
      confidence: lead.confidence,
      correlation_engine_result: lead.metadata?.correlationEngineResult || null
    }))
  });
}


function exportApiKeys(response, store) {
  const exportedAt = new Date().toISOString();
  const apiKeys = store.listApiKeys({ includeSecret: true }).map((key) => ({
    provider: key.provider,
    label: key.label,
    apiKey: key.api_key,
    monthlyLimit: key.monthly_limit,
    status: key.status,
    notes: key.notes
  }));
  response.writeHead(200, exportHeaders("application/json; charset=utf-8", `aura-api-keys-sensitive-${exportedAt.slice(0, 10)}.json`));
  response.end(JSON.stringify({ exportedAt, format: "aura-api-keys-v1", apiKeys }, null, 2));
}

async function importApiKeys(request, response, store) {
  const body = await readBody(request);
  const rows = Array.isArray(body.apiKeys) ? body.apiKeys : Array.isArray(body) ? body : [];
  const preflightEnabled = body.preflight !== false;
  const results = [];
  for (const row of rows) {
    const provider = String(row.provider || "").trim();
    const label = String(row.label || "imported").trim();
    const secret = String(row.apiKey || row.api_key || "").trim();
    if (!provider || !label || !secret) {
      results.push({ provider, label, status: "skipped", message: "provider, label, and apiKey are required" });
      continue;
    }
    const preflight = preflightEnabled
      ? await validateProviderKey(provider, secret)
      : { ok: true, message: "Imported without preflight." };
    const status = preflight.ok ? "active" : preflight.status || "failed";
    const apiKey = store.addApiKey({
      provider,
      label,
      apiKey: secret,
      status,
      monthlyLimit: row.monthlyLimit ?? row.monthly_limit ?? null,
      notes: preflight.message
    });
    results.push({ id: apiKey.id, provider, label, status: apiKey.status, preflight, alert: apiKeyAlert(apiKey, preflight) });
  }
  sendJson(response, { imported: results.filter((item) => item.status !== "skipped").length, results, apiKeys: store.listApiKeys() });
}

async function preflightAllApiKeys(response, store) {
  const keys = store.listApiKeys({ includeSecret: true });
  const results = [];
  for (const key of keys) {
    const preflight = await validateProviderKey(key.provider, key.api_key);
    const status = preflight.ok ? "active" : preflight.status || "failed";
    store.updateApiKeyStatus(key.id, status);
    results.push({
      id: key.id,
      provider: key.provider,
      label: key.label,
      status,
      preflight,
      alert: apiKeyAlert({ ...key, status }, preflight)
    });
  }
  sendJson(response, { results, apiKeys: store.listApiKeys(), alerts: results.map((item) => item.alert).filter(Boolean) });
}

function apiKeyAlert(apiKey, preflight = {}) {
  if (!apiKey || !["exhausted", "failed"].includes(apiKey.status)) return null;
  if (apiKey.status === "failed" && preflight.status !== "exhausted") return null;
  return {
    provider: apiKey.provider,
    label: apiKey.label,
    status: apiKey.status,
    message: preflight.action || "Replace this API key, upgrade/enable the provider plan, or disable this provider for recon."
  };
}

function deleteApiKey(response, store, id) {
  const deleted = store.deleteApiKey(id);
  sendJson(response, deleted ? { deleted: true, id } : { error: "API key not found" }, deleted ? 200 : 404);
}

async function saveAiSettings(request, response, store) {
  const body = await readBody(request);
  const settings = store.saveAiSettings({
    provider: normalizeAiProvider(body.provider),
    planningModel: String(body.planningModel || "").trim(),
    executionModel: String(body.executionModel || "").trim(),
    localEndpoint: String(body.localEndpoint || "").trim(),
    localModel: String(body.localModel || "").trim(),
    autonomyLevel: Math.max(0, Math.min(4, Number(body.autonomyLevel || 1)))
  });
  sendJson(response, { settings });
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
  const proxy = parseOptionalProxy(response, body.proxyUrl);
  if (proxy === false) return;
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
  const bootstrapRun = startTargetBootstrap({
    store,
    target,
    config: built.config,
    authorized: Boolean(body.authorized),
    wslDistro: body.wslDistro || "kali-linux",
    timeoutMs: Number(body.timeoutMs || 180000),
    proxyUrl: proxy
  });
  sendJson(response, { target, config: built.config, configPath, bootstrapRun }, 201);
}

async function checkEnvironment(response, url) {
  const distro = url.searchParams.get("distro") || "kali-linux";
  const result = await checkWslEnvironment({ distro });
  sendJson(response, { environment: result });
}

async function installEnvironment(request, response, store) {
  const body = await readBody(request);
  const result = await installWslTools({
    distro: body.distro || "kali-linux",
    toolIds: body.toolIds || null
  });
  const wordlists = ensureDefaultWordlists(store);
  sendJson(response, { environment: result, wordlists });
}

function ensureDefaultWordlists(store) {
  return DEFAULT_WORDLISTS.map((wordlist) => store.addWordlist({
    ...wordlist,
    status: "active"
  }));
}

function startTargetBootstrap({ store, target, config, authorized, wslDistro, timeoutMs, proxyUrl = null }) {
  ensureDefaultWordlists(store);
  const rootDomains = inferRootDomains(target);
  const run = store.createRun({
    targetName: target.target_name,
    runType: "target-bootstrap",
    mode: authorized ? "bootstrap-authorized" : "bootstrap-passive",
    providerProfile: "automatic-bootstrap",
    checkpoint: { rootDomains, authorized }
  });
  runInBackground(async () => {
    try {
      await bootstrapTargetRecon({ store, runId: run.id, target, config, rootDomains, authorized, wslDistro, timeoutMs, proxyUrl });
    } catch (error) {
      if (isRunControlError(error)) {
        store.appendEvent(run.id, {
          phase: "control",
          severity: "warn",
          source: "engine",
          message: error.message
        });
        return;
      }
      store.appendEvent(run.id, {
        phase: "bootstrap",
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
  return run;
}

function deleteTarget(response, store, targetName) {
  const target = store.getTarget(targetName);
  if (!target) {
    sendJson(response, { error: `Target not found: ${targetName}` }, 404);
    return;
  }
  const removed = store.deleteTarget(targetName);
  removeTargetFiles(targetName, target.config_path, removed.runIds);
  sendJson(response, { deleted: true, targetName, runIds: removed.runIds });
}

function updateRunControl(response, store, runId, action) {
  const run = store.getRun(runId);
  if (!run) {
    sendJson(response, { error: "Run not found" }, 404);
    return;
  }
  const terminal = new Set(["completed", "failed", "cancelled"]);
  if (terminal.has(run.status) && action !== "cancel") {
    sendJson(response, { error: `Run is already ${run.status}` }, 409);
    return;
  }
  if (action === "pause") {
    if (run.status !== "running" && run.status !== "queued") {
      sendJson(response, { error: `Run cannot be paused from ${run.status}` }, 409);
      return;
    }
    const updated = store.updateRun(runId, { status: "paused", activePhase: run.active_phase || "paused" });
    store.appendEvent(runId, { phase: "control", severity: "warn", source: "user", message: "Run pause requested." });
    sendJson(response, { run: updated });
    return;
  }
  if (action === "resume") {
    if (run.status !== "paused") {
      sendJson(response, { error: `Run cannot be resumed from ${run.status}` }, 409);
      return;
    }
    const updated = store.updateRun(runId, { status: "running", activePhase: run.active_phase || "recon" });
    store.appendEvent(runId, { phase: "control", severity: "ok", source: "user", message: "Run resume requested." });
    sendJson(response, { run: updated });
    return;
  }
  if (action === "cancel") {
    const updated = store.updateRun(runId, {
      status: "cancelled",
      activePhase: "cancelled",
      finishedAt: new Date().toISOString(),
      errorMessage: null
    });
    store.appendEvent(runId, { phase: "control", severity: "warn", source: "user", message: "Run cancel requested." });
    sendJson(response, { run: updated });
  }
}

async function waitForApiRunControl(store, runId) {
  let run = store.getRun(runId);
  if (!run) throw new Error("Run no longer exists");
  if (run.status === "cancelled") {
    throw createRunControlError("Run cancelled by user");
  }
  if (run.status !== "paused") return;

  store.appendEvent(runId, {
    phase: "control",
    severity: "warn",
    source: "engine",
    message: "Bootstrap paused. Waiting for resume or cancel."
  });
  while (run?.status === "paused") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    run = store.getRun(runId);
    if (!run || run.status === "cancelled") {
      throw createRunControlError("Run cancelled by user");
    }
  }
}

function createRunControlError(message) {
  const error = new Error(message);
  error.name = "RunControlError";
  return error;
}

function removeTargetFiles(targetName, configPath, runIds = []) {
  const targetsRoot = pathResolveSafe("targets");
  const targetDir = pathResolveSafe(configPath ? path.dirname(configPath) : `targets/${targetName}`);
  if (isInsidePath(targetDir, targetsRoot)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  const runsRoot = pathResolveSafe("data/recon-runs");
  for (const runId of runIds) {
    fs.rmSync(pathResolveSafe(runsRoot, String(runId)), { recursive: true, force: true });
  }
}

function pathResolveSafe(...segments) {
  return path.resolve(...segments);
}

function parseOptionalProxy(response, value) {
  try {
    return normalizeProxyUrl(value);
  } catch (error) {
    sendJson(response, { error: error.message }, 400);
    return false;
  }
}

function isInsidePath(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function bootstrapTargetRecon({ store, runId, target, config, rootDomains, authorized, wslDistro, timeoutMs, proxyUrl = null }) {
  store.updateRun(runId, {
    status: "running",
    activePhase: "whois-rdap",
    checkpoint: { rootDomains, authorized }
  });
  store.appendEvent(runId, {
    phase: "bootstrap",
    severity: "ok",
    source: "engine",
    message: `Target saved. Starting RDAP/WHOIS bootstrap for ${rootDomains.join(", ")}`
  });

  await waitForApiRunControl(store, runId);
  let suggestions = await suggestReverseWhoisTerms({ domains: rootDomains });
  suggestions = await enrichWhoisSuggestionsWithHistory({ store, runId, domains: rootDomains, suggestions });
  const brandTerms = extractBrandTerms(rootDomains);
  const reverseWhoisTerms = [...new Set([...(suggestions.includeTerms || []), ...brandTerms])];
  const suggestionSummary = formatWhoisSuggestionSummary(suggestions);
  const hasUsefulWhoisPivots = reverseWhoisTerms.length > 0 || suggestions.associatedDomains.length > 0;
  store.appendEvent(runId, {
    phase: "whois-rdap",
    severity: hasUsefulWhoisPivots ? "ok" : "warn",
    source: "rdap",
    message: hasUsefulWhoisPivots
      ? `Intel phase prepared WHOIS pivots: ${formatWhoisSuggestionSummary({ ...suggestions, includeTerms: reverseWhoisTerms })}`
      : suggestions.rationale
  });
  const rdapDomains = filterScopeDomains({
    domains: extractRdapRelatedDomains(suggestions),
    config,
    rootDomains
  });
  if (rdapDomains.length > 0) {
    saveBootstrapDomains({ store, runId, targetName: target.target_name, domains: rdapDomains, roots: rootDomains, source: "rdap-associated-domain" });
    store.appendEvent(runId, {
      phase: "whois-rdap",
      severity: "ok",
      source: "rdap",
      message: `RDAP associated domains proposed for enumeration: ${rdapDomains.join(", ")}`
    });
  }

  const alternateTldLeads = generateAlternateTldLeads({ rootDomains, config });
  const alternateTldDomains = alternateTldLeads.map((lead) => lead.value);
  let correlationInputs = [...alternateTldLeads];
  if (alternateTldLeads.length > 0) {
    const saved = store.saveAssetLeads(runId, target.target_name, alternateTldLeads);
    store.appendEvent(runId, {
      phase: "bootstrap",
      severity: "ok",
      source: "tld-correlation",
      message: `Saved ${saved} alternate TLD candidates for review only: ${alternateTldDomains.join(", ")}`
    });
  }

  if (rdapDomains.length === 0 && alternateTldLeads.length === 0 && !hasUsefulWhoisPivots) {
    store.appendEvent(runId, {
      phase: "whois-rdap",
      severity: "warn",
      source: "rdap",
      message: "No target-related WHOIS/RDAP pivots or alternate TLD candidates were found."
    });
  }

  let providerDomains = [];
  if (reverseWhoisTerms.length > 0) {
    await waitForApiRunControl(store, runId);
    providerDomains = await collectReverseWhoisDomains({
      store,
      runId,
      targetName: target.target_name,
      config,
      rootDomains,
      suggestions: { ...suggestions, includeTerms: reverseWhoisTerms }
    });
    correlationInputs = correlationInputs.concat(store.listAssetLeads({ targetName: target.target_name })
      .filter((lead) => lead.run_id === runId && lead.source === "whoisxmlapi"));
  }

  runCandidateCorrelation({
    store,
    runId,
    targetName: target.target_name,
    rootDomains,
    leads: correlationInputs,
    config
  });

  const seeds = filterScopeDomains({
    domains: [...rootDomains, ...rdapDomains, ...providerDomains],
    config,
    rootDomains
  });
  store.appendEvent(runId, {
    phase: "bootstrap",
    severity: "ok",
    source: "engine",
    message: `Intel bootstrap prepared ${seeds.length} authorized domain seeds after WHOIS/RDAP, Reverse WHOIS, and scope filtering. Alternate TLDs remain review leads.`
  });

  if (!authorized) {
    store.appendEvent(runId, {
      phase: "bootstrap",
      severity: "warn",
      source: "engine",
      message: "Enumeration was not started because authorized scope was not confirmed. Intel candidates were saved for review."
    });
    store.updateRun(runId, {
      status: "completed",
      activePhase: "authorization-required",
      finishedAt: new Date().toISOString(),
      checkpoint: { rootDomains, seeds, reviewOnlyAlternateTlds: alternateTldDomains, authorized: false }
    });
    return;
  }

  const domainWordlist = store.getActiveWordlist("domains");
  await waitForApiRunControl(store, runId);
  await runRecon({
    store,
    runId,
    targetName: target.target_name,
    rootDomains: seeds,
    passiveSources: DEFAULT_PASSIVE_SOURCES,
    wslTools: DEFAULT_WSL_TOOLS,
    screenshotTools: DEFAULT_SCREENSHOT_TOOLS,
    wslDistro,
    useWsl: true,
    subdomainWordlistPath: domainWordlist?.path || null,
    timeoutMs,
    proxyUrl
  });
}

function formatWhoisSuggestionSummary(suggestions) {
  const parts = [];
  if (suggestions.includeTerms?.length) parts.push(`terms: ${suggestions.includeTerms.join(", ")}`);
  if (suggestions.associatedDomains?.length) parts.push(`associated domains: ${suggestions.associatedDomains.join(", ")}`);
  return parts.join("; ") || "none";
}

async function collectReverseWhoisDomains({ store, runId, targetName, config, rootDomains, suggestions }) {
  const selectedKey = store.getActiveApiKey("whoisxmlapi");
  if (!selectedKey?.api_key) {
    store.appendEvent(runId, {
      phase: "whois-rdap",
      severity: "warn",
      source: "whoisxmlapi",
      message: "Reverse WHOIS domain expansion skipped: no active WhoisXMLAPI key is configured."
    });
    return [];
  }
  try {
    const result = await callReverseWhois({
      apiKey: selectedKey.api_key,
      include: suggestions.includeTerms,
      exclude: suggestions.excludeTerms,
      mode: "purchase",
      searchType: "current"
    });
    store.markApiKeyUsed(selectedKey.id);
    const savedLeads = saveReverseWhoisResult(store, runId, targetName, result);
    const domains = filterScopeDomains({
      domains: result.leads.map((lead) => lead.domain),
      config,
      rootDomains
    });
    saveBootstrapDomains({ store, runId, targetName, domains, roots: rootDomains, source: "whoisxmlapi-reverse-whois" });
    store.appendEvent(runId, {
      phase: "whois-rdap",
      severity: "ok",
      source: "whoisxmlapi",
      message: `Reverse WHOIS saved ${savedLeads} leads and added ${domains.length} authorized seeds`
    });
    return domains;
  } catch (error) {
    store.appendEvent(runId, {
      phase: "whois-rdap",
      severity: "warn",
      source: "whoisxmlapi",
      message: `Reverse WHOIS expansion skipped: ${error.message}`
    });
    return [];
  }
}

function extractRdapRelatedDomains(suggestions) {
  return suggestions.associatedDomains || [];
}

function extractBrandTerms(rootDomains) {
  const terms = new Set();
  const secondLevelTlds = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);
  for (const root of rootDomains.map(normalizeDomain).filter(Boolean)) {
    const labels = root.split(".");
    const isCountrySecondLevel = labels.length > 2 && labels.at(-1).length === 2 && secondLevelTlds.has(labels.at(-2));
    const brand = isCountrySecondLevel ? labels.at(-3) : labels.length > 1 ? labels.at(-2) : labels[0];
    if (/^[a-z0-9][a-z0-9-]{2,62}$/.test(brand)) terms.add(brand);
  }
  return [...terms];
}

function filterScopeDomains({ domains, config, rootDomains }) {
  const excluded = (config.scope?.out_of_scope || []).map(normalizeDomain).filter(Boolean);
  const roots = (rootDomains || []).map(normalizeDomain).filter(Boolean);
  return [...new Set((domains || []).map(normalizeDomain).filter(Boolean))]
    .filter((domain) => !excluded.some((rule) => domain === rule || domain.endsWith(`.${rule}`)))
    .filter((domain) => roots.length === 0 || roots.some((root) => domain === root || domain.endsWith(`.${root}`)));
}

function generateAlternateTldLeads({ rootDomains, config }) {
  const excluded = (config.scope?.out_of_scope || []).map(normalizeDomain).filter(Boolean);
  const roots = new Set(rootDomains.map(normalizeDomain).filter(Boolean));
  const leads = new Map();
  for (const root of roots) {
    const labels = root.split(".");
    if (labels.length < 2) continue;
    const brand = extractBrandTerms([root])[0];
    if (!/^[a-z0-9-]{3,63}$/.test(brand)) continue;
    for (const tld of DEFAULT_ALTERNATE_TLDS) {
      const candidate = normalizeDomain(`${brand}.${tld}`);
      if (!candidate || roots.has(candidate)) continue;
      if (excluded.some((rule) => candidate === rule || candidate.endsWith(`.${rule}`))) continue;
      leads.set(candidate, {
        leadType: "domain_candidate",
        value: candidate,
        source: "alternate-tld-correlation",
        confidence: "candidate",
        matchTerms: [brand],
        metadata: {
          rootDomain: root,
          reason: "Same registrable label on an alternate TLD. Review scope before scanning."
        }
      });
    }
  }
  return [...leads.values()].slice(0, 50);
}

function saveBootstrapDomains({ store, runId, targetName, domains, roots, source }) {
  if (!domains.length) return 0;
  return store.saveDomains(runId, targetName, domains.map((domain) => ({
    domain,
    rootDomain: rootForDomain(domain, roots) || domain,
    kind: roots.includes(domain) ? "root" : "associated",
    source,
    metadata: { runId }
  })));
}

async function agentChat(request, response, store) {
  const body = await readBody(request);
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    sendJson(response, { message: "Ask me what you want to do next." });
    return;
  }
  const contextualPrompt = buildAgentPromptWithContext({ prompt, body, store });
  const settings = store.getAiSettings();
  if (settings.provider === "openrouter") {
    sendJson(response, { message: await callOpenRouterAgent({ prompt: contextualPrompt, settings, store }) });
    return;
  }
  if (settings.provider === "local") {
    sendJson(response, { message: await callLocalAgent({ prompt: contextualPrompt, settings }) });
    return;
  }
  if (settings.provider === "codex" || settings.provider === "claude") {
    sendJson(response, { message: await callCliAgent({ prompt: contextualPrompt, provider: settings.provider, distro: body.distro || "kali-linux" }) });
    return;
  }
  const runner = createEnvironmentRunner({ distro: body.distro || "kali-linux" });
  const check = await runner.run("export PATH=\"$HOME/.opencode/bin:$HOME/.local/bin:$HOME/go/bin:$PATH\" && command -v opencode", 15000);
  if (check.status === "completed") {
    const safePrompt = [
      "You are A.U.R.A's local assistant. Answer concisely. Help with setup, tools, recon workflow, and UI usage. Do not suggest unsafe or out-of-scope activity.",
      "",
      contextualPrompt
    ].join("\n");
    const result = await runner.run(`export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/go/bin:$PATH" && opencode run ${shellQuote(safePrompt)}`, 120000);
    if (result.status === "completed" && result.stdout) {
      sendJson(response, { message: result.stdout });
      return;
    }
    sendJson(response, { message: `OpenCode is installed but did not complete the request.\n${result.stderr || result.errorMessage || "Check model/provider configuration in OpenCode."}` });
    return;
  }
  sendJson(response, { message: setupHelpMessage(prompt) });
}

function buildAgentPromptWithContext({ prompt, body, store }) {
  const runId = Number(body.runId || 0);
  const targetName = String(body.targetName || "").trim();
  const run = runId ? store.getRun(runId) : targetName ? store.getLatestRunForTarget(targetName) : null;
  const events = run ? store.listEvents(run.id, 0, 20) : [];
  const tools = run ? store.listToolResults({ runId: run.id, limit: 10 }) : [];
  const domains = run ? store.listDomains({ runId: run.id, limit: 10 }) : [];
  const counts = run ? store.getRunObservationCounts(run.id) : null;
  const technologies = run ? store.listTechnologySummary({ runId: run.id, limit: 10 }) : [];
  const screenshots = run ? store.listScreenshots({ runId: run.id }) : [];
  const latestEvent = events.at(-1);
  const conversation = Array.isArray(body.conversation) ? body.conversation.slice(-12) : [];
  return [
    "Answer in English. Use only the A.U.R.A context below for target-specific facts. If data is missing, say so clearly.",
    "Explain current activity with concrete run IDs, phases, events, and tools.",
    "Use the recent chat history for continuity. Do not repeat automatic log-style insights unless the user asks for logs.",
    "",
    "A.U.R.A context:",
    run ? `- Current run: ${run.id} target=${run.target_name} status=${run.status} phase=${run.active_phase || "-"}` : "- Current run: none loaded",
    counts ? `- Run totals: domains=${counts.domains} urls=${counts.urls} services=${counts.httpServices} technologies=${counts.technologies} screenshots=${counts.screenshots}` : "- Run totals: none",
    latestEvent ? `- Latest event: ${latestEvent.created_at} ${latestEvent.source || "system"}: ${latestEvent.message}` : "- Latest event: none",
    tools.length ? `- Recent tool results: ${tools.map((tool) => `${tool.toolName}:${tool.status}`).join(", ")}` : "- Recent tool results: none",
    domains.length ? `- Sample domains: ${domains.map((domain) => domain.domain).join(", ")}` : "- Sample domains: none",
    technologies.length ? `- Technologies: ${technologies.map((tech) => `${tech.name}(${tech.count})`).join(", ")}` : "- Technologies: none",
    screenshots.length ? `- Screenshot runs: ${screenshots.map((shot) => `${shot.tool_name}:${shot.metadata?.screenshotCount ?? 0}`).join(", ")}` : "- Screenshot runs: none",
    conversation.length ? `- Recent chat:\n${formatConversationForPrompt(conversation)}` : "- Recent chat: none",
    "",
    "User question:",
    prompt
  ].join("\n");
}

function formatConversationForPrompt(conversation) {
  return conversation
    .map((message) => `  ${message.role === "user" ? "user" : "assistant"}: ${String(message.content || "").replace(/\s+/g, " ").slice(0, 1000)}`)
    .join("\n");
}

async function getAiRuntimeStatus(response, url) {
  const distro = url.searchParams.get("distro") || "kali-linux";
  const runner = createEnvironmentRunner({ distro });
  const [opencode, codex, claude] = await Promise.all([
    inspectCliRuntime({ runner, id: "opencode", binary: "opencode", versionArgs: "--version" }),
    inspectCliRuntime({ runner, id: "codex", binary: "codex", versionArgs: "--version" }),
    inspectCliRuntime({ runner, id: "claude", binary: "claude", versionArgs: "--version" })
  ]);
  const opencodeConfig = await inspectOpenCodeConfig(runner);
  sendJson(response, {
    distro,
    mode: runner.mode,
    runtimes: { opencode, codex, claude },
    opencodeConfig
  });
}

async function inspectCliRuntime({ runner, id, binary, versionArgs }) {
  const command = [
    `export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/go/bin:$PATH"`,
    `if command -v ${shellQuote(binary)} >/dev/null 2>&1; then`,
    `  printf 'path=%s\\n' "$(command -v ${shellQuote(binary)})"`,
    `  ${shellQuote(binary)} ${versionArgs} 2>&1 | head -n 3`,
    "else",
    "  exit 127",
    "fi"
  ].join("\n");
  const result = await runner.run(command, 15000);
  return {
    id,
    installed: result.status === "completed",
    status: result.status,
    detail: result.status === "completed" ? cleanRuntimeText(result.stdout) : cleanRuntimeText(result.stderr || result.errorMessage || "not installed")
  };
}

async function inspectOpenCodeConfig(runner) {
  const paths = [
    "$HOME/.config/opencode/opencode.json",
    "$HOME/.config/opencode/config.json",
    "$HOME/.opencode/config.json",
    "$HOME/.config/opencode/opencode.toml",
    "$HOME/.config/opencode/config.toml"
  ];
  const command = [
    "set -eu",
    `for file in ${paths.join(" ")}; do`,
    "  if [ -f \"$file\" ]; then",
    "    printf 'path=%s\\n' \"$file\"",
    "    sed -E 's/(api[_-]?key|token|secret|password)[\"'\"']?[[:space:]]*[:=][[:space:]]*[\"'\"']?[^\"'\"',[:space:]]+/\\1: REDACTED/Ig' \"$file\" | head -n 80",
    "    exit 0",
    "  fi",
    "done",
    "printf 'No OpenCode config file found in the default locations.'"
  ].join("\n");
  const result = await runner.run(command, 15000);
  return {
    status: result.status,
    detail: cleanRuntimeText(result.stdout || result.stderr || result.errorMessage)
  };
}

async function callCliAgent({ prompt, provider, distro }) {
  const runtime = provider === "claude"
    ? { name: "Claude Code", binary: "claude", command: (safePrompt) => `claude -p ${shellQuote(safePrompt)}` }
    : { name: "Codex CLI", binary: "codex", command: (safePrompt) => `codex exec --skip-git-repo-check ${shellQuote(safePrompt)}` };
  const runner = createEnvironmentRunner({ distro });
  const check = await runner.run(`export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/go/bin:$PATH" && command -v ${shellQuote(runtime.binary)}`, 15000);
  if (check.status !== "completed") {
    return `${runtime.name} is selected, but the ${runtime.binary} CLI was not found in the execution environment. Install it or select OpenCode/OpenRouter in Settings > AI Agent.`;
  }
  const safePrompt = [
    "You are A.U.R.A's local assistant. Answer in English. Be concise, evidence-driven, and safe. Do not suggest evasion, exploitation, or out-of-scope activity.",
    "",
    prompt
  ].join("\n");
  const result = await runner.run(`export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/go/bin:$PATH" && ${runtime.command(safePrompt)}`, 120000);
  if (result.status === "completed" && result.stdout) return result.stdout;
  return `${runtime.name} did not complete the request.\n${result.stderr || result.errorMessage || "Check the CLI authentication and configuration."}`;
}

async function callOpenRouterAgent({ prompt, settings, store }) {
  const apiKey = store.getActiveApiKey("openrouter");
  if (!apiKey?.api_key) {
    return "OpenRouter is selected, but no active OpenRouter API key is stored. Add it in Settings > API Keys with provider `openrouter`, then try again.";
  }
  const model = settings.executionModel || settings.planningModel || "qwen/qwen3-coder:free";
  const result = await callOpenAiCompatible({
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: apiKey.api_key,
    model,
    prompt,
    headers: {
      "HTTP-Referer": "http://127.0.0.1:31338",
      "X-Title": "A.U.R.A Recon"
    }
  });
  store.markApiKeyUsed(apiKey.id);
  return result;
}

async function callLocalAgent({ prompt, settings }) {
  if (!settings.localEndpoint || !settings.localModel) {
    return "Local model is selected, but the endpoint or model is missing. Configure them in Settings > AI Agent.";
  }
  return callOpenAiCompatible({
    url: settings.localEndpoint,
    apiKey: null,
    model: settings.localModel,
    prompt,
    headers: {}
  });
}

async function callOpenAiCompatible({ url, apiKey, model, prompt, headers }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...headers
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are A.U.R.A's local assistant. Answer in English. Be concise, evidence-driven, and safe. Do not suggest evasion, exploitation, or out-of-scope activity."
        },
        { role: "user", content: prompt }
      ]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return `AI provider request failed: ${data.error?.message || response.statusText}`;
  }
  return data.choices?.[0]?.message?.content || "The AI provider returned an empty response.";
}

function normalizeAiProvider(provider) {
  return ["opencode", "openrouter", "codex", "claude", "local"].includes(provider) ? provider : "opencode";
}

function defaultAiModels() {
  return [
    { id: "qwen/qwen3-coder:free", label: "Qwen3 Coder Free", provider: "openrouter", tags: ["coding", "free"] },
    { id: "deepseek/deepseek-r1-0528:free", label: "DeepSeek R1 Free", provider: "openrouter", tags: ["reasoning", "free"] },
    { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B Free", provider: "openrouter", tags: ["general", "free"] },
    { id: "google/gemma-3-27b-it:free", label: "Gemma 3 27B Free", provider: "openrouter", tags: ["general", "free"] },
    { id: "mistralai/mistral-small-3.2-24b-instruct:free", label: "Mistral Small Free", provider: "openrouter", tags: ["fast", "free"] }
  ];
}

async function listOpenRouterFreeModels() {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.data)) return defaultAiModels();
    const free = data.data
      .filter((model) => model.id && model.pricing?.prompt === "0" && model.pricing?.completion === "0")
      .filter((model) => !model.architecture?.modality || String(model.architecture.modality).includes("text"))
      .slice(0, 12)
      .map((model) => ({
        id: model.id,
        label: model.name || model.id,
        provider: "openrouter",
        tags: ["free", `${Math.round((model.context_length || 0) / 1000)}k context`]
      }));
    return free.length > 0 ? free : defaultAiModels();
  } catch {
    return defaultAiModels();
  }
}

function setupHelpMessage(prompt) {
  const lower = prompt.toLowerCase();
  if (lower.includes("install") || lower.includes("tool") || lower.includes("opencode") || lower.includes("ai")) {
    return [
      "Go to Settings > Environment.",
      "1. Click Check Environment.",
      "2. Click Install / Update Tools.",
      "3. A.U.R.A installs system prerequisites first, then OpenCode, then registry tools.",
      "4. Add optional provider API keys later in Settings > API Keys.",
      "If OpenCode is installed but chat still fails, configure its model/provider in the Linux environment."
    ].join("\n");
  }
  return "OpenCode is not available to the backend yet. Go to Settings > Environment and run Install / Update Tools first.";
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function cleanRuntimeText(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u009b[0-9;?]*[ -/]*[@-~]/g, "")
    .trim();
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

function serveWordlistArtifact(response, store, id, action) {
  const wordlist = store.getWordlist(id);
  if (!wordlist) {
    sendJson(response, { error: "Wordlist not found" }, 404);
    return;
  }
  const filePath = resolveWordlistFile(wordlist.path);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, { error: "Wordlist file is not available on disk" }, 404);
    return;
  }
  if (action === "download") {
    response.writeHead(200, exportHeaders("text/plain; charset=utf-8", `${safeDownloadName(wordlist.name)}.txt`));
    fs.createReadStream(filePath).pipe(response);
    return;
  }
  const maxBytes = 256 * 1024;
  const stat = fs.statSync(filePath);
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(maxBytes, stat.size));
    fs.readSync(handle, buffer, 0, buffer.length, 0);
    sendJson(response, {
      wordlist,
      sizeBytes: stat.size,
      truncated: stat.size > maxBytes,
      content: buffer.toString("utf8")
    });
  } finally {
    fs.closeSync(handle);
  }
}

function deleteWordlist(response, store, id) {
  const wordlist = store.getWordlist(id);
  if (!wordlist) {
    sendJson(response, { error: "Wordlist not found" }, 404);
    return;
  }
  const filePath = resolveWordlistFile(wordlist.path);
  const deleteFile = isGeneratedWordlistPath(filePath) && fs.existsSync(filePath);
  const deleted = store.deleteWordlist(id);
  if (deleteFile) fs.rmSync(filePath, { force: true });
  sendJson(response, deleted ? { deleted: true, fileDeleted: deleteFile, id } : { error: "Wordlist not found" }, deleted ? 200 : 404);
}

function resolveWordlistFile(value) {
  if (!value) return null;
  return path.resolve(String(value));
}

function isGeneratedWordlistPath(filePath) {
  if (!filePath) return false;
  const generatedDir = path.resolve(GENERATED_DIR);
  const relative = path.relative(generatedDir, path.resolve(filePath));
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeDownloadName(value) {
  return String(value || "wordlist").replaceAll(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "") || "wordlist";
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
  const proxy = parseOptionalProxy(response, body.proxyUrl);
  if (proxy === false) return;
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
  ensureDefaultWordlists(store);
  sendJson(response, { run }, 202);
  runInBackground(async () => {
    try {
      const domainWordlist = store.getActiveWordlist("domains");
      const intelSeeds = body.intelPreflight === false
        ? rootDomains
        : await runReconIntelPreflight({ store, runId: run.id, targetName: target.target_name, rootDomains, config: targetConfig });
      const rootsToScan = reconMode === "full"
        ? await expandFullReconRoots({ store, runId: run.id, targetName: target.target_name, rootDomains: intelSeeds, config: targetConfig, fullRecon: body.fullRecon || {} })
        : intelSeeds;
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
        timeoutMs: Number(body.timeoutMs || 180000),
        proxyUrl: proxy
      });
    } catch (error) {
      if (isRunControlError(error)) {
        store.appendEvent(run.id, {
          phase: "control",
          severity: "warn",
          source: "engine",
          message: error.message
        });
        return;
      }
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

async function createHttpFollowupRun(request, response, store, sourceRunId) {
  const sourceRun = store.getRun(sourceRunId);
  if (!sourceRun) {
    sendJson(response, { error: "Source run not found" }, 404);
    return;
  }
  const domains = store.listDomains({ runId: sourceRunId, limit: 1000000 });
  if (domains.length === 0) {
    sendJson(response, { error: "The source run has no saved domains to probe" }, 400);
    return;
  }
  const body = await readBody(request);
  const proxy = parseOptionalProxy(response, body.proxyUrl);
  if (proxy === false) return;
  const run = store.createRun({
    targetName: sourceRun.target_name,
    runType: "http-followup",
    mode: "http-tech-followup",
    providerProfile: body.useWsl === false ? "passive" : "wsl-kali",
    checkpoint: { sourceRunId, sourceDomainCount: domains.length }
  });
  sendJson(response, { run, sourceRunId, sourceDomainCount: domains.length }, 202);
  runInBackground(async () => {
    try {
      await runHttpFollowup({
        store,
        runId: run.id,
        targetName: sourceRun.target_name,
        domains: domains.map((item) => item.domain),
        screenshotTools: body.screenshotTools || DEFAULT_SCREENSHOT_TOOLS,
        wslDistro: body.wslDistro || "kali-linux",
        useWsl: body.useWsl !== false,
        timeoutMs: Number(body.timeoutMs || 180000),
        proxyUrl: proxy
      });
    } catch (error) {
      if (isRunControlError(error)) {
        store.appendEvent(run.id, {
          phase: "control",
          severity: "warn",
          source: "engine",
          message: error.message
        });
        return;
      }
      store.appendEvent(run.id, {
        phase: "http-tech-followup",
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

async function createFocusedFollowupRun(request, response, store, sourceRunId, phaseName) {
  const sourceRun = store.getRun(sourceRunId);
  if (!sourceRun) {
    sendJson(response, { error: "Source run not found" }, 404);
    return;
  }
  const body = await readBody(request);
  const proxy = parseOptionalProxy(response, body.proxyUrl);
  if (proxy === false) return;
  const phase = phaseName === "http-only" ? "http" : phaseName;
  const domains = store.listDomains({ runId: sourceRunId, limit: 1000000 });
  const services = store.listHttpServices({ runId: sourceRunId, limit: 1000000 });
  if ((phase === "urls" || phase === "http") && domains.length === 0) {
    sendJson(response, { error: "The source run has no saved domains for this follow-up phase" }, 400);
    return;
  }
  if ((phase === "tech" || phase === "screenshots" || phase === "trackers" || phase === "favicons") && services.length === 0) {
    sendJson(response, { error: "The source run has no saved HTTP services for this follow-up phase" }, 400);
    return;
  }
  const rootDomains = Array.isArray(sourceRun.checkpoint?.rootDomains)
    ? sourceRun.checkpoint.rootDomains
    : inferRootsFromDomainRows(domains);
  const run = store.createRun({
    targetName: sourceRun.target_name,
    runType: "focused-followup",
    mode: `follow-up-${phaseName}`,
    providerProfile: body.useWsl === false ? "passive" : "wsl-kali",
    checkpoint: {
      sourceRunId,
      phase,
      sourceDomainCount: domains.length,
      sourceServiceCount: services.length
    }
  });
  sendJson(response, {
    run,
    sourceRunId,
    phase,
    sourceDomainCount: domains.length,
    sourceServiceCount: services.length
  }, 202);
  runInBackground(async () => {
    try {
      await runFocusedFollowup({
        store,
        runId: run.id,
        targetName: sourceRun.target_name,
        phase,
        domains,
        services,
        rootDomains,
        screenshotTools: body.screenshotTools || DEFAULT_SCREENSHOT_TOOLS,
        wslDistro: body.wslDistro || "kali-linux",
        useWsl: body.useWsl !== false,
        timeoutMs: Number(body.timeoutMs || 180000),
        proxyUrl: proxy
      });
    } catch (error) {
      if (isRunControlError(error)) {
        store.appendEvent(run.id, {
          phase: "control",
          severity: "warn",
          source: "engine",
          message: error.message
        });
        return;
      }
      store.appendEvent(run.id, {
        phase: `follow-up-${phase}`,
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

function inferRootsFromDomainRows(rows) {
  const roots = new Set();
  for (const row of rows || []) {
    const domain = normalizeDomain(row.domain || row.host || row);
    if (!domain) continue;
    const parts = domain.split(".");
    roots.add(parts.length > 2 ? parts.slice(-2).join(".") : domain);
  }
  return [...roots].sort();
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

async function runReconIntelPreflight({ store, runId, targetName, rootDomains, config }) {
  store.appendEvent(runId, {
    phase: "whois-rdap",
    severity: "ok",
    source: "engine",
    message: "Running WHOIS/RDAP and alternate TLD intel preflight before enumeration."
  });
  let suggestions = await suggestReverseWhoisTerms({ domains: rootDomains });
  suggestions = await enrichWhoisSuggestionsWithHistory({ store, runId, domains: rootDomains, suggestions });
  const rdapDomains = filterScopeDomains({
    domains: extractRdapRelatedDomains(suggestions),
    config,
    rootDomains
  });
  if (rdapDomains.length > 0) {
    saveBootstrapDomains({ store, runId, targetName, domains: rdapDomains, roots: rootDomains, source: "rdap-associated-domain" });
  }
  const alternateTldLeads = generateAlternateTldLeads({ rootDomains, config });
  if (alternateTldLeads.length > 0) {
    store.saveAssetLeads(runId, targetName, alternateTldLeads);
  }
  runCandidateCorrelation({
    store,
    runId,
    targetName,
    rootDomains,
    leads: alternateTldLeads,
    config
  });
  store.appendEvent(runId, {
    phase: "whois-rdap",
    severity: rdapDomains.length || alternateTldLeads.length ? "ok" : "warn",
    source: "rdap",
    message: `Intel preflight saved ${rdapDomains.length} RDAP-associated seeds and ${alternateTldLeads.length} alternate TLD review leads.`
  });
  return [...new Set([...rootDomains, ...rdapDomains])];
}

async function enrichWhoisSuggestionsWithHistory({ store, runId, domains, suggestions }) {
  const hasCurrentPivots = (suggestions.includeTerms || []).length > 0 || (suggestions.associatedDomains || []).length > 0;
  if (hasCurrentPivots) return suggestions;
  const selectedKey = store.getActiveApiKey("whoisfreaks");
  if (!selectedKey?.api_key) {
    appendOptionalEvent(store, runId, {
      phase: "whois-rdap",
      severity: "warn",
      source: "whois-history",
      message: "Current RDAP/WHOIS had no useful pivots. Historical WHOIS fallback skipped because no active WhoisFreaks API key is configured."
    });
    return suggestions;
  }
  const includeTerms = [];
  const associatedDomains = [];
  let checked = 0;
  for (const domain of domains || []) {
    try {
      const history = await callWhoisFreaksHistorical({ apiKey: selectedKey.api_key, domainName: domain });
      store.markApiKeyUsed(selectedKey.id);
      checked += 1;
      includeTerms.push(...history.includeTerms);
      associatedDomains.push(...history.domains);
      appendOptionalEvent(store, runId, {
        phase: "whois-rdap",
        severity: history.includeTerms.length || history.domains.length ? "ok" : "warn",
        source: "whoisfreaks",
        message: `Historical WHOIS checked ${domain}: ${history.totalRecords} records, ${history.includeTerms.length} pivot terms, ${history.domains.length} related domains.`
      });
    } catch (error) {
      appendOptionalEvent(store, runId, {
        phase: "whois-rdap",
        severity: "warn",
        source: "whoisfreaks",
        message: `Historical WHOIS fallback failed for ${domain}: ${error.message}`
      });
    }
  }
  const mergedIncludeTerms = [...new Set([...(suggestions.includeTerms || []), ...includeTerms])].slice(0, 4);
  const mergedAssociatedDomains = [...new Set([...(suggestions.associatedDomains || []), ...associatedDomains])];
  return {
    ...suggestions,
    includeTerms: mergedIncludeTerms,
    associatedDomains: mergedAssociatedDomains,
    historicalFallback: {
      provider: "whoisfreaks",
      checked,
      includeTerms: mergedIncludeTerms.length,
      associatedDomains: mergedAssociatedDomains.length
    },
    rationale: mergedIncludeTerms.length || mergedAssociatedDomains.length
      ? "Current RDAP had no useful pivots, so historical WHOIS was used to recover target-related terms."
      : suggestions.rationale
  };
}

function appendOptionalEvent(store, runId, event) {
  if (runId) store.appendEvent(runId, event);
}

async function expandFullReconRoots({ store, runId, targetName, rootDomains, config, fullRecon }) {
  const include = (fullRecon.include || []).map((value) => String(value || "").trim()).filter(Boolean);
  const maxAssetLeads = Math.max(0, Math.min(5000, Number(fullRecon.maxAssetLeads || 250)));
  if (include.length === 0) {
    store.appendEvent(runId, {
      phase: "provider-discovery",
      severity: "warn",
      source: "engine",
      message: "Full recon provider discovery skipped: no provider search terms provided"
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
      ? filterScopeDomains({
        domains: normalizeDomainList(result.leads.map((lead) => lead.domain)).slice(0, maxAssetLeads),
        config,
        rootDomains
      })
      : [];
    store.appendEvent(runId, {
      phase: "provider-discovery",
      severity: "ok",
      source: "whoisxmlapi",
      message: `Full recon saved ${savedLeads} provider leads and kept ${candidateDomains.length} authorized domains as seeds`
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
      phase: "provider-discovery",
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
    sendJson(response, { error: "Authorization confirmation is required before provider discovery" }, 400);
    return;
  }
  const targetConfigPath = resolveTargetConfigPath(body.targetName);
  const targetConfig = readJson(targetConfigPath);
  const target = store.upsertTarget(targetConfigPath, targetConfig);
  const run = store.createRun({
    targetName: target.target_name,
    runType: "provider-discovery",
    mode: "passive",
    providerProfile: "automatic-passive"
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
    runCandidateCorrelation({
      store,
      runId: run.id,
      targetName: target.target_name,
      rootDomains: inferRootDomains(target),
      leads: store.listAssetLeads({ targetName: target.target_name })
        .filter((lead) => lead.run_id === run.id),
      config: target
    });
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

async function suggestWhoisTerms(request, response, store) {
  const body = await readBody(request);
  const requestedDomains = Array.isArray(body.domains) ? body.domains : [];
  const domains = requestedDomains.length
    ? requestedDomains
    : loadTargetDomains(body.targetName, store);
  let result = await suggestReverseWhoisTerms({ domains });
  result = await enrichWhoisSuggestionsWithHistory({ store, runId: null, domains, suggestions: result });
  sendJson(response, result);
}

function loadTargetDomains(targetName, store) {
  if (!targetName) return [];
  const targetConfigPath = resolveTargetConfigPath(targetName);
  if (fs.existsSync(targetConfigPath)) {
    const targetConfig = readJson(targetConfigPath);
    return inferRootDomains(store.upsertTarget(targetConfigPath, targetConfig));
  }
  return [];
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
    phase: "provider-discovery",
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

  const aiLogMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/ai-log$/);
  if (aiLogMatch) {
    const runId = Number(aiLogMatch[1]);
    const run = store.getRun(runId);
    if (!run) {
      sendJson(response, { error: "Run not found" }, 404);
      return true;
    }
    const events = store.listEvents(runId, 0, 5000)
      .filter((event) => String(event.phase || "").startsWith("ai-"));
    sendJson(response, { events, techniques: CORRELATION_TECHNIQUES });
    return true;
  }

  const toolResultsMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/tool-results$/);
  if (toolResultsMatch) {
    sendJson(response, { toolResults: store.listToolResults({ runId: Number(toolResultsMatch[1]) }) });
    return true;
  }

  const toolLogMatch = url.pathname.match(/^\/api\/recon-tool-results\/(\d+)\/log$/);
  if (toolLogMatch) {
    serveToolResultLog(response, store, Number(toolLogMatch[1]), url.searchParams.get("stream") || "stdout");
    return true;
  }

  const exportMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/export$/);
  if (exportMatch) {
    exportRun(response, store, Number(exportMatch[1]), url.searchParams.get("format") || "json");
    return true;
  }

  const resultTreeMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/result-tree$/);
  if (resultTreeMatch) {
    const runId = Number(resultTreeMatch[1]);
    const tree = buildRunResultTree(store, runId);
    sendJson(response, tree ? { tree } : { error: "Run not found" }, tree ? 200 : 404);
    return true;
  }

  const deltaMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/delta$/);
  if (deltaMatch) {
    sendJson(response, { delta: buildRunDelta(store, Number(deltaMatch[1])) });
    return true;
  }

  const countsMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/counts$/);
  if (countsMatch) {
    const runId = Number(countsMatch[1]);
    const run = store.getRun(runId);
    sendJson(response, run ? { counts: store.getRunObservationCounts(runId) } : { error: "Run not found" }, run ? 200 : 404);
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

  const latestRunMatch = url.pathname.match(/^\/api\/targets\/([^/]+)\/latest-run$/);
  if (latestRunMatch) {
    const targetName = decodeURIComponent(latestRunMatch[1]);
    const target = store.getTarget(targetName);
    if (!target) {
      sendJson(response, { error: "Target not found" }, 404);
      return true;
    }
    sendJson(response, { run: store.getLatestRunForTarget(targetName) });
    return true;
  }

  const servicesMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/http-services$/);
  if (servicesMatch) {
    sendJson(response, { services: store.listHttpServices({ runId: Number(servicesMatch[1]) }) });
    return true;
  }

  const technologiesMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/technologies$/);
  if (technologiesMatch) {
    sendJson(response, { technologies: store.listTechnologySummary({ runId: Number(technologiesMatch[1]) }) });
    return true;
  }

  const urlsMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/urls$/);
  if (urlsMatch) {
    sendJson(response, { urls: store.listUrls({ runId: Number(urlsMatch[1]) }) });
    return true;
  }

  const screenshotsMatch = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/screenshots$/);
  if (screenshotsMatch) {
    sendJson(response, { screenshots: store.listScreenshots({ runId: Number(screenshotsMatch[1]) }).map(withScreenshotImages) });
    return true;
  }

  const screenshotImageMatch = url.pathname.match(/^\/api\/recon-screenshots\/(\d+)\/image$/);
  if (screenshotImageMatch) {
    serveScreenshotImage(response, store, Number(screenshotImageMatch[1]), url.searchParams.get("path") || "");
    return true;
  }

  return false;
}

function exportRun(response, store, runId, format) {
  const snapshot = buildRunSnapshot(store, runId);
  if (!snapshot.run) {
    sendJson(response, { error: "Run not found" }, 404);
    return;
  }
  if (format === "json") {
    response.writeHead(200, exportHeaders("application/json; charset=utf-8", `aura-run-${runId}.json`));
    response.end(JSON.stringify(snapshot, null, 2));
    return;
  }
  if (format === "csv") {
    response.writeHead(200, exportHeaders("text/csv; charset=utf-8", `aura-run-${runId}.csv`));
    response.end(runSnapshotCsv(snapshot));
    return;
  }
  if (format === "markdown" || format === "md") {
    response.writeHead(200, exportHeaders("text/markdown; charset=utf-8", `aura-run-${runId}.md`));
    response.end(runSnapshotMarkdown(snapshot));
    return;
  }
  sendJson(response, { error: "Unsupported export format. Use json, csv, or markdown." }, 400);
}

function serveToolResultLog(response, store, toolResultId, streamName) {
  const result = store.getToolResult(toolResultId);
  if (!result) {
    sendJson(response, { error: "Tool result not found" }, 404);
    return;
  }
  const stream = streamName === "stderr" ? "stderr" : "stdout";
  const filePath = stream === "stderr" ? result.stderrPath : result.stdoutPath;
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, { error: `${stream} log artifact is not available` }, 404);
    return;
  }
  const maxBytes = 1024 * 1024;
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    sendJson(response, {
      toolResultId: result.id,
      toolName: result.toolName,
      stream,
      truncated: start > 0,
      content: buffer.toString("utf8")
    });
  } finally {
    fs.closeSync(handle);
  }
}

function exportHeaders(contentType, filename) {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`
  };
}

function buildRunSnapshot(store, runId) {
  return {
    exportedAt: new Date().toISOString(),
    run: store.getRun(runId),
    events: store.listEvents(runId, 0, 5000),
    counts: store.getRunObservationCounts(runId),
    domains: store.listDomains({ runId, limit: 10000 }),
    httpServices: store.listHttpServices({ runId, limit: 10000 }),
    technologies: store.listTechnologySummary({ runId, limit: 10000 }),
    urls: store.listUrls({ runId, limit: 10000 }),
    screenshots: store.listScreenshots({ runId }).map(withScreenshotImages),
    toolResults: store.listToolResults({ runId, limit: 1000 }),
    delta: buildRunDelta(store, runId)
  };
}

function withScreenshotImages(screenshot) {
  return {
    ...screenshot,
    images: listScreenshotImages(screenshot).map((image) => ({
      ...image,
      url: `/api/recon-screenshots/${screenshot.id}/image?path=${encodeURIComponent(image.relativePath)}`
    }))
  };
}

function listScreenshotImages(screenshot) {
  const outputDir = path.resolve(String(screenshot.output_dir || ""));
  if (!outputDir || !fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) return [];
  const images = [];
  collectScreenshotImages(outputDir, outputDir, images);
  return images.slice(0, 80);
}

function collectScreenshotImages(outputDir, currentDir, images) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectScreenshotImages(outputDir, fullPath, images);
      continue;
    }
    if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
    const relativePath = path.relative(outputDir, fullPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;
    images.push({ name: entry.name, relativePath });
  }
}

function serveScreenshotImage(response, store, screenshotId, relativeImagePath) {
  const screenshot = store.getScreenshot(screenshotId);
  if (!screenshot) {
    sendJson(response, { error: "Screenshot run not found" }, 404);
    return;
  }
  const outputDir = path.resolve(String(screenshot.output_dir || ""));
  const imagePath = path.resolve(outputDir, relativeImagePath);
  const relative = path.relative(outputDir, imagePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !/\.(png|jpe?g|webp)$/i.test(imagePath)) {
    sendJson(response, { error: "Screenshot image not found" }, 404);
    return;
  }
  if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
    sendJson(response, { error: "Screenshot image not found" }, 404);
    return;
  }
  sendFile(response, imagePath);
}

function buildRunResultTree(store, runId) {
  const run = store.getRun(runId);
  if (!run) return null;
  return buildResultTree({
    run,
    target: store.getTarget(run.target_name),
    counts: store.getRunObservationCounts(runId),
    domains: store.listDomains({ runId, limit: 100000 }),
    httpServices: store.listHttpServices({ runId, limit: 100000 }),
    urls: store.listUrls({ runId, limit: 100000 }),
    screenshots: store.listScreenshots({ runId }),
    assetLeads: store.listAssetLeads({ targetName: run.target_name, limit: 100000 })
      .filter((lead) => !lead.run_id || lead.run_id === runId),
    delta: buildRunDelta(store, runId)
  });
}

function buildRunDelta(store, runId) {
  const run = store.getRun(runId);
  if (!run) return null;
  const previousRun = store.getPreviousRunForTarget(run.target_name, run.id);
  if (!previousRun) {
    return {
      runId: run.id,
      targetName: run.target_name,
      comparedToRunId: null,
      comparedToStartedAt: null,
      domains: emptyDeltaSet(),
      urls: emptyDeltaSet(),
      httpServices: emptyDeltaSet()
    };
  }
  return {
    runId: run.id,
    targetName: run.target_name,
    comparedToRunId: previousRun.id,
    comparedToStartedAt: previousRun.started_at,
    domains: compareValues({
      current: store.listDomains({ runId: run.id, limit: 100000 }),
      previous: store.listDomains({ runId: previousRun.id, limit: 100000 }),
      valueKey: "domain"
    }),
    urls: compareValues({
      current: store.listUrls({ runId: run.id, limit: 100000 }),
      previous: store.listUrls({ runId: previousRun.id, limit: 100000 }),
      valueKey: "url"
    }),
    httpServices: compareValues({
      current: store.listHttpServices({ runId: run.id, limit: 100000 }),
      previous: store.listHttpServices({ runId: previousRun.id, limit: 100000 }),
      valueKey: "url"
    })
  };
}

function emptyDeltaSet() {
  return {
    currentCount: 0,
    previousCount: 0,
    addedCount: 0,
    removedCount: 0,
    stableCount: 0,
    added: [],
    removed: []
  };
}

function compareValues({ current, previous, valueKey }) {
  const currentMap = mapByNormalizedValue(current, valueKey);
  const previousMap = mapByNormalizedValue(previous, valueKey);
  const added = [...currentMap.entries()]
    .filter(([key]) => !previousMap.has(key))
    .map(([, item]) => item)
    .sort(compareDeltaItems);
  const removed = [...previousMap.entries()]
    .filter(([key]) => !currentMap.has(key))
    .map(([, item]) => item)
    .sort(compareDeltaItems);
  return {
    currentCount: currentMap.size,
    previousCount: previousMap.size,
    addedCount: added.length,
    removedCount: removed.length,
    stableCount: [...currentMap.keys()].filter((key) => previousMap.has(key)).length,
    added: added.slice(0, 250),
    removed: removed.slice(0, 250)
  };
}

function mapByNormalizedValue(items, valueKey) {
  const mapped = new Map();
  for (const item of items || []) {
    const value = String(item?.[valueKey] || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!mapped.has(key)) mapped.set(key, item);
  }
  return mapped;
}

function compareDeltaItems(left, right) {
  const leftValue = String(left.domain || left.url || "");
  const rightValue = String(right.domain || right.url || "");
  return leftValue.localeCompare(rightValue);
}

function runSnapshotCsv(snapshot) {
  const rows = [["type", "value", "detail", "source", "status", "seen_at"]];
  for (const domain of snapshot.domains) {
    rows.push(["domain", domain.domain, domain.kind || "", domain.source || "", domain.status || "", domain.first_seen_at || ""]);
  }
  for (const service of snapshot.httpServices) {
    rows.push(["http_service", service.url, [service.statusCode, service.title, (service.technologies || []).join("|")].filter(Boolean).join(" "), service.source || "", "", service.probed_at || ""]);
  }
  for (const technology of snapshot.technologies) {
    rows.push(["technology", technology.name, `${technology.count} services / ${technology.hostCount} hosts`, technology.source || "", "", technology.lastSeenAt || ""]);
  }
  for (const url of snapshot.urls) {
    rows.push(["url", url.url, (url.params || []).join("|"), url.source || "", "", url.first_seen_at || ""]);
  }
  for (const tool of snapshot.toolResults) {
    rows.push(["tool_result", tool.toolName, tool.commandDisplay || "", "tool", tool.status || "", tool.finishedAt || tool.startedAt || ""]);
  }
  if (snapshot.delta?.comparedToRunId) {
    for (const domain of snapshot.delta.domains.added) {
      rows.push(["run_delta_added_domain", domain.domain, `vs run ${snapshot.delta.comparedToRunId}`, domain.source || "", domain.status || "", domain.first_seen_at || ""]);
    }
    for (const domain of snapshot.delta.domains.removed) {
      rows.push(["run_delta_removed_domain", domain.domain, `vs run ${snapshot.delta.comparedToRunId}`, domain.source || "", domain.status || "", domain.last_seen_at || domain.first_seen_at || ""]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

function runSnapshotMarkdown(snapshot) {
  const run = snapshot.run;
  return [
    `# A.U.R.A Run ${run.id}`,
    "",
    `- Target: ${run.target_name}`,
    `- Status: ${run.status}`,
    `- Started: ${run.started_at}`,
    `- Finished: ${run.finished_at || "-"}`,
    "",
    "## Counts",
    "",
    `- Domains: ${snapshot.counts.domains}`,
    `- HTTP services: ${snapshot.counts.httpServices}`,
    `- Technologies: ${snapshot.counts.technologies}`,
    `- URLs: ${snapshot.counts.urls}`,
    `- Screenshots: ${snapshot.counts.screenshots}`,
    `- Tool results: ${snapshot.counts.toolResults}`,
    snapshot.delta?.comparedToRunId ? `- New domains vs run ${snapshot.delta.comparedToRunId}: ${snapshot.delta.domains.addedCount}` : "- New domains: no previous run",
    snapshot.delta?.comparedToRunId ? `- Removed domains vs run ${snapshot.delta.comparedToRunId}: ${snapshot.delta.domains.removedCount}` : "",
    "",
    "## Recent Events",
    "",
    ...snapshot.events.slice(-50).map((event) => `- ${event.created_at} ${event.source || "system"}: ${event.message}`),
    ""
  ].join("\n");
}

module.exports = {
  buildRunDelta,
  buildTargetConfigFromRequest,
  extractBrandTerms,
  filterScopeDomains,
  generateAlternateTldLeads,
  handleApiRequest
};
