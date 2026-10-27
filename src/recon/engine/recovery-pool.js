"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { TOOL_RAN_STATUSES } = require("./constants");
const { collectLinuxTools, queueToolRecoveryAction } = require("./discovery");
const { isRunControlError, waitForRunControl } = require("./run-control");
const { normalizeHosts, parseToolSpec } = require("./tool-args");
const { runHttpxOnHosts, toolFailureDetail } = require("./tool-execution");
const { collectFavicons, collectScreenshots, collectTrackers, countScreenshotFiles } = require("./web-collectors");

const DEFAULT_MAX_RECOVERY_ATTEMPTS = 2;

function addRecoveryAction(actions, action) {
  if (!actions.some((item) => item.id === action.id)) actions.push(action);
}

// Turns failed tool results plus missing phase outputs into an ordered list of recovery actions.
function buildRecoveryActions({ roots, linuxTools, useLinuxRunner, context, screenshotTools, artifactsDir, includeFetchCollectors = true }) {
  const enabledTools = new Set((linuxTools || []).map((tool) => parseToolSpec(tool).name));
  const actions = [...(context.recoveryQueue || [])];
  const gauAlreadyQueued = actions.some((action) => action.toolName === "gau");
  if (useLinuxRunner && enabledTools.has("gau") && roots.length && context.urls.length === 0 && !gauAlreadyQueued) {
    addRecoveryAction(actions, { id: "retry-url-params", phase: "urls", reason: "URL and parameter mining produced no saved URLs." });
  }
  if ((screenshotTools || []).length && context.httpServices.length && countScreenshotFiles(path.join(artifactsDir, "screenshots")) === 0) {
    const toolAlreadyQueued = actions.some((action) => action.phase === "screenshot-tool");
    if (!toolAlreadyQueued) addRecoveryAction(actions, { id: "retry-screenshots", phase: "screenshots", reason: "Screenshot capture produced no image files." });
  }
  // Tracker/favicon collectors are skipped behind a proxy (and in narrow follow-ups), so nothing to recover.
  if (!includeFetchCollectors) return actions;
  if (context.httpServices.length && !fs.existsSync(path.join(artifactsDir, "tracker-findings.json"))) {
    addRecoveryAction(actions, { id: "extract-trackers", phase: "trackers", reason: "Analytics/pixel extraction has not produced an artifact yet." });
  }
  if (context.httpServices.length && !fs.existsSync(path.join(artifactsDir, "favicon-findings.json"))) {
    addRecoveryAction(actions, { id: "extract-favicons", phase: "favicons", reason: "Favicon fingerprinting has not produced an artifact yet." });
  }
  return actions;
}

function artifactHasFindings(filePath) {
  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(content.findings) && content.findings.length > 0;
  } catch {
    return false;
  }
}

function recoveryActionCompleted(action, { context, artifactsDir }) {
  if (typeof action.completed === "boolean") return action.completed;
  if (action.phase === "urls") return context.urls.length > 0;
  if (action.phase === "screenshots") return countScreenshotFiles(path.join(artifactsDir, "screenshots")) > 0;
  if (action.phase === "screenshot-tool") return countScreenshotFiles(path.join(artifactsDir, "screenshots", action.toolName)) > 0;
  if (action.phase === "trackers") return artifactHasFindings(path.join(artifactsDir, "tracker-findings.json"));
  if (action.phase === "favicons") return artifactHasFindings(path.join(artifactsDir, "favicon-findings.json"));
  return true;
}

async function retryHttpToolAction({ store, runId, targetName, action, domains, linuxRuntime, timeoutMs, artifactsDir, context, proxyUrl, proxyController }) {
  const hosts = normalizeHosts(domains);
  if (hosts.length === 0) return false;
  const { result, services } = await runHttpxOnHosts({
    store,
    runId,
    targetName,
    hosts,
    artifactName: `httpx-recovery-${action.id}-${action.attemptCount}`,
    linuxRuntime,
    timeoutMs,
    artifactsDir,
    proxyController,
    proxyUrl,
    source: "httpx-recovery",
    maxAttempts: 1,
    label: "httpx recovery"
  });
  context.httpServices.push(...services);
  store.appendEvent(runId, {
    phase: "ai-action-pool",
    severity: result.status === "completed" ? "ok" : "warn",
    source: "httpx",
    message: `httpx recovery ${result.status}; parsed ${services.length} HTTP services${toolFailureDetail(result)}`
  });
  return TOOL_RAN_STATUSES.has(result.status) && services.length > 0;
}

async function executeRecoveryAction(action, options) {
  const { store, runId, targetName, roots, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, screenshotTools, discoveredDomains, subdomainWordlistPath, proxyUrl, proxyController } = options;
  const common = { store, runId, targetName, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, proxyUrl, proxyController };
  delete action.completed;
  if (action.phase === "urls" || action.phase === "linux-tool") {
    const tools = action.phase === "urls" ? ["gau"] : [action.toolSpec || action.toolName];
    const toolName = action.phase === "urls" ? "gau" : action.toolName;
    const results = await collectLinuxTools({
      ...common,
      roots: action.root ? [action.root] : roots,
      linuxTools: tools,
      subdomainWordlistPath,
      // Share the run's own Set so domains found by a retry reach the later phases.
      discovered: discoveredDomains instanceof Set ? discoveredDomains : new Set(discoveredDomains || roots)
    });
    action.completed = results.some((item) => item.toolName === toolName && TOOL_RAN_STATUSES.has(item.status));
    return;
  }
  if (action.phase === "http-tool") {
    action.completed = await retryHttpToolAction({
      ...common,
      action,
      domains: action.domains || discoveredDomains || roots
    });
    return;
  }
  if (action.phase === "screenshots" || action.phase === "screenshot-tool") {
    await collectScreenshots({ ...common, screenshotTools: action.phase === "screenshots" ? screenshotTools : [action.toolName] });
    return;
  }
  if (action.phase === "trackers") await collectTrackers({ ...common, services: context.httpServices });
  if (action.phase === "favicons") await collectFavicons({ ...common, services: context.httpServices });
}

async function runRecoveryActionPool(options) {
  const { store, runId, roots, linuxTools, useLinuxRunner, context, screenshotTools, artifactsDir, proxyUrl, includeFetchCollectors = true, maxRecoveryAttempts = DEFAULT_MAX_RECOVERY_ATTEMPTS } = options;
  const actions = buildRecoveryActions({ roots, linuxTools, useLinuxRunner, context, screenshotTools, artifactsDir, includeFetchCollectors: includeFetchCollectors && !proxyUrl });
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
  try {
    for (const action of actions) {
      let completed = false;
      for (action.attemptCount = 1; action.attemptCount <= maxRecoveryAttempts && !completed; action.attemptCount += 1) {
        await waitForRunControl(store, runId);
        store.appendEvent(runId, {
          phase: "ai-action-pool",
          severity: "info",
          source: "ai-action-pool",
          message: `Running recovery action ${action.id} (attempt ${action.attemptCount}/${maxRecoveryAttempts}): ${action.reason}`,
          payload: { action, status: "running" }
        });
        try {
          await executeRecoveryAction(action, options);
          completed = recoveryActionCompleted(action, { context, artifactsDir });
        } catch (error) {
          if (isRunControlError(error)) throw error;
          store.appendEvent(runId, { phase: "ai-action-pool", severity: "warn", source: "ai-action-pool", message: `Recovery action ${action.id} failed (attempt ${action.attemptCount}): ${error.message}` });
        }
      }
      if (completed) completedActions += 1;
      store.appendEvent(runId, {
        phase: "ai-action-pool",
        severity: completed ? "ok" : "warn",
        source: "ai-action-pool",
        message: completed
          ? `Recovery action ${action.id} completed.`
          : `Recovery action ${action.id} still has no usable output after ${maxRecoveryAttempts} attempts; continuing.`,
        payload: { action, status: completed ? "completed" : "exhausted" }
      });
    }
  } finally {
    context.recoveryMode = false;
  }
  const incompleteActions = actions.length - completedActions;
  store.appendEvent(runId, {
    phase: "ai-action-pool",
    severity: incompleteActions > 0 ? "warn" : "ok",
    source: "ai-action-pool",
    message: `Recovery action pool completed: ${completedActions} actions succeeded, ${incompleteActions} incomplete or exhausted.`,
    payload: { completedActions, incompleteActions, totalActions: actions.length }
  });
}

module.exports = {
  buildRecoveryActions,
  queueToolRecoveryAction,
  runRecoveryActionPool
};
