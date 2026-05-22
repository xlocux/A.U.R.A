"use strict";

const fs = require("node:fs");
const { normalizeDomain } = require("../recon/domain-utils");
const { generateWordlistFromDb } = require("../recon/wordlist-generator");
const { checkWslEnvironment, createEnvironmentRunner, installWslTools } = require("../recon/environment-setup");
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

  if (request.method === "GET" && url.pathname === "/api/ai-settings") {
    sendJson(response, { settings: store.getAiSettings(), models: await listOpenRouterFreeModels() });
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

  if (request.method === "POST" && url.pathname === "/api/environment/install") {
    await installEnvironment(request, response);
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

async function agentChat(request, response, store) {
  const body = await readBody(request);
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    sendJson(response, { message: "Ask me what you want to do next." });
    return;
  }
  const settings = store.getAiSettings();
  if (settings.provider === "openrouter") {
    sendJson(response, { message: await callOpenRouterAgent({ prompt, settings, store }) });
    return;
  }
  if (settings.provider === "local") {
    sendJson(response, { message: await callLocalAgent({ prompt, settings }) });
    return;
  }
  const runner = createEnvironmentRunner({ distro: body.distro || "kali-linux" });
  const check = await runner.run("export PATH=\"$HOME/.opencode/bin:$HOME/.local/bin:$HOME/go/bin:$PATH\" && command -v opencode", 15000);
  if (check.status === "completed") {
    const safePrompt = [
      "You are A.U.R.A's local assistant. Answer concisely. Help with setup, tools, recon workflow, and UI usage. Do not suggest unsafe or out-of-scope activity.",
      "",
      prompt
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
  return ["opencode", "openrouter", "local"].includes(provider) ? provider : "opencode";
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
