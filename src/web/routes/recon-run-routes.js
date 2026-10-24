"use strict";

const reconEngine = require("../../recon/recon-engine");
const { normalizeProxyUrl } = require("../../recon/linux-tools");
const { HttpError, readBody, sendJson } = require("../http-utils");
const { runInBackground } = require("../services/background-runs");
const { inferRootsFromDomainRows, normalizeDomainList } = require("../services/scope-leads");
const { loadTarget } = require("../services/target-configs");
const { expandFullReconRoots, runReconIntelPreflight } = require("../services/whois-intel");
const { ensureDefaultWordlists } = require("../services/wordlist-files");

const DEFAULT_TIMEOUT_MS = 180000;
const ALL_ROWS = 1000000;
const RECON_MODES = new Set(["single", "list", "full"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const FOCUSED_PHASES = new Set(["urls", "http-only", "tech", "screenshots", "trackers", "favicons"]);
const SERVICE_PHASES = new Set(["tech", "screenshots", "trackers", "favicons"]);

function parseProxyOrThrow(value) {
  try {
    return normalizeProxyUrl(value);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

// Shared runner options accepted by every run-creating endpoint.
function runnerOptions(body) {
  return {
    linuxRuntime: body.linuxRuntime || body.runtime || "linux",
    useLinuxRunner: body.useLinuxRunner !== false,
    timeoutMs: Number(body.timeoutMs) || DEFAULT_TIMEOUT_MS,
    screenshotTools: body.screenshotTools || reconEngine.DEFAULT_SCREENSHOT_TOOLS,
    proxyUrl: parseProxyOrThrow(body.proxyUrl),
    // The shared public proxy pool is opt-in; by default only the operator's own proxy is used.
    useProxyPool: body.useProxyPool === true
  };
}

function requireRun(store, runId, message = "Run not found") {
  const run = store.getRun(runId);
  if (!run) throw new HttpError(404, message);
  return run;
}

function listRuns({ response, store, url }) {
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 50));
  const targetName = url.searchParams.get("targetName") || url.searchParams.get("target") || null;
  sendJson(response, { runs: store.listRuns({ limit, targetName }) });
}

async function createReconRun({ request, response, store }) {
  const body = await readBody(request);
  const options = runnerOptions(body);
  if (!body.authorized) throw new HttpError(400, "Authorization confirmation is required before recon");
  const { config: targetConfig, target } = loadTarget(store, body.targetName);
  const reconMode = body.reconMode || "list";
  const rootDomains = normalizeDomainList(body.rootDomains || []);
  if (!RECON_MODES.has(reconMode)) throw new HttpError(400, "reconMode must be single, list, or full");
  if (rootDomains.length === 0) throw new HttpError(400, "At least one valid root domain is required");
  if (reconMode === "single" && rootDomains.length !== 1) throw new HttpError(400, "Single domain mode requires exactly one valid domain");

  const targetName = target.target_name;
  const run = store.createRun({
    targetName,
    runType: reconMode === "full" ? "full-recon" : "recon",
    mode: reconMode,
    providerProfile: options.useLinuxRunner ? "linux-local" : "passive",
    checkpoint: { rootDomains }
  });
  ensureDefaultWordlists(store);
  sendJson(response, { run }, 202);

  runInBackground({
    store,
    runId: run.id,
    phase: "recon",
    task: async () => {
      const domainWordlist = store.getActiveWordlist("domains");
      const intelSeeds = body.intelPreflight === false
        ? rootDomains
        : await runReconIntelPreflight({ store, runId: run.id, targetName, rootDomains, config: targetConfig });
      const rootsToScan = reconMode === "full"
        ? await expandFullReconRoots({ store, runId: run.id, targetName, rootDomains: intelSeeds, config: targetConfig, fullRecon: body.fullRecon || {} })
        : intelSeeds;
      await reconEngine.runRecon({
        store,
        runId: run.id,
        targetName,
        rootDomains: rootsToScan,
        passiveSources: body.passiveSources || reconEngine.DEFAULT_PASSIVE_SOURCES,
        linuxTools: body.linuxTools || reconEngine.DEFAULT_LINUX_TOOLS,
        subdomainWordlistPath: body.subdomainWordlistPath || domainWordlist?.path || null,
        ...options
      });
    }
  });
}

function updateRunControl({ response, store, params }) {
  const { id: runId, action } = params;
  const run = requireRun(store, runId);
  if (TERMINAL_STATUSES.has(run.status)) throw new HttpError(409, `Run is already ${run.status}`);
  if (action === "pause") {
    if (run.status !== "running" && run.status !== "queued") throw new HttpError(409, `Run cannot be paused from ${run.status}`);
    const updated = store.updateRun(runId, { status: "paused", activePhase: run.active_phase || "paused" });
    store.appendEvent(runId, { phase: "control", severity: "warn", source: "user", message: "Run pause requested." });
    sendJson(response, { run: updated });
    return;
  }
  if (action === "resume") {
    if (run.status !== "paused") throw new HttpError(409, `Run cannot be resumed from ${run.status}`);
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
    return;
  }
  throw new HttpError(404, `Unknown run action: ${action}`);
}

async function createHttpFollowupRun({ request, response, store, params }) {
  const sourceRunId = params.id;
  const sourceRun = requireRun(store, sourceRunId, "Source run not found");
  const domains = store.listDomains({ runId: sourceRunId, limit: ALL_ROWS });
  if (domains.length === 0) throw new HttpError(400, "The source run has no saved domains to probe");
  const body = await readBody(request);
  const options = runnerOptions(body);
  const run = store.createRun({
    targetName: sourceRun.target_name,
    runType: "http-followup",
    mode: "http-tech-followup",
    providerProfile: options.useLinuxRunner ? "linux-local" : "passive",
    checkpoint: { sourceRunId, sourceDomainCount: domains.length }
  });
  sendJson(response, { run, sourceRunId, sourceDomainCount: domains.length }, 202);
  runInBackground({
    store,
    runId: run.id,
    phase: "http-tech-followup",
    task: () => reconEngine.runHttpFollowup({
      store,
      runId: run.id,
      targetName: sourceRun.target_name,
      domains: domains.map((item) => item.domain),
      ...options
    })
  });
}

async function createFocusedFollowupRun({ request, response, store, params, phaseName }) {
  const sourceRunId = params.id;
  const sourceRun = requireRun(store, sourceRunId, "Source run not found");
  const body = await readBody(request);
  const requestedPhase = phaseName || params.phase || body.phase;
  if (!FOCUSED_PHASES.has(requestedPhase)) throw new HttpError(400, `Unsupported follow-up phase: ${requestedPhase || "(none)"}`);
  const options = runnerOptions(body);
  const phase = requestedPhase === "http-only" ? "http" : requestedPhase;
  const domains = store.listDomains({ runId: sourceRunId, limit: ALL_ROWS });
  const services = store.listHttpServices({ runId: sourceRunId, limit: ALL_ROWS });
  if ((phase === "urls" || phase === "http") && domains.length === 0) {
    throw new HttpError(400, "The source run has no saved domains for this follow-up phase");
  }
  if (SERVICE_PHASES.has(phase) && services.length === 0) {
    throw new HttpError(400, "The source run has no saved HTTP services for this follow-up phase");
  }
  const rootDomains = Array.isArray(sourceRun.checkpoint?.rootDomains) && sourceRun.checkpoint.rootDomains.length
    ? sourceRun.checkpoint.rootDomains
    : inferRootsFromDomainRows(domains);
  const counts = { sourceDomainCount: domains.length, sourceServiceCount: services.length };
  const run = store.createRun({
    targetName: sourceRun.target_name,
    runType: "focused-followup",
    mode: `follow-up-${requestedPhase}`,
    providerProfile: options.useLinuxRunner ? "linux-local" : "passive",
    checkpoint: { sourceRunId, phase, rootDomains, ...counts }
  });
  sendJson(response, { run, sourceRunId, phase, ...counts }, 202);
  runInBackground({
    store,
    runId: run.id,
    phase: `follow-up-${phase}`,
    task: () => reconEngine.runFocusedFollowup({
      store,
      runId: run.id,
      targetName: sourceRun.target_name,
      phase,
      domains,
      services,
      rootDomains,
      ...options
    })
  });
}

module.exports = [
  { method: "GET", path: "/api/recon-runs", handler: listRuns },
  { method: "POST", path: "/api/recon-runs", handler: createReconRun },
  { method: "POST", path: "/api/recon-runs/:id/:action", handler: (context) => {
    if (["pause", "resume", "cancel"].includes(context.params.action)) return updateRunControl(context);
    if (context.params.action === "http-followup") return createHttpFollowupRun(context);
    if (context.params.action === "focused-followup") return createFocusedFollowupRun(context);
    throw new HttpError(404, `Unknown run action: ${context.params.action}`);
  } },
  { method: "POST", path: "/api/recon-runs/:id/follow-up/http", handler: createHttpFollowupRun },
  { method: "POST", path: "/api/recon-runs/:id/follow-up/:phase", handler: createFocusedFollowupRun }
];
