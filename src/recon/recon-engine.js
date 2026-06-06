"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { extractDomains, normalizeDomain, rootForDomain } = require("./domain-utils");
const { parseGauUrls, parseHttpxJsonLines } = require("./parsers");
const { classifyApiFailure } = require("./provider-apis");
const { runTechnologyEnrichment } = require("./technology-detectors");
const { extractTrackersFromServices } = require("./tracker-extraction");
const { extractFaviconsFromServices } = require("./web-fingerprints");
const { runPassiveSource } = require("./passive-sources");
const ProxyRotationController = require("./proxy-rotation");
const { commandDisplay, redactProxyUrl, runLinuxTool } = require("./linux-tools");
const { buildProxyAwareInvocation } = require("./tool-proxy-policy");
const { preflightCheckToolAvailability, assertToolsAvailable } = require("./tool-preflight-check");

const DEFAULT_PASSIVE_SOURCES = ["crtsh", "wayback"];
const DEFAULT_LINUX_TOOLS = ["subfinder", "dnsx", "gau", "httpx"];
const DEFAULT_SCREENSHOT_TOOLS = ["gowitness"];
const HTTPX_PORT_PRESETS = {
  small: [80, 443, 8080, 8443],
  medium: [80, 443, 8009, 8080, 8081, 8090, 8180, 8443, 27000, 27001, 5000, 5001, 9001, 81, 9443, 25, 23],
  large: [21, 22, 23, 25, 53, 80, 81, 110, 143, 443, 465, 587, 993, 995, 3000, 3001, 4000, 5000, 5001, 5601, 7000, 7001, 8000, 8001, 8008, 8009, 8080, 8081, 8082, 8088, 8090, 8180, 8443, 8888, 9000, 9001, 9090, 9200, 9443, 10000, 27000, 27001]
};
const DEFAULT_HTTPX_PORTS = HTTPX_PORT_PRESETS.medium;
const RUN_CONTROL_STATUSES = new Set(["paused", "cancelled"]);
const API_PASSIVE_PROVIDERS = [
  "rapid7",
  "censys",
  "hunterio",
  "binaryedge",
  "certspotter",
  "passivetotal",
  "securitytrails",
  "shodan",
  "urlscan",
  "virustotal",
  "zoomeye",
  "spyse",
  "intelx",
  "whoisxmlapi",
  "whoisfreaks"
];
const DEFAULT_TOOL_RECOVERY_ATTEMPTS = 2;
const TOOL_RECOVERY_PATTERNS = [
  /timed?\s*out|timeout/i,
  /econn(refused|reset|aborted)/i,
  /etimedout/i,
  /connection\s*(refused|reset|closed|aborted)/i,
  /network\s*(is\s*)?unreachable/i,
  /tls\s*handshake/i,
  /context\s*deadline\s*exceeded/i,
  /temporary\s*failure/i
];

async function runRecon({
  store,
  runId,
  targetName,
  rootDomains,
  passiveSources = DEFAULT_PASSIVE_SOURCES,
  linuxTools = DEFAULT_LINUX_TOOLS,
  screenshotTools = DEFAULT_SCREENSHOT_TOOLS,
  linuxRuntime = "linux",
  useLinuxRunner = true,
  subdomainWordlistPath = null,
  timeoutMs = 180000,
  artifactsDir = path.resolve("data", "recon-runs", String(runId)),
  proxyUrl = null
}) {
  const roots = [...new Set(rootDomains.map(normalizeDomain).filter(Boolean))];
  if (roots.length === 0) throw new Error("Recon requires at least one valid root domain");

  // Pre-flight check for tool availability (but non-blocking - passive recon can run without tools)
  if (useLinuxRunner) {
    const toolNames = [...new Set(linuxTools.map(tool => (typeof tool === "string" ? tool.split(":")[0] : tool.name || tool.tool)))];
    const screenshotToolNames = screenshotTools || [];
    const allToolNames = [...new Set([...toolNames, ...screenshotToolNames])];
    const preflightCheck = await preflightCheckToolAvailability({ toolIds: allToolNames });
    if (preflightCheck.missing.length || preflightCheck.wrongCapability.length) {
      const issues = [];
      if (preflightCheck.missing.length) issues.push(`Missing: ${preflightCheck.missing.join(", ")}`);
      if (preflightCheck.wrongCapability.length) issues.push(`Wrong identity: ${preflightCheck.wrongCapability.join(", ")}`);
      store.appendEvent(runId, {
        phase: "preflight",
        severity: "warn",
        source: "preflight-check",
        message: `Tool availability warning: ${issues.join("; ")}. Passive sources will run, but these tools will be skipped.`,
        payload: preflightCheck
      });
    }
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForRunControl(store, runId);
  store.updateRun(runId, {
    status: "running",
    activePhase: "recon",
    checkpoint: { rootDomains: roots, passiveSources, linuxTools, screenshotTools, useLinuxRunner, subdomainWordlistPath }
  });
  store.appendEvent(runId, { phase: "recon", source: "engine", message: `Recon started for ${roots.join(", ")}` });

  const proxyController = useLinuxRunner
    ? await createProxyController({ store, runId, proxyUrl, phase: "recon" })
    : null;
  const selectedProxyUrl = proxyController?.bestProxyUrl() || proxyUrl || null;
  if (selectedProxyUrl) {
    store.appendEvent(runId, {
      phase: "recon",
      severity: "ok",
      source: "network",
      message: proxyController?.hasPool()
        ? `Automatic proxy rotation enabled. Best preflight proxy: ${redactProxyUrl(selectedProxyUrl)}`
        : `Outbound proxy enabled for Linux recon tools: ${redactProxyUrl(selectedProxyUrl)}`
    });
  }

  await waitForRunControl(store, runId);
  const discovered = new Set(roots);
  await collectPassive({ store, runId, targetName, roots, passiveSources, discovered });
  await waitForRunControl(store, runId);
  const context = createRunContext();
  await collectLinuxTools({ store, runId, targetName, roots, linuxTools, linuxRuntime, useLinuxRunner, subdomainWordlistPath, timeoutMs, artifactsDir, discovered, context, proxyUrl: selectedProxyUrl, proxyController });
  await waitForRunControl(store, runId);
  await runTechnologyEnrichment({ store, runId, targetName, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, waitForRunControl, proxyUrl: selectedProxyUrl });
  await waitForRunControl(store, runId);
  await collectScreenshots({ store, runId, targetName, screenshotTools, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl: selectedProxyUrl, proxyController });
  await waitForRunControl(store, runId);
  await collectTrackers({ store, runId, targetName, services: context.httpServices, timeoutMs, artifactsDir });
  await collectFavicons({ store, runId, targetName, services: context.httpServices, timeoutMs, artifactsDir });
  await runRecoveryActionPool({
    store,
    runId,
    targetName,
    roots,
    linuxTools,
    linuxRuntime,
    useLinuxRunner,
    timeoutMs,
    artifactsDir,
    context,
    screenshotTools,
    discoveredDomains: discovered,
    subdomainWordlistPath,
    proxyUrl: selectedProxyUrl,
    proxyController
  });

  const finalDomains = [...discovered].map((domain) => ({
    domain,
    rootDomain: rootForDomain(domain, roots),
    kind: roots.includes(domain) ? "root" : "subdomain",
    source: "recon-summary",
    metadata: { runId }
  }));
  store.saveDomains(runId, targetName, finalDomains);
  store.appendEvent(runId, { phase: "recon", severity: "ok", source: "engine", message: `Recon completed with ${discovered.size} unique domains` });
  return store.updateRun(runId, {
    status: "completed",
    activePhase: "completed",
    finishedAt: new Date().toISOString(),
    checkpoint: { rootDomains: roots, uniqueDomains: discovered.size }
  });
}

async function runHttpFollowup({
  store,
  runId,
  targetName,
  domains,
  screenshotTools = DEFAULT_SCREENSHOT_TOOLS,
  linuxRuntime = "linux",
  useLinuxRunner = true,
  timeoutMs = 180000,
  artifactsDir = path.resolve("data", "recon-runs", String(runId)),
  proxyUrl = null
}) {
  const hosts = [...new Set((domains || []).map(normalizeDomain).filter(Boolean))].sort();
  if (hosts.length === 0) throw new Error("HTTP follow-up requires at least one saved domain");

  // Pre-flight check for httpx availability
  const criticalTools = ["httpx"];
  const allTools = [...criticalTools, ...(screenshotTools || [])];
  const preflightCheck = await preflightCheckToolAvailability({ toolIds: allTools });
  if (preflightCheck.missing.includes("httpx") || preflightCheck.wrongCapability.includes("httpx")) {
    store.appendEvent(runId, {
      phase: "preflight",
      severity: "error",
      source: "preflight-check",
      message: `HTTP follow-up requires httpx, but it is ${preflightCheck.missing.includes("httpx") ? "missing from PATH" : "has wrong identity/capability"}. Run environment setup from Settings > Environment.`,
      payload: preflightCheck
    });
    throw new Error(`Critical tool httpx not available: ${preflightCheck.details.find(d => d.tool_id === "httpx")?.error || "unknown error"}`);
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForRunControl(store, runId);
  store.updateRun(runId, {
    status: "running",
    activePhase: "http-tech-followup",
    checkpoint: { domainCount: hosts.length, screenshotTools, useLinuxRunner }
  });
  store.appendEvent(runId, { phase: "http-tech-followup", severity: "ok", source: "engine", message: `HTTP/tech follow-up started for ${hosts.length} saved domains` });
  appendAiLog(store, runId, "HTTP/Tech follow-up started. I will probe saved domains with httpx, enrich live services with technology detectors, and keep each detector best-effort so one tool failure does not stop the run.", {
    stage: "start",
    domainCount: hosts.length,
    screenshotTools,
    useLinuxRunner
  });

  if (!useLinuxRunner) throw new Error("HTTP follow-up requires the Linux tool runner");
  const proxyController = await createProxyController({ store, runId, proxyUrl, phase: "http-tech-followup" });
  const selectedProxyUrl = proxyController?.bestProxyUrl() || proxyUrl || null;
  if (selectedProxyUrl) {
    store.appendEvent(runId, {
      phase: "http-tech-followup",
      severity: "ok",
      source: "network",
      message: proxyController?.hasPool()
        ? `Automatic proxy rotation enabled. Best preflight proxy: ${redactProxyUrl(selectedProxyUrl)}`
        : `Outbound proxy enabled for Linux recon tools: ${redactProxyUrl(selectedProxyUrl)}`
    });
  }

  store.saveDomains(runId, targetName, hosts.map((domain) => ({
    domain,
    rootDomain: rootForDomain(domain, hosts),
    kind: "domain",
    source: "http-followup-input",
    metadata: { source: "saved-run" }
  })));

  const inputPath = path.join(artifactsDir, "httpx-followup.input.txt");
  fs.writeFileSync(inputPath, hosts.join("\n"), "utf8");
  const args = httpxArgsForInput(inputPath);
  const context = createRunContext();
  store.appendEvent(runId, { phase: "http-tech-followup", source: "httpx", message: `Running httpx against ${hosts.length} saved domains` });
  const result = await runToolWithRecovery({
    store,
    runId,
    phase: "heartbeat",
    source: "httpx",
    heartbeatMessage: (elapsed) => `httpx follow-up is still running (${elapsed}s elapsed)`,
    maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "httpx", args, timeoutMs, proxyUrl: selectedProxyUrl })
  });
  const stdoutPath = writeToolArtifact(artifactsDir, "httpx-followup.stdout.txt", result.stdout);
  const stderrPath = writeToolArtifact(artifactsDir, "httpx-followup.stderr.txt", result.stderr);
  store.recordToolResult(runId, {
    toolName: "httpx",
    commandDisplay: commandDisplay(linuxRuntime, "httpx", args),
    status: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    stdoutPath,
    stderrPath,
    errorMessage: result.errorMessage
  });
  const services = parseHttpxJsonLines(result.stdout);
  store.saveHttpServices(runId, targetName, services, "httpx");
  context.httpServices.push(...services);
  queueToolRecoveryAction(context, {
    id: "retry-httpx-followup",
    phase: "http-tool",
    toolName: "httpx",
    reason: `httpx follow-up ${result.status}${toolFailureDetail(result)}`,
    status: result.status,
    domains: hosts
  }, result);
  store.appendEvent(runId, {
    phase: "http-tech-followup",
    severity: result.status === "completed" ? "ok" : "warn",
    source: "httpx",
    message: `httpx ${result.status}; parsed ${services.length} HTTP services with status/tech${toolFailureDetail(result)}`
  });
  appendAiLog(store, runId, `httpx ${result.status}; ${services.length} live HTTP services were parsed for technology enrichment.`, {
    stage: "httpx",
    status: result.status,
    services: services.length
  });

  await waitForRunControl(store, runId);
  await runTechnologyEnrichment({ store, runId, targetName, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, waitForRunControl, proxyUrl: selectedProxyUrl });
  appendAiLog(store, runId, "Technology enrichment completed. Detector failures, when present, are kept as warnings and the remaining enrichment/screenshot steps continue.", {
    stage: "technology-enrichment",
    services: services.length
  });
  await waitForRunControl(store, runId);
  await collectScreenshots({ store, runId, targetName, screenshotTools, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl: selectedProxyUrl, proxyController });
  await collectTrackers({ store, runId, targetName, services, timeoutMs, artifactsDir });
  await collectFavicons({ store, runId, targetName, services, timeoutMs, artifactsDir });
  await runRecoveryActionPool({
    store,
    runId,
    targetName,
    roots: inferRoots(hosts),
    linuxTools: [],
    linuxRuntime,
    useLinuxRunner,
    timeoutMs,
    artifactsDir,
    context,
    screenshotTools,
    discoveredDomains: hosts,
    proxyUrl: selectedProxyUrl,
    proxyController
  });
  store.appendEvent(runId, { phase: "http-tech-followup", severity: "ok", source: "engine", message: `HTTP/tech follow-up completed with ${services.length} live services` });
  appendAiLog(store, runId, `HTTP/Tech follow-up completed with ${services.length} live services. Review Results tabs for grouped statuses, technologies, URLs, and screenshots.`, {
    stage: "summary",
    services: services.length
  });
  return store.updateRun(runId, {
    status: "completed",
    activePhase: "completed",
    finishedAt: new Date().toISOString(),
    checkpoint: { domainCount: hosts.length, httpServices: services.length }
  });
}

async function runFocusedFollowup({
  store,
  runId,
  targetName,
  phase,
  domains = [],
  services = [],
  rootDomains = [],
  screenshotTools = DEFAULT_SCREENSHOT_TOOLS,
  linuxRuntime = "linux",
  useLinuxRunner = true,
  timeoutMs = 180000,
  artifactsDir = path.resolve("data", "recon-runs", String(runId)),
  proxyUrl = null
}) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  store.updateRun(runId, {
    status: "running",
    activePhase: `follow-up-${phase}`,
    checkpoint: { phase, domainCount: domains.length, serviceCount: services.length }
  });
  store.appendEvent(runId, { phase: `follow-up-${phase}`, severity: "ok", source: "engine", message: `Focused ${phase} follow-up started` });
  if (phase === "urls") {
    if (!useLinuxRunner) throw new Error("URL mining requires the Linux tool runner");
    const roots = rootDomains.length ? rootDomains : inferRoots(domains.map((item) => item.domain || item));
    const proxyController = await createProxyController({ store, runId, proxyUrl, phase: `follow-up-${phase}` });
    const selectedProxyUrl = proxyController?.bestProxyUrl() || proxyUrl || null;
    const discovered = new Set(roots);
    const context = createRunContext();
    await collectLinuxTools({ store, runId, targetName, roots, linuxTools: ["gau"], linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, discovered, context, proxyUrl: selectedProxyUrl, proxyController });
    await runRecoveryActionPool({ store, runId, targetName, roots, linuxTools: ["gau"], linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, screenshotTools, discoveredDomains: discovered, proxyUrl: selectedProxyUrl, proxyController });
    store.updateRun(runId, { status: "completed", activePhase: "completed", finishedAt: new Date().toISOString(), checkpoint: { phase, urls: context.urls.length } });
    return;
  }
  if (phase === "http") {
    await runHttpProbeOnly({ store, runId, targetName, domains, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, proxyUrl });
    return;
  }
  const context = createRunContext({ httpServices: services });
  if (phase === "tech") {
    await runTechnologyEnrichment({ store, runId, targetName, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, waitForRunControl, proxyUrl });
    store.updateRun(runId, { status: "completed", activePhase: "completed", finishedAt: new Date().toISOString(), checkpoint: { phase, services: services.length } });
    return;
  }
  if (phase === "screenshots") {
    const proxyController = useLinuxRunner ? await createProxyController({ store, runId, proxyUrl, phase: `follow-up-${phase}` }) : null;
    const selectedProxyUrl = proxyController?.bestProxyUrl() || proxyUrl || null;
    await collectScreenshots({ store, runId, targetName, screenshotTools, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl: selectedProxyUrl, proxyController });
    await runRecoveryActionPool({ store, runId, targetName, roots: inferRoots(services), linuxTools: [], linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, screenshotTools, discoveredDomains: inferRoots(services), proxyUrl: selectedProxyUrl, proxyController });
    store.updateRun(runId, { status: "completed", activePhase: "completed", finishedAt: new Date().toISOString(), checkpoint: { phase, services: services.length } });
    return;
  }
  if (phase === "trackers") {
    await collectTrackers({ store, runId, targetName, services, timeoutMs, artifactsDir });
    store.updateRun(runId, { status: "completed", activePhase: "completed", finishedAt: new Date().toISOString(), checkpoint: { phase, services: services.length } });
    return;
  }
  if (phase === "favicons") {
    await collectFavicons({ store, runId, targetName, services, timeoutMs, artifactsDir });
    store.updateRun(runId, { status: "completed", activePhase: "completed", finishedAt: new Date().toISOString(), checkpoint: { phase, services: services.length } });
    return;
  }
  throw new Error(`Unsupported focused follow-up phase: ${phase}`);
}

async function runHttpProbeOnly({ store, runId, targetName, domains, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, proxyUrl }) {
  if (!useLinuxRunner) throw new Error("HTTP follow-up requires the Linux tool runner");
  const hosts = [...new Set((domains || []).map((item) => normalizeDomain(item.domain || item)).filter(Boolean))].sort();
  const proxyController = await createProxyController({ store, runId, proxyUrl, phase: "follow-up-http" });
  const selectedProxyUrl = proxyController?.bestProxyUrl() || proxyUrl || null;
  const inputPath = path.join(artifactsDir, "http-focused.input.txt");
  fs.writeFileSync(inputPath, hosts.join("\n"), "utf8");
  const args = httpxArgsForInput(inputPath);
  const context = createRunContext();
  const result = await runToolWithRecovery({
    store,
    runId,
    phase: "heartbeat",
    source: "httpx",
    heartbeatMessage: (elapsed) => `httpx focused follow-up is still running (${elapsed}s elapsed)`,
    maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "httpx", args, timeoutMs, proxyUrl: selectedProxyUrl })
  });
  const stdoutPath = writeToolArtifact(artifactsDir, "http-focused.stdout.txt", result.stdout);
  const stderrPath = writeToolArtifact(artifactsDir, "http-focused.stderr.txt", result.stderr);
  store.recordToolResult(runId, { toolName: "httpx", commandDisplay: commandDisplay(linuxRuntime, "httpx", args), status: result.status, exitCode: result.exitCode, startedAt: result.startedAt, finishedAt: result.finishedAt, stdoutPath, stderrPath, errorMessage: result.errorMessage });
  const services = parseHttpxJsonLines(result.stdout);
  store.saveHttpServices(runId, targetName, services, "httpx");
  context.httpServices.push(...services);
  queueToolRecoveryAction(context, {
    id: "retry-httpx-focused",
    phase: "http-tool",
    toolName: "httpx",
    reason: `httpx focused follow-up ${result.status}${toolFailureDetail(result)}`,
    status: result.status,
    domains: hosts
  }, result);
  store.appendEvent(runId, { phase: "follow-up-http", severity: result.status === "completed" ? "ok" : "warn", source: "httpx", message: `httpx ${result.status}; parsed ${services.length} HTTP services${toolFailureDetail(result)}` });
  await runRecoveryActionPool({ store, runId, targetName, roots: inferRoots(hosts), linuxTools: [], linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, screenshotTools: [], discoveredDomains: hosts, proxyUrl: selectedProxyUrl, proxyController });
  store.updateRun(runId, { status: "completed", activePhase: "completed", finishedAt: new Date().toISOString(), checkpoint: { phase: "http", services: services.length } });
}

async function createProxyController({ store, runId, proxyUrl = null, phase = "recon" }) {
  try {
    const controller = await ProxyRotationController.create({ store, runId, preferredProxyUrl: proxyUrl });
    if (!controller.hasPool() && !proxyUrl) return null;
    return controller;
  } catch (error) {
    store.appendEvent(runId, {
      phase,
      severity: "warn",
      source: "proxy-preflight",
      message: `Proxy preflight/rotation unavailable: ${error.message}. Continuing with the configured network route.`
    });
    return null;
  }
}

function runLinuxToolWithProxy({ proxyController, runtime, toolName, args, timeoutMs, input = null, proxyUrl = null }) {
  if (proxyController?.hasPool()) return proxyController.runTool({ runtime, toolName, args, timeoutMs, input });
  const invocation = buildProxyAwareInvocation({ toolName, args, proxyUrl });
  return runLinuxTool({ runtime, toolName, args: invocation.args, timeoutMs, input, proxyUrl: invocation.envProxyUrl });
}

function appendAiLog(store, runId, message, payload = {}) {
  store.appendEvent(runId, {
    phase: "ai-followup",
    severity: payload.stage === "summary" ? "ok" : "info",
    source: "ai-runbook",
    message,
    payload
  });
}

function createRunContext({ urls = [], httpServices = [], recoveryQueue = [] } = {}) {
  return { urls: [...urls], httpServices: [...httpServices], recoveryQueue, recoveryMode: false };
}

function queueToolRecoveryAction(context, action, result = null) {
  if (!context || context.recoveryMode || !action) return;
  if (result && result.status === "completed") return;
  context.recoveryQueue ||= [];
  const normalized = {
    ...action,
    id: action.id || `retry-${action.toolName || action.phase || "tool"}`,
    source: "tool-result"
  };
  if (context.recoveryQueue.some((item) => item.id === normalized.id)) return;
  context.recoveryQueue.push(normalized);
}

async function collectPassive({ store, runId, targetName, roots, passiveSources, discovered }) {
  const apiKeys = Object.fromEntries(API_PASSIVE_PROVIDERS.map((provider) => [provider, store.getActiveApiKey(provider)]));
  for (const root of roots) {
    for (const source of passiveSources) {
      await waitForRunControl(store, runId);
      store.appendEvent(runId, { phase: "recon", source, message: `Querying passive source for ${root}` });
      try {
        const passiveResult = await runPassiveSource(source, root, { apiKeys });
        const domains = Array.isArray(passiveResult) ? passiveResult : passiveResult.domains || [];
        const metadata = Array.isArray(passiveResult) ? {} : passiveResult.metadata || {};
        for (const domain of domains) discovered.add(domain);
        store.saveDomains(runId, targetName, domains.map((domain) => ({ domain, rootDomain: rootForDomain(domain, roots), kind: domain === root ? "root" : "subdomain", source, metadata })));
        const metadataNote = metadata.reason ? ` (${metadata.reason})` : "";
        store.appendEvent(runId, { phase: "recon", severity: domains.length || !metadata.reason ? "ok" : "warn", source, message: `${source} returned ${domains.length} domains for ${root}${metadataNote}` });
      } catch (error) {
        const activeKey = apiKeys[source];
        const failure = classifyApiFailure(error.message);
        if (activeKey?.id && failure.status === "exhausted") {
          store.updateApiKeyStatus(activeKey.id, "exhausted");
          store.appendEvent(runId, {
            phase: "recon",
            severity: "warn",
            source,
            message: `${source} API appears exhausted or unavailable for the current plan. Replace the key, upgrade/enable the provider, or disable this source.`
          });
        }
        store.appendEvent(runId, { phase: "recon", severity: "warn", source, message: `${source} failed for ${root}: ${error.message}` });
      }
    }
  }
}

async function collectLinuxTools({ store, runId, targetName, roots, linuxTools, linuxRuntime, useLinuxRunner, subdomainWordlistPath, timeoutMs, artifactsDir, discovered, context, proxyUrl = null, proxyController = null }) {
  const collectedResults = [];
  if (!useLinuxRunner) {
    store.appendEvent(runId, { phase: "recon", source: "linux", message: "Linux tools skipped by run configuration" });
    return collectedResults;
  }

  // Verify tool availability before attempting to run them
  const toolSpecs = linuxTools.map(tool => typeof tool === "string" ? tool : tool.name || tool.tool);
  const toolNames = [...new Set(toolSpecs.map(spec => (typeof spec === "string" ? spec.split(":")[0] : spec)))];
  const preflightCheck = await preflightCheckToolAvailability({ toolIds: toolNames });
  if (preflightCheck.missing.length) {
    store.appendEvent(runId, {
      phase: "recon",
      severity: "warn",
      source: "preflight-check",
      message: `Tools unavailable on PATH: ${preflightCheck.missing.join(", ")}. These will be skipped. If you need them, run environment setup from Settings > Environment.`,
      payload: { missing: preflightCheck.missing, details: preflightCheck.details }
    });
  }
  if (preflightCheck.wrongCapability.length) {
    store.appendEvent(runId, {
      phase: "recon",
      severity: "warn",
      source: "preflight-check",
      message: `Tool identity mismatch: ${preflightCheck.wrongCapability.join(", ")}. These tools may be outdated or wrong binaries. Reinstall from Settings > Environment.`,
      payload: { wrongCapability: preflightCheck.wrongCapability, details: preflightCheck.details }
    });
  }

  for (const root of roots) {
    for (const toolSpec of linuxTools) {
      await waitForRunControl(store, runId);
      const spec = parseToolSpec(toolSpec);
      let args;
      try {
        args = argsForTool(spec, root, artifactsDir, discovered, subdomainWordlistPath);
      } catch (error) {
        recordNonBlockingToolError({ store, runId, toolName: spec.name, root, error, context, toolSpec: spec });
        continue;
      }
      if (!args) continue;
      store.appendEvent(runId, { phase: "recon", source: spec.name, message: `Running ${spec.name} for ${root}` });
      let result;
      try {
        result = await runToolWithRecovery({
          store,
          runId,
          phase: "heartbeat",
          source: spec.name,
          heartbeatMessage: (elapsed) => `${spec.name} is still running for ${root} (${elapsed}s elapsed)`,
          maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
          task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: spec.name, args, timeoutMs, proxyUrl })
        });
      } catch (error) {
        recordNonBlockingToolError({ store, runId, toolName: spec.name, root, args, error, linuxRuntime, context, toolSpec: spec });
        continue;
      }
      const stdoutPath = writeToolArtifact(artifactsDir, `${spec.name}-${root}.stdout.txt`, result.stdout);
      const stderrPath = writeToolArtifact(artifactsDir, `${spec.name}-${root}.stderr.txt`, result.stderr);
      store.recordToolResult(runId, {
        toolName: spec.name,
        commandDisplay: commandDisplay(linuxRuntime, spec.name, args),
        status: result.status,
        exitCode: result.exitCode,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        stdoutPath,
        stderrPath,
        errorMessage: result.errorMessage
      });
      collectedResults.push({ toolName: spec.name, root, status: result.status });

      const domains = spec.name === "nmap" ? [] : extractDomains(result.stdout, roots);
      for (const domain of domains) discovered.add(domain);
      store.saveDomains(runId, targetName, domains.map((domain) => ({
        domain,
        rootDomain: rootForDomain(domain, roots),
        kind: domain === root ? "root" : "subdomain",
        source: spec.name,
        metadata: { exitCode: result.exitCode, status: result.status, proxyRotation: result.proxyRotation || null }
      })));
      store.appendEvent(runId, {
        phase: "recon",
        severity: result.status === "completed" ? "ok" : "warn",
        source: spec.name,
        message: `${spec.name} ${result.status}; parsed ${domains.length} domains${toolFailureDetail(result)}`
      });
      queueToolRecoveryAction(context, {
        id: `retry-${spec.name}-${root}`,
        phase: "linux-tool",
        toolName: spec.name,
        toolSpec: spec,
        root,
        reason: `${spec.name} ${result.status} for ${root}${toolFailureDetail(result)}`,
        status: result.status
      }, result);

      if (spec.name === "gau") {
        const urls = parseGauUrls(result.stdout, roots);
        context.urls.push(...urls);
        store.saveUrls(runId, targetName, urls, "gau");
        store.appendEvent(runId, { phase: "recon", severity: "ok", source: "gau", message: `gau parsed ${urls.length} archived URLs and parameters` });
      }

      if (spec.name === "httpx") {
        const services = parseHttpxJsonLines(result.stdout);
        context.httpServices.push(...services);
        store.saveHttpServices(runId, targetName, services, "httpx");
        store.appendEvent(runId, { phase: "recon", severity: services.length ? "ok" : "warn", source: "httpx", message: `httpx parsed ${services.length} HTTP services with status/tech` });
        // If httpx ran with proxy and returned 0 services, queue a direct (no-proxy) retry
        const wasProxied = proxyUrl || proxyController?.hasPool();
        if (services.length === 0 && wasProxied && result.status === "completed") {
          store.appendEvent(runId, { phase: "recon", severity: "warn", source: "httpx", message: `httpx returned 0 services with proxy; queuing direct (no-proxy) retry for ${root}` });
          queueToolRecoveryAction(context, {
            id: `retry-httpx-direct-${root}`,
            phase: "http-tool",
            toolName: "httpx",
            toolSpec: spec,
            root,
            domains: [...discovered],
            reason: `httpx returned 0 services through proxy for ${root}; retrying without proxy`,
            status: "zero_output_with_proxy",
            directOnly: true
          });
        }
      }
    }
  }
  return collectedResults;
}

function recordNonBlockingToolError({ store, runId, toolName, root, args = [], error, linuxRuntime = "linux", context = null, toolSpec = null }) {
  const now = new Date().toISOString();
  store.recordToolResult(runId, { toolName, commandDisplay: commandDisplay(linuxRuntime, toolName, args), status: "failed", exitCode: null, startedAt: now, finishedAt: now, errorMessage: error.message });
  store.appendEvent(runId, { phase: "recon", severity: "warn", source: toolName, message: `${toolName} skipped for ${root}: ${error.message}. Continuing with remaining recon steps.` });
  queueToolRecoveryAction(context, {
    id: `retry-${toolName}-${root}`,
    phase: "linux-tool",
    toolName,
    toolSpec: toolSpec || { name: toolName },
    root,
    reason: `${toolName} failed for ${root}: ${error.message}`,
    status: "failed"
  }, { status: "failed" });
}

function argsForTool(toolSpec, root, artifactsDir, discovered, subdomainWordlistPath = null) {
  const spec = typeof toolSpec === "string" ? parseToolSpec(toolSpec) : toolSpec;
  const toolName = spec.name;
  if (toolName === "subfinder") return ["-d", root, "-silent", "-all"];
  if (toolName === "amass") return ["enum", "-passive", "-d", root];
  if (toolName === "dnsx") {
    const inputPath = path.join(artifactsDir, `dnsx-${root}.input.txt`);
    fs.writeFileSync(inputPath, [...discovered].join("\n"), "utf8");
    return ["-l", toLinuxPath(inputPath), "-silent", "-a", "-aaaa", "-cname"];
  }
  if (toolName === "puredns") {
    const inputPath = path.join(artifactsDir, `puredns-${root}.input.txt`);
    fs.writeFileSync(inputPath, [...discovered].join("\n"), "utf8");
    return ["resolve", toLinuxPath(inputPath), "--write", "-"];
  }
  if (toolName === "shuffle-dns" && subdomainWordlistPath) return ["-d", root, "-w", toLinuxPath(subdomainWordlistPath), "-silent"];
  if (toolName === "gau") return [root];
  if (toolName === "httpx") {
    const inputPath = path.join(artifactsDir, `httpx-${root}.input.txt`);
    const hosts = [...discovered].sort();
    fs.writeFileSync(inputPath, hosts.join("\n"), "utf8");
    return httpxArgsForInput(inputPath, spec.ports);
  }
  if (toolName === "nmap") {
    const inputPath = path.join(artifactsDir, `nmap-${root}.input.txt`);
    const hosts = [...discovered].sort();
    fs.writeFileSync(inputPath, hosts.join("\n"), "utf8");
    return ["-iL", toLinuxPath(inputPath), "-p", uniquePorts(spec.ports || DEFAULT_HTTPX_PORTS).join(","), "-sV", "--open", "-T3", "-oA", toLinuxPath(path.join(artifactsDir, `nmap-${root}`))];
  }
  return null;
}

function parseToolSpec(value) {
  if (typeof value === "object" && value) {
    return { name: String(value.name || value.tool || ""), ports: resolveHttpPorts(value) };
  }
  const raw = String(value || "");
  const [name, encoded] = raw.split(":", 2);
  return { name, ports: encoded ? resolveHttpPorts({ customPorts: encoded }) : DEFAULT_HTTPX_PORTS };
}

function resolveHttpPorts({ preset = "medium", customPorts = "", ports = null } = {}) {
  if (Array.isArray(ports)) return uniquePorts(ports).length ? uniquePorts(ports) : DEFAULT_HTTPX_PORTS;
  const custom = parsePortList(customPorts);
  if (custom.length) return custom;
  return HTTPX_PORT_PRESETS[preset] || DEFAULT_HTTPX_PORTS;
}

function parsePortList(value) {
  return uniquePorts(String(value || "").split(/[^0-9]+/).filter(Boolean));
}

function httpxArgsForInput(inputPath, ports = DEFAULT_HTTPX_PORTS) {
  return ["-l", toLinuxPath(inputPath), "-ports", uniquePorts(ports).join(","), "-json", "-silent", "-status-code", "-title", "-tech-detect", "-follow-host-redirects"];
}

function uniquePorts(ports) {
  return [...new Set((ports || []).map((port) => Number.parseInt(port, 10)).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))];
}

function inferRoots(domains) {
  const roots = new Set();
  for (const value of domains || []) {
    const domain = normalizeDomain(value?.domain || value?.host || value);
    if (!domain) continue;
    const parts = domain.split(".");
    roots.add(parts.length > 2 ? parts.slice(-2).join(".") : domain);
  }
  return [...roots].sort();
}

async function collectScreenshots({ store, runId, targetName, screenshotTools, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl = null, proxyController = null }) {
  if (!useLinuxRunner || screenshotTools.length === 0 || context.httpServices.length === 0) return;
  const liveUrls = [...new Set(context.httpServices.map((service) => service.url).filter(Boolean))].sort();
  const inputPath = path.join(artifactsDir, "screenshots.input.txt");
  fs.writeFileSync(inputPath, liveUrls.join("\n"), "utf8");

  for (const toolName of screenshotTools) {
    await waitForRunControl(store, runId);
    const outputDir = path.join(artifactsDir, "screenshots", toolName);
    fs.mkdirSync(outputDir, { recursive: true });
    const args = screenshotArgsForTool(toolName, inputPath, outputDir);
    if (!args) continue;
    store.appendEvent(runId, { phase: "recon", source: toolName, message: `Capturing screenshots for ${liveUrls.length} live URLs` });
    const result = await runToolWithRecovery({
      store,
      runId,
      phase: "heartbeat",
      source: toolName,
      heartbeatMessage: (elapsed) => `${toolName} screenshot capture is still running (${elapsed}s elapsed)`,
      maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
      task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName, args, timeoutMs, proxyUrl, input: toolName === "aquatone" ? `${liveUrls.join("\n")}\n` : null })
    });
    const stdoutPath = writeToolArtifact(artifactsDir, `${toolName}-screenshots.stdout.txt`, result.stdout);
    const stderrPath = writeToolArtifact(artifactsDir, `${toolName}-screenshots.stderr.txt`, result.stderr);
    store.recordToolResult(runId, { toolName, commandDisplay: commandDisplay(linuxRuntime, toolName, args), status: result.status, exitCode: result.exitCode, startedAt: result.startedAt, finishedAt: result.finishedAt, stdoutPath, stderrPath, errorMessage: result.errorMessage });
    const screenshotCount = countScreenshotFiles(outputDir);
    store.saveScreenshotRun(runId, targetName, { toolName, outputDir, reportPath: findScreenshotReport(outputDir), metadata: { status: result.status, exitCode: result.exitCode, urlCount: liveUrls.length, screenshotCount, proxyRotation: result.proxyRotation || null } });
    store.appendEvent(runId, { phase: "recon", severity: result.status === "completed" ? "ok" : "warn", source: toolName, message: `${toolName} screenshot run ${result.status}` });
    queueToolRecoveryAction(context, {
      id: `retry-screenshot-tool-${toolName}`,
      phase: "screenshot-tool",
      toolName,
      reason: `${toolName} screenshot run ${result.status}${toolFailureDetail(result)}`,
      status: result.status,
      screenshotCount
    }, result);
  }
}

async function collectTrackers({ store, runId, targetName, services, timeoutMs, artifactsDir }) {
  const liveServices = [...new Map((services || []).filter((service) => service?.url).map((service) => [String(service.url).toLowerCase(), service])).values()];
  if (liveServices.length === 0) {
    store.appendEvent(runId, { phase: "tracker-extraction", severity: "info", source: "tracker-extraction", message: "Analytics/pixel extraction skipped because no live HTTP services are available." });
    return { findingCount: 0, checkedCount: 0 };
  }
  store.appendEvent(runId, { phase: "tracker-extraction", severity: "info", source: "tracker-extraction", message: `Checking ${liveServices.length} live services for analytics and pixel IDs.` });
  const findings = await extractTrackersFromServices({ services: liveServices, timeoutMs: Math.min(Number(timeoutMs || 12000), 15000) });
  const artifactPath = writeToolArtifact(artifactsDir, "tracker-findings.json", JSON.stringify({ targetName, checked: liveServices.length, findings }, null, 2));
  const successfulFindings = findings.filter((finding) => finding.vendor !== "tracker-fetch");
  store.appendEvent(runId, {
    phase: "tracker-extraction",
    severity: successfulFindings.length ? "ok" : "warn",
    source: "tracker-extraction",
    message: `Analytics/pixel extraction completed with ${successfulFindings.length} findings across ${liveServices.length} services.`,
    payload: { artifactPath, findingCount: successfulFindings.length, checkedCount: liveServices.length }
  });
  if (successfulFindings.length) {
    store.saveUrls(runId, targetName, successfulFindings.map((finding) => ({
      url: finding.url,
      host: finding.host,
      path: "",
      query: "",
      params: [],
      metadata: { trackerVendor: finding.vendor, trackerId: finding.id }
    })), "tracker-extraction");
  }
  return { findingCount: successfulFindings.length, checkedCount: liveServices.length };
}

async function collectFavicons({ store, runId, targetName, services, timeoutMs, artifactsDir }) {
  const liveServices = [...new Map((services || []).filter((service) => service?.url).map((service) => [String(service.url).toLowerCase(), service])).values()];
  if (liveServices.length === 0) {
    store.appendEvent(runId, { phase: "favicon-fingerprint", severity: "info", source: "favicon-fingerprint", message: "Favicon fingerprinting skipped because no live HTTP services are available." });
    return { findingCount: 0, checkedCount: 0 };
  }
  store.appendEvent(runId, { phase: "favicon-fingerprint", severity: "info", source: "favicon-fingerprint", message: `Checking ${liveServices.length} live services for favicons.` });
  const findings = await extractFaviconsFromServices({ services: liveServices, timeoutMs: Math.min(Number(timeoutMs || 12000), 15000) });
  const artifactPath = writeToolArtifact(artifactsDir, "favicon-findings.json", JSON.stringify({ targetName, checked: liveServices.length, findings }, null, 2));
  store.appendEvent(runId, {
    phase: "favicon-fingerprint",
    severity: findings.length ? "ok" : "warn",
    source: "favicon-fingerprint",
    message: `Favicon fingerprinting completed with ${findings.length} hashes across ${liveServices.length} services.`,
    payload: { artifactPath, findingCount: findings.length, checkedCount: liveServices.length }
  });
  if (findings.length) {
    store.saveUrls(runId, targetName, findings.map((finding) => ({
      url: finding.faviconUrl,
      host: finding.host,
      path: "",
      query: "",
      params: [],
      metadata: { faviconSha256: finding.sha256, byteLength: finding.byteLength, contentType: finding.contentType, pageUrl: finding.url }
    })), "favicon-fingerprint");
  }
  return { findingCount: findings.length, checkedCount: liveServices.length };
}

async function runRecoveryActionPool({
  store,
  runId,
  targetName,
  roots,
  linuxTools,
  linuxRuntime,
  useLinuxRunner,
  timeoutMs,
  artifactsDir,
  context,
  screenshotTools,
  discoveredDomains = roots,
  subdomainWordlistPath = null,
  proxyUrl = null,
  proxyController = null,
  maxRecoveryAttempts = 2
}) {
  const actions = buildRecoveryActions({ roots, linuxTools, useLinuxRunner, context, screenshotTools, artifactsDir });
  store.appendEvent(runId, {
    phase: "ai-action-pool",
    severity: actions.length ? "info" : "ok",
    source: "ai-action-pool",
    message: actions.length
      ? `AI action pool queued ${actions.length} incomplete recon phase${actions.length === 1 ? "" : "s"} for retry.`
      : "AI action pool checked recon phases: no incomplete follow-up action is required.",
    payload: { actions }
  });
  context.recoveryMode = true;
  let completedActions = 0;
  let incompleteActions = 0;
  for (const action of actions) {
    await waitForRunControl(store, runId);
    // Safety: limit retry attempts to prevent infinite recovery loops
    if (!action.attemptCount) action.attemptCount = 0;
    if (action.attemptCount >= maxRecoveryAttempts) {
      store.appendEvent(runId, {
        phase: "ai-action-pool",
        severity: "warn",
        source: "ai-action-pool",
        message: `Recovery action ${action.id} exhausted after ${action.attemptCount} attempts. Marking as incomplete and continuing.`,
        payload: { action, status: "exhausted" }
      });
      incompleteActions += 1;
      continue;
    }
    action.attemptCount += 1;
    store.appendEvent(runId, {
      phase: "ai-action-pool",
      severity: "info",
      source: "ai-action-pool",
      message: `Running recovery action ${action.id} (attempt ${action.attemptCount}/${maxRecoveryAttempts}): ${action.reason}`,
      payload: { action, status: "running" }
    });
    try {
      if (action.phase === "urls") {
        const discovered = new Set(discoveredDomains || roots);
        const results = await collectLinuxTools({ store, runId, targetName, roots, linuxTools: ["gau"], linuxRuntime, useLinuxRunner, subdomainWordlistPath, timeoutMs, artifactsDir, discovered, context, proxyUrl, proxyController });
        action.completed = results.some((item) => item.status === "completed") || context.urls.length > 0;
      }
      if (action.phase === "linux-tool") {
        const discovered = new Set(discoveredDomains || roots);
        const retryRoots = action.root ? [action.root] : roots;
        const results = await collectLinuxTools({ store, runId, targetName, roots: retryRoots, linuxTools: [action.toolSpec || action.toolName], linuxRuntime, useLinuxRunner, subdomainWordlistPath, timeoutMs, artifactsDir, discovered, context, proxyUrl, proxyController });
        action.completed = results.some((item) => item.toolName === action.toolName && item.status === "completed");
      }
      if (action.phase === "http-tool") {
        const useDirectOnly = action.directOnly === true;
        action.completed = await retryHttpToolAction({ store, runId, targetName, domains: action.domains || discoveredDomains || roots, linuxRuntime, timeoutMs, artifactsDir, context, proxyUrl: useDirectOnly ? null : proxyUrl, proxyController: useDirectOnly ? null : proxyController });
      }
      if (action.phase === "screenshots") {
        await collectScreenshots({ store, runId, targetName, screenshotTools, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl, proxyController });
      }
      if (action.phase === "screenshot-tool") {
        await collectScreenshots({ store, runId, targetName, screenshotTools: [action.toolName], linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl, proxyController });
      }
      if (action.phase === "trackers") {
        await collectTrackers({ store, runId, targetName, services: context.httpServices, timeoutMs, artifactsDir });
      }
      if (action.phase === "favicons") {
        await collectFavicons({ store, runId, targetName, services: context.httpServices, timeoutMs, artifactsDir });
      }
      const completed = recoveryActionCompleted(action, { context, artifactsDir });
      if (completed) {
        completedActions += 1;
      } else {
        incompleteActions += 1;
      }
      store.appendEvent(runId, {
        phase: "ai-action-pool",
        severity: completed ? "ok" : "warn",
        source: "ai-action-pool",
        message: completed
          ? `Recovery action ${action.id} completed (attempt ${action.attemptCount}).`
          : `Recovery action ${action.id} ran (attempt ${action.attemptCount}) but the expected output is still missing.`,
        payload: { action, status: completed ? "completed" : "incomplete", attempt: action.attemptCount, maxAttempts: maxRecoveryAttempts }
      });
    } catch (error) {
      incompleteActions += 1;
      store.appendEvent(runId, {
        phase: "ai-action-pool",
        severity: "warn",
        source: "ai-action-pool",
        message: `Recovery action ${action.id} failed (attempt ${action.attemptCount}): ${error.message}`,
        payload: { action, status: "failed" }
      });
    }
  }
  context.recoveryMode = false;
  store.appendEvent(runId, {
    phase: "ai-action-pool",
    severity: incompleteActions > 0 ? "warn" : "ok",
    source: "ai-action-pool",
    message: `Recovery action pool completed: ${completedActions} actions succeeded, ${incompleteActions} incomplete or exhausted.`,
    payload: { completedActions, incompleteActions, totalActions: actions.length }
  });
}

async function retryHttpToolAction({ store, runId, targetName, domains, linuxRuntime, timeoutMs, artifactsDir, context, proxyUrl = null, proxyController = null }) {
  const hosts = [...new Set((domains || []).map((item) => normalizeDomain(item?.domain || item?.host || item)).filter(Boolean))].sort();
  if (hosts.length === 0) return false;
  const inputPath = path.join(artifactsDir, "httpx-recovery.input.txt");
  fs.writeFileSync(inputPath, hosts.join("\n"), "utf8");
  const args = httpxArgsForInput(inputPath);
  const result = await runToolWithRecovery({
    store,
    runId,
    phase: "heartbeat",
    source: "httpx",
    heartbeatMessage: (elapsed) => `httpx recovery is still running (${elapsed}s elapsed)`,
    maxAttempts: 1,
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "httpx", args, timeoutMs, proxyUrl })
  });
  const stdoutPath = writeToolArtifact(artifactsDir, "httpx-recovery.stdout.txt", result.stdout);
  const stderrPath = writeToolArtifact(artifactsDir, "httpx-recovery.stderr.txt", result.stderr);
  store.recordToolResult(runId, {
    toolName: "httpx",
    commandDisplay: commandDisplay(linuxRuntime, "httpx", args),
    status: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    stdoutPath,
    stderrPath,
    errorMessage: result.errorMessage
  });
  const services = parseHttpxJsonLines(result.stdout);
  if (services.length) {
    context.httpServices.push(...services);
    store.saveHttpServices(runId, targetName, services, "httpx-recovery");
  }
  store.appendEvent(runId, {
    phase: "ai-action-pool",
    severity: result.status === "completed" ? "ok" : "warn",
    source: "httpx",
    message: `httpx recovery ${result.status}; parsed ${services.length} HTTP services${toolFailureDetail(result)}`
  });
  return result.status === "completed";
}

function buildRecoveryActions({ roots, linuxTools, useLinuxRunner, context, screenshotTools, artifactsDir }) {
  const enabledTools = new Set((linuxTools || []).map((tool) => parseToolSpec(tool).name));
  const actions = [...(context.recoveryQueue || [])];
  if (useLinuxRunner && enabledTools.has("gau") && roots.length && context.urls.length === 0) {
    addRecoveryAction(actions, { id: "retry-url-params", phase: "urls", reason: "URL and parameter mining produced no saved URLs." });
  }
  if ((screenshotTools || []).length && context.httpServices.length && countAllScreenshots(path.join(artifactsDir, "screenshots")) === 0) {
    addRecoveryAction(actions, { id: "retry-screenshots", phase: "screenshots", reason: "Screenshot capture produced no image files." });
  }
  if (context.httpServices.length && !fs.existsSync(path.join(artifactsDir, "tracker-findings.json"))) {
    addRecoveryAction(actions, { id: "extract-trackers", phase: "trackers", reason: "Analytics/pixel extraction has not produced an artifact yet." });
  }
  if (context.httpServices.length && !fs.existsSync(path.join(artifactsDir, "favicon-findings.json"))) {
    addRecoveryAction(actions, { id: "extract-favicons", phase: "favicons", reason: "Favicon fingerprinting has not produced an artifact yet." });
  }
  return actions;
}

function addRecoveryAction(actions, action) {
  if (!actions.some((item) => item.id === action.id)) actions.push(action);
}

function recoveryActionCompleted(action, { context, artifactsDir }) {
  if (typeof action.completed === "boolean") return action.completed;
  if (action.phase === "urls") return context.urls.length > 0;
  if (action.phase === "screenshots") {
    const count = countAllScreenshots(path.join(artifactsDir, "screenshots"));
    return count > 0;
  }
  if (action.phase === "screenshot-tool") {
    const count = countAllScreenshots(path.join(artifactsDir, "screenshots", action.toolName));
    return count > 0;
  }
  if (action.phase === "trackers") {
    const path_trackers = path.join(artifactsDir, "tracker-findings.json");
    if (!fs.existsSync(path_trackers)) return false;
    // Also check that file is not empty
    const stats = fs.statSync(path_trackers);
    if (stats.size < 20) return false; // Too small to be valid JSON
    try {
      const content = JSON.parse(fs.readFileSync(path_trackers, "utf8"));
      return Array.isArray(content.findings) && content.findings.length > 0;
    } catch {
      return false;
    }
  }
  if (action.phase === "favicons") {
    const path_favicons = path.join(artifactsDir, "favicon-findings.json");
    if (!fs.existsSync(path_favicons)) return false;
    const stats = fs.statSync(path_favicons);
    if (stats.size < 20) return false;
    try {
      const content = JSON.parse(fs.readFileSync(path_favicons, "utf8"));
      return Array.isArray(content.findings) && content.findings.length > 0;
    } catch {
      return false;
    }
  }
  return true;
}

function countAllScreenshots(outputRoot) {
  return countScreenshotFiles(outputRoot);
}

async function runToolWithHeartbeat({ store, runId, phase, source, heartbeatMessage, task }) {
  let heartbeatCount = 0;
  const heartbeat = setInterval(() => {
    heartbeatCount += 1;
    store.appendEvent(runId, { phase, source, message: heartbeatMessage(heartbeatCount * 15) });
  }, 15000);
  try {
    return await task();
  } finally {
    clearInterval(heartbeat);
  }
}

async function runToolWithRecovery({ store, runId, phase, source, heartbeatMessage, task, maxAttempts = DEFAULT_TOOL_RECOVERY_ATTEMPTS, retryDelayMs = 2000 }) {
  const attempts = Math.max(1, Number.parseInt(maxAttempts, 10) || 1);
  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runToolWithHeartbeat({ store, runId, phase, source, heartbeatMessage, task });
    result.recovery = { attempt, maxAttempts: attempts, retried: attempt > 1 };
    lastResult = result;
    const retryable = shouldRetryToolResult(result);
    if (!retryable) {
      if (attempt > 1) appendAiToolRecovery(store, runId, {
        stage: "recovered",
        toolName: source,
        attempt,
        maxAttempts: attempts,
        reason: "tool completed after retry"
      });
      return result;
    }
    if (attempt >= attempts) {
      appendAiToolRecovery(store, runId, {
        stage: "exhausted",
        toolName: source,
        attempt,
        maxAttempts: attempts,
        reason: retryable
      });
      return result;
    }
    appendAiToolRecovery(store, runId, {
      stage: "retrying",
      toolName: source,
      attempt,
      maxAttempts: attempts,
      reason: retryable
    });
    await sleep(retryDelayMs);
  }
  return lastResult;
}

function shouldRetryToolResult(result) {
  if (!result) return "no tool result";
  if (result.status === "timeout") return result.errorMessage || "tool timeout";
  if (result.status === "error") return result.errorMessage || "tool runner error";
  const combined = [result.stderr, result.errorMessage, result.stdout].filter(Boolean).join("\n").slice(0, 20000);
  if (result.status === "failed" && TOOL_RECOVERY_PATTERNS.some((pattern) => pattern.test(combined))) {
    return firstUsefulLine(combined) || "transient network/tool failure";
  }
  return "";
}

function appendAiToolRecovery(store, runId, { stage, toolName, attempt, maxAttempts, reason }) {
  const messages = {
    retrying: `${toolName} looks stalled or hit a transient tool/network error. I am retrying it (${attempt + 1}/${maxAttempts}) while the run keeps its current context.`,
    recovered: `${toolName} recovered after retry (${attempt}/${maxAttempts}). I will keep the recovered output and continue the run.`,
    exhausted: `${toolName} still failed after ${attempt}/${maxAttempts} attempts. I will keep partial artifacts, mark it as warning, and continue with non-blocking steps.`
  };
  store.appendEvent(runId, {
    phase: "ai-tool-recovery",
    severity: stage === "recovered" ? "ok" : "warn",
    source: "ai-tool-recovery",
    message: messages[stage] || `${toolName} recovery update: ${stage}`,
    payload: { stage, toolName, attempt, maxAttempts, reason }
  });
}

async function waitForRunControl(store, runId) {
  let run = store.getRun(runId);
  if (!run) throw new RunControlError("cancelled", "Run no longer exists");
  if (run.status === "cancelled") throw new RunControlError("cancelled", "Run cancelled by user");
  if (run.status !== "paused") return;
  store.appendEvent(runId, { phase: "control", severity: "warn", source: "engine", message: "Run paused. Waiting for resume or cancel." });
  while (RUN_CONTROL_STATUSES.has(run.status)) {
    await sleep(1000);
    run = store.getRun(runId);
    if (!run || run.status === "cancelled") throw new RunControlError("cancelled", "Run cancelled by user");
    if (run.status !== "paused") {
      store.appendEvent(runId, { phase: "control", severity: "ok", source: "engine", message: "Run resumed." });
      return;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RunControlError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "RunControlError";
    this.status = status;
  }
}

function isRunControlError(error) {
  return error?.name === "RunControlError";
}

function screenshotArgsForTool(toolName, inputPath, outputDir) {
  if (toolName === "gowitness") return ["scan", "file", "-f", toLinuxPath(inputPath), "--screenshot-path", toLinuxPath(outputDir), "--write-jsonl"];
  if (toolName === "aquatone") return ["-out", toLinuxPath(outputDir), "-ports", "xlarge", "-scan-timeout", "3000"];
  if (toolName === "eyewitness") return ["--web", "-f", toLinuxPath(inputPath), "-d", toLinuxPath(outputDir), "--no-prompt"];
  return null;
}

function findScreenshotReport(outputDir) {
  const candidates = [path.join(outputDir, "gowitness.sqlite3"), path.join(outputDir, "aquatone_report.html"), path.join(outputDir, "report.html")];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function countScreenshotFiles(outputDir) {
  if (!fs.existsSync(outputDir)) return 0;
  return fs.readdirSync(outputDir, { recursive: true }).filter((entry) => /\.(png|jpe?g|webp)$/i.test(String(entry))).length;
}

function toLinuxPath(localPath) {
  if (String(localPath).startsWith("/")) return localPath;
  return path.resolve(localPath).replaceAll("\\", "/");
}

function toolFailureDetail(result) {
  if (result.status === "completed") return "";
  const detail = firstUsefulLine(result.stderr || result.errorMessage || result.stdout);
  return detail ? `; ${detail}` : "";
}

function firstUsefulLine(value) {
  return String(value || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 240) || "";
}

function writeToolArtifact(dir, name, content) {
  const filePath = path.join(dir, name.replaceAll(/[^a-z0-9_.-]/gi, "_"));
  fs.writeFileSync(filePath, content || "", "utf8");
  return filePath;
}

module.exports = {
  DEFAULT_HTTPX_PORTS,
  DEFAULT_PASSIVE_SOURCES,
  DEFAULT_SCREENSHOT_TOOLS,
  DEFAULT_LINUX_TOOLS,
  HTTPX_PORT_PRESETS,
  buildRecoveryActions,
  httpxArgsForInput,
  isRunControlError,
  parsePortList,
  parseToolSpec,
  resolveHttpPorts,
  runFocusedFollowup,
  runHttpFollowup,
  runRecon,
  shouldRetryToolResult,
  uniquePorts
};
