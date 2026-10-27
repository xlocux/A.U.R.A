"use strict";

const fs = require("node:fs");
const { normalizeDomain, rootForDomain } = require("../domain-utils");
const { runTechnologyEnrichment } = require("../technology-detectors");
const { checkToolAvailability, collectLinuxTools, collectPassive, createRunContext, queueToolRecoveryAction } = require("./discovery");
const { DEFAULT_LINUX_TOOLS, DEFAULT_PASSIVE_SOURCES, DEFAULT_SCREENSHOT_TOOLS, TOOL_RAN_STATUSES } = require("./constants");
const { runRecoveryActionPool } = require("./recovery-pool");
const { completeRun, waitForRunControl } = require("./run-control");
const { inferRoots, normalizeHosts, parseToolSpec } = require("./tool-args");
const { announceProxy, appendAiLog, createProxyController, runHttpxOnHosts, toolFailureDetail } = require("./tool-execution");
const { collectFavicons, collectScreenshots, collectTrackers } = require("./web-collectors");
const { runBypass403, runCloudEnum, runDirectoryDiscovery, runJsDiscovery } = require("./cloud-dirs");
const { runKatanaCrawl, runTlsxGrab, runSubzyTakeover, runWaymore, runParamSpider } = require("./recon-extra-tools");
const { runVulnAssessment } = require("./vuln-assessment");

const DEFAULT_TIMEOUT_MS = 180000;

async function setUpNetwork({ store, runId, phase, proxyUrl, useProxyPool, useLinuxRunner }) {
  const proxyController = useLinuxRunner ? await createProxyController({ store, runId, proxyUrl, useProxyPool, phase }) : null;
  const selectedProxyUrl = proxyController?.bestProxyUrl() || proxyUrl || null;
  announceProxy(store, runId, phase, proxyController, selectedProxyUrl);
  return { proxyController, selectedProxyUrl };
}

// Web-facing enrichment shared by full recon and HTTP follow-ups.
async function runWebEnrichment({ store, runId, targetName, services, screenshotTools, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl, proxyController }) {
  await waitForRunControl(store, runId);
  await runTechnologyEnrichment({ store, runId, targetName, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, waitForRunControl, proxyUrl });
  await waitForRunControl(store, runId);
  await collectScreenshots({ store, runId, targetName, screenshotTools, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, queueRecovery: queueToolRecoveryAction, proxyUrl, proxyController });
  await waitForRunControl(store, runId);
  await collectTrackers({ store, runId, targetName, services, timeoutMs, artifactsDir, proxyUrl });
  await waitForRunControl(store, runId);
  await collectFavicons({ store, runId, targetName, services, timeoutMs, artifactsDir, proxyUrl });
}

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
  timeoutMs = DEFAULT_TIMEOUT_MS,
  artifactsDir,
  proxyUrl = null,
  useProxyPool = false,
  runFfuf = false,
  runCloudEnum: cloudEnumEnabled = false,
  runBypass403: bypass403Enabled = false,
  runGetJs = false,
  runKatana = false,
  runTlsx = false,
  runSubzy = false,
  runWaymore = false,
  runParamSpider = false,
  runNuclei = false,
  nvdApiKey = null
}) {
  const roots = [...new Set((rootDomains || []).map(normalizeDomain).filter(Boolean))];
  if (roots.length === 0) throw new Error("Recon requires at least one valid root domain");
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForRunControl(store, runId);
  store.updateRun(runId, {
    status: "running",
    activePhase: "recon",
    checkpoint: { rootDomains: roots, passiveSources, linuxTools, screenshotTools, useLinuxRunner, subdomainWordlistPath }
  });
  store.appendEvent(runId, { phase: "recon", source: "engine", message: `Recon started for ${roots.join(", ")}` });

  const context = createRunContext();
  if (useLinuxRunner) {
    const toolNames = [...linuxTools.map((tool) => parseToolSpec(tool).name), ...screenshotTools];
    await checkToolAvailability({ store, runId, toolNames, context });
  }
  const { proxyController, selectedProxyUrl } = await setUpNetwork({ store, runId, phase: "recon", proxyUrl, useProxyPool, useLinuxRunner });
  try {
    const discovered = new Set(roots);
    await collectPassive({ store, runId, targetName, roots, passiveSources, discovered });
    await waitForRunControl(store, runId);
    const shared = { store, runId, targetName, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl: selectedProxyUrl, proxyController };
    await collectLinuxTools({ ...shared, roots, linuxTools, subdomainWordlistPath, discovered });
    await runWebEnrichment({ ...shared, services: context.httpServices, screenshotTools });
    await runRecoveryActionPool({ ...shared, roots, linuxTools, screenshotTools, discoveredDomains: discovered, subdomainWordlistPath });

    if (useLinuxRunner && runFfuf) {
      await waitForRunControl(store, runId);
      const pathsWordlist = store.getActiveWordlist("paths");
      await runDirectoryDiscovery({ ...shared, services: context.httpServices, wordlistPath: pathsWordlist?.path || null });
    }
    if (useLinuxRunner && cloudEnumEnabled) {
      await waitForRunControl(store, runId);
      await runCloudEnum({ ...shared, domains: [...discovered].map((domain) => ({ domain })), urls: context.urls.concat(context.httpServices) });
    }
    if (useLinuxRunner && bypass403Enabled) {
      await waitForRunControl(store, runId);
      await runBypass403({ ...shared, services: context.httpServices });
    }
    if (useLinuxRunner && runGetJs) {
      await waitForRunControl(store, runId);
      await runJsDiscovery({ ...shared, services: context.httpServices });
    }
    if (useLinuxRunner && runTlsx) {
      await waitForRunControl(store, runId);
      const tlsDomains = await runTlsxGrab({ ...shared, hosts: [...discovered], rootDomains: roots });
      // Cert-derived hostnames feed the discovered set so summary/later phases include them.
      if (tlsDomains) for (const row of store.listDomains({ runId, limit: 100000 })) if (row.source === "tlsx" && row.domain) discovered.add(row.domain);
    }
    if (useLinuxRunner && runKatana) {
      await waitForRunControl(store, runId);
      await runKatanaCrawl({ ...shared, services: context.httpServices });
    }
    if (useLinuxRunner && runSubzy) {
      await waitForRunControl(store, runId);
      await runSubzyTakeover({ ...shared, hosts: [...discovered] });
    }
    if (useLinuxRunner && runWaymore) {
      await waitForRunControl(store, runId);
      await runWaymore({ ...shared, domains: roots });
    }
    if (useLinuxRunner && runParamSpider) {
      await waitForRunControl(store, runId);
      await runParamSpider({ ...shared, domains: roots });
    }

    // End-of-recon vulnerability assessment: optional nuclei scan (Full tier) + NVD CVE correlation
    // of detected software versions. Best-effort — it never throws, so it can't fail the run.
    if (useLinuxRunner) {
      await waitForRunControl(store, runId);
      await runVulnAssessment({
        ...shared,
        services: context.httpServices,
        technologies: store.listTechnologySummary ? store.listTechnologySummary({ runId, limit: 500 }) : [],
        runNuclei,
        nvdApiKey
      });
    }

    // Only roots: every other domain was already saved by the tool that found it (no doubled rows).
    store.saveDomains(runId, targetName, [...discovered].filter((domain) => roots.includes(domain)).map((domain) => ({
      domain,
      rootDomain: rootForDomain(domain, roots),
      kind: roots.includes(domain) ? "root" : "subdomain",
      source: "recon-summary",
      metadata: { runId }
    })));
    store.appendEvent(runId, { phase: "recon", severity: "ok", source: "engine", message: `Recon completed with ${discovered.size} unique domains` });
    return await completeRun(store, runId, { rootDomains: roots, uniqueDomains: discovered.size });
  } finally {
    proxyController?.close();
  }
}

async function runHttpFollowup({
  store,
  runId,
  targetName,
  domains,
  screenshotTools = DEFAULT_SCREENSHOT_TOOLS,
  linuxRuntime = "linux",
  useLinuxRunner = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  artifactsDir,
  proxyUrl = null,
  useProxyPool = false
}) {
  const hosts = normalizeHosts(domains);
  if (hosts.length === 0) throw new Error("HTTP follow-up requires at least one saved domain");
  if (!useLinuxRunner) throw new Error("HTTP follow-up requires the Linux tool runner");
  const context = createRunContext();
  await checkToolAvailability({ store, runId, toolNames: ["httpx", ...screenshotTools], context });
  if (context.unavailableTools.has("httpx")) {
    throw new Error("HTTP follow-up requires httpx, but it is missing from PATH. Run environment setup from Settings > Environment.");
  }
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForRunControl(store, runId);
  store.updateRun(runId, { status: "running", activePhase: "http-tech-followup", checkpoint: { domainCount: hosts.length, screenshotTools, useLinuxRunner } });
  store.appendEvent(runId, { phase: "http-tech-followup", severity: "ok", source: "engine", message: `HTTP/tech follow-up started for ${hosts.length} saved domains` });
  appendAiLog(store, runId, "HTTP/Tech follow-up started. I will probe saved domains with httpx, enrich live services with technology detectors, and keep each detector best-effort so one tool failure does not stop the run.", {
    stage: "start",
    domainCount: hosts.length,
    screenshotTools,
    useLinuxRunner
  });

  const { proxyController, selectedProxyUrl } = await setUpNetwork({ store, runId, phase: "http-tech-followup", proxyUrl, useProxyPool, useLinuxRunner });
  try {
    store.saveDomains(runId, targetName, hosts.map((domain) => ({ domain, rootDomain: rootForDomain(domain, hosts), kind: "domain", source: "http-followup-input", metadata: { source: "saved-run" } })));
    const shared = { store, runId, targetName, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl: selectedProxyUrl, proxyController };
    store.appendEvent(runId, { phase: "http-tech-followup", source: "httpx", message: `Running httpx against ${hosts.length} saved domains` });
    const { result, services } = await runHttpxOnHosts({ ...shared, hosts, artifactName: "httpx-followup", label: "httpx follow-up" });
    context.httpServices.push(...services);
    queueToolRecoveryAction(context, { id: "retry-httpx-followup", phase: "http-tool", toolName: "httpx", reason: `httpx follow-up ${result.status}${toolFailureDetail(result)}`, status: result.status, domains: hosts }, result);
    store.appendEvent(runId, {
      phase: "http-tech-followup",
      severity: result.status === "completed" ? "ok" : "warn",
      source: "httpx",
      message: `httpx ${result.status}; parsed ${services.length} HTTP services with status/tech${toolFailureDetail(result)}`
    });
    appendAiLog(store, runId, `httpx ${result.status}; ${services.length} live HTTP services were parsed for technology enrichment.`, { stage: "httpx", status: result.status, services: services.length });

    await runWebEnrichment({ ...shared, services, screenshotTools });
    await runRecoveryActionPool({ ...shared, roots: inferRoots(hosts), linuxTools: [], screenshotTools, discoveredDomains: hosts });
    store.appendEvent(runId, { phase: "http-tech-followup", severity: "ok", source: "engine", message: `HTTP/tech follow-up completed with ${context.httpServices.length} live services` });
    appendAiLog(store, runId, `HTTP/Tech follow-up completed with ${context.httpServices.length} live services. Review Results tabs for grouped statuses, technologies, URLs, and screenshots.`, { stage: "summary", services: context.httpServices.length });
    return await completeRun(store, runId, { domainCount: hosts.length, httpServices: context.httpServices.length });
  } finally {
    proxyController?.close();
  }
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
  timeoutMs = DEFAULT_TIMEOUT_MS,
  artifactsDir,
  proxyUrl = null,
  useProxyPool = false
}) {
  const handlers = { urls: true, http: true, tech: true, screenshots: true, trackers: true, favicons: true, dirs: true, cloud: true, bypass403: true, js: true, crawl: true, tls: true, takeover: true, params: true };
  if (!handlers[phase]) throw new Error(`Unsupported focused follow-up phase: ${phase}`);
  if (["urls", "http", "screenshots", "dirs", "cloud", "bypass403", "js", "crawl", "tls", "takeover", "params"].includes(phase) && !useLinuxRunner) {
    throw new Error(`The ${phase} follow-up requires the Linux tool runner`);
  }
  fs.mkdirSync(artifactsDir, { recursive: true });
  store.updateRun(runId, { status: "running", activePhase: `follow-up-${phase}`, checkpoint: { phase, domainCount: domains.length, serviceCount: services.length } });
  store.appendEvent(runId, { phase: `follow-up-${phase}`, severity: "ok", source: "engine", message: `Focused ${phase} follow-up started` });

  const needsNetwork = ["urls", "http", "screenshots", "dirs", "bypass403", "js", "crawl", "tls", "takeover", "params"].includes(phase);
  const { proxyController, selectedProxyUrl } = needsNetwork
    ? await setUpNetwork({ store, runId, phase: `follow-up-${phase}`, proxyUrl, useProxyPool, useLinuxRunner })
    : { proxyController: null, selectedProxyUrl: proxyUrl };
  const context = createRunContext({ httpServices: phase === "http" || phase === "urls" ? [] : services });
  const shared = { store, runId, targetName, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl: selectedProxyUrl, proxyController };
  try {
    let checkpoint = { phase, services: services.length };
    if (phase === "urls") {
      const roots = rootDomains.length ? rootDomains : inferRoots(domains);
      const discovered = new Set(roots);
      await collectLinuxTools({ ...shared, roots, linuxTools: ["gau"], discovered });
      await runRecoveryActionPool({ ...shared, roots, linuxTools: ["gau"], screenshotTools: [], discoveredDomains: discovered });
      checkpoint = { phase, urls: context.urls.length };
    } else if (phase === "http") {
      const hosts = normalizeHosts(domains);
      const { result, services: found } = await runHttpxOnHosts({ ...shared, hosts, artifactName: "http-focused", label: "httpx focused follow-up" });
      context.httpServices.push(...found);
      queueToolRecoveryAction(context, { id: "retry-httpx-focused", phase: "http-tool", toolName: "httpx", reason: `httpx focused follow-up ${result.status}${toolFailureDetail(result)}`, status: result.status, domains: hosts }, result);
      store.appendEvent(runId, { phase: "follow-up-http", severity: TOOL_RAN_STATUSES.has(result.status) ? "ok" : "warn", source: "httpx", message: `httpx ${result.status}; parsed ${found.length} HTTP services${toolFailureDetail(result)}` });
      await runRecoveryActionPool({ ...shared, roots: inferRoots(hosts), linuxTools: [], screenshotTools: [], discoveredDomains: hosts, includeFetchCollectors: false });
      checkpoint = { phase, services: context.httpServices.length };
    } else if (phase === "tech") {
      await runTechnologyEnrichment({ ...shared, waitForRunControl });
    } else if (phase === "screenshots") {
      await collectScreenshots({ ...shared, screenshotTools, queueRecovery: queueToolRecoveryAction });
      await runRecoveryActionPool({ ...shared, roots: inferRoots(services), linuxTools: [], screenshotTools, discoveredDomains: inferRoots(services), includeFetchCollectors: false });
    } else if (phase === "trackers") {
      await collectTrackers({ ...shared, services });
    } else if (phase === "favicons") {
      await collectFavicons({ ...shared, services });
    } else if (phase === "dirs") {
      const wordlist = store.getActiveWordlist("paths");
      const found = await runDirectoryDiscovery({ ...shared, services, wordlistPath: wordlist?.path || null });
      checkpoint = { phase, discoveredUrls: found };
    } else if (phase === "cloud") {
      const found = await runCloudEnum({ ...shared, domains, urls: services });
      checkpoint = { phase, cloudResources: found };
    } else if (phase === "bypass403") {
      const found = await runBypass403({ ...shared, services });
      checkpoint = { phase, bypasses: found };
    } else if (phase === "js") {
      const found = await runJsDiscovery({ ...shared, services });
      checkpoint = { phase, jsUrls: found };
    } else if (phase === "crawl") {
      const found = await runKatanaCrawl({ ...shared, services });
      checkpoint = { phase, crawledUrls: found };
    } else if (phase === "tls") {
      const hosts = normalizeHosts(domains.length ? domains : services);
      const found = await runTlsxGrab({ ...shared, hosts, rootDomains: rootDomains.length ? rootDomains : inferRoots(domains) });
      checkpoint = { phase, certDomains: found };
    } else if (phase === "takeover") {
      const hosts = normalizeHosts(domains.length ? domains : services);
      const found = await runSubzyTakeover({ ...shared, hosts });
      checkpoint = { phase, takeovers: found };
    } else if (phase === "params") {
      const roots = rootDomains.length ? rootDomains : inferRoots(domains);
      const way = await runWaymore({ ...shared, domains: roots });
      const params = await runParamSpider({ ...shared, domains: roots });
      checkpoint = { phase, archivedUrls: way + params };
    }
    return await completeRun(store, runId, checkpoint);
  } finally {
    proxyController?.close();
  }
}

module.exports = {
  runFocusedFollowup,
  runHttpFollowup,
  runRecon
};
