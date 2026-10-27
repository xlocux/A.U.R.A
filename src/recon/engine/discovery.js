"use strict";

const { extractDomains, rootForDomain } = require("../domain-utils");
const { parseGauUrls, parseHttpxJsonLines } = require("../parsers");
const { runPassiveSource } = require("../passive-sources");
const { classifyApiFailure } = require("../provider-apis");
const { commandDisplay } = require("../linux-tools");
const { preflightCheckToolAvailability } = require("../tool-preflight-check");
const { loadToolRegistry } = require("../tool-registry");
const { API_PASSIVE_PROVIDERS, DEFAULT_TOOL_RECOVERY_ATTEMPTS } = require("./constants");
const { waitForRunControl } = require("./run-control");
const { argsForTool, parseToolSpec } = require("./tool-args");
const { recordToolRun, runLinuxToolWithProxy, runToolWithRecovery, toolFailureDetail } = require("./tool-execution");

function createRunContext({ urls = [], httpServices = [] } = {}) {
  return { urls: [...urls], httpServices: [...httpServices], recoveryQueue: [], recoveryMode: false, unavailableTools: new Set() };
}

function queueToolRecoveryAction(context, action, result = null) {
  if (!context || context.recoveryMode || !action) return;
  if (result && result.status === "completed") return;
  // The tool already got its in-tool retries; a recovery action would re-run a timing-out tool again and again.
  if (result?.status === "timeout") return;
  const normalized = { ...action, id: action.id || `retry-${action.toolName || action.phase || "tool"}`, source: "tool-result" };
  if (context.recoveryQueue.some((item) => item.id === normalized.id)) return;
  context.recoveryQueue.push(normalized);
}

// Runs the binary availability check once per run, only for tools that have a registry manifest,
// and remembers confirmed-missing tools so they are skipped rather than failing one by one.
async function checkToolAvailability({ store, runId, toolNames, context }) {
  const registry = loadToolRegistry();
  const declared = [...new Set(toolNames)].filter((name) => registry.get(name));
  if (declared.length === 0) return;
  const check = await preflightCheckToolAvailability({ toolIds: declared, registry });
  for (const toolId of check.missing) context.unavailableTools.add(toolId);
  const issues = [];
  if (check.missing.length) issues.push(`missing on PATH: ${check.missing.join(", ")} (skipped)`);
  if (check.wrongCapability.length) issues.push(`unexpected binary identity: ${check.wrongCapability.join(", ")} (will still run)`);
  if (!issues.length) return;
  store.appendEvent(runId, {
    phase: "preflight",
    severity: "warn",
    source: "preflight-check",
    message: `Tool availability: ${issues.join("; ")}. Install or update them from Settings > Environment.`,
    payload: { missing: check.missing, wrongCapability: check.wrongCapability }
  });
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
        const note = metadata.reason ? ` (${metadata.reason})` : "";
        store.appendEvent(runId, { phase: "recon", severity: domains.length || !metadata.reason ? "ok" : "warn", source, message: `${source} returned ${domains.length} domains for ${root}${note}` });
      } catch (error) {
        const activeKey = apiKeys[source];
        if (activeKey?.id && classifyApiFailure(error.message).status === "exhausted") {
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

// Saves what a discovery tool produced: domains for every tool, plus URLs (gau) or HTTP services (httpx).
function saveToolOutput({ store, runId, targetName, spec, root, roots, result, discovered, context }) {
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
  }
}

async function collectLinuxTools({ store, runId, targetName, roots, linuxTools, linuxRuntime, useLinuxRunner, subdomainWordlistPath, timeoutMs, artifactsDir, discovered, context, proxyUrl = null, proxyController = null }) {
  const collectedResults = [];
  if (!useLinuxRunner) {
    store.appendEvent(runId, { phase: "recon", source: "linux", message: "Linux tools skipped by run configuration" });
    return collectedResults;
  }
  const proxied = Boolean(proxyUrl || proxyController?.hasPool());
  for (const root of roots) {
    for (const toolSpec of linuxTools) {
      await waitForRunControl(store, runId);
      const spec = parseToolSpec(toolSpec);
      if (context.unavailableTools.has(spec.name)) continue;
      // nmap ignores HTTP_PROXY and would connect directly, so it never runs behind a proxy (fail closed).
      if (spec.name === "nmap" && proxied) {
        store.appendEvent(runId, { phase: "recon", severity: "warn", source: "nmap", message: `nmap skipped for ${root}: it cannot use the configured proxy and would scan directly from your own address.` });
        continue;
      }
      let args;
      try {
        args = argsForTool(spec, root, artifactsDir, [...discovered].filter((domain) => rootForDomain(domain, [root])), subdomainWordlistPath);
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
      recordToolRun({ store, runId, artifactsDir, artifactName: `${spec.name}-${root}`, toolName: spec.name, args, linuxRuntime, result });
      collectedResults.push({ toolName: spec.name, root, status: result.status });
      saveToolOutput({ store, runId, targetName, spec, root, roots, result, discovered, context });
      queueToolRecoveryAction(context, {
        id: `retry-${spec.name}-${root}`,
        phase: "linux-tool",
        toolName: spec.name,
        toolSpec: spec,
        root,
        reason: `${spec.name} ${result.status} for ${root}${toolFailureDetail(result)}`,
        status: result.status
      }, result);
    }
  }
  return collectedResults;
}

module.exports = {
  checkToolAvailability,
  collectLinuxTools,
  collectPassive,
  createRunContext,
  queueToolRecoveryAction
};
