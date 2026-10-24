"use strict";

const { runCandidateCorrelation } = require("../../recon/candidate-correlation");
const reconEngine = require("../../recon/recon-engine");
const { inferRootDomains } = require("../target-service");
const { runInBackground, waitForRunControl } = require("./background-runs");
const {
  extractBrandTerms,
  filterScopeDomains,
  generateAlternateTldLeads,
  saveBootstrapDomains
} = require("./scope-leads");
const { collectReverseWhoisDomains, formatWhoisSuggestionSummary, suggestWhoisPivots } = require("./whois-intel");
const { ensureDefaultWordlists } = require("./wordlist-files");

// Creates the automatic intel bootstrap run that follows target creation and launches it in the background.
function startTargetBootstrap({ store, target, config, authorized, linuxRuntime, timeoutMs, proxyUrl = null }) {
  ensureDefaultWordlists(store);
  const rootDomains = inferRootDomains(target);
  const run = store.createRun({
    targetName: target.target_name,
    runType: "target-bootstrap",
    mode: authorized ? "bootstrap-authorized" : "bootstrap-passive",
    providerProfile: "automatic-bootstrap",
    checkpoint: { rootDomains, authorized }
  });
  runInBackground({
    store,
    runId: run.id,
    phase: "bootstrap",
    task: () => bootstrapTargetRecon({ store, runId: run.id, target, config, rootDomains, authorized, linuxRuntime, timeoutMs, proxyUrl })
  });
  return run;
}

async function bootstrapTargetRecon({ store, runId, target, config, rootDomains, authorized, linuxRuntime, timeoutMs, proxyUrl }) {
  const targetName = target.target_name;
  store.updateRun(runId, { status: "running", activePhase: "whois-rdap", checkpoint: { rootDomains, authorized } });
  store.appendEvent(runId, {
    phase: "bootstrap",
    severity: "ok",
    source: "engine",
    message: `Target saved. Starting RDAP/WHOIS bootstrap for ${rootDomains.join(", ")}`
  });

  await waitForRunControl(store, runId, "Bootstrap");
  const suggestions = await suggestWhoisPivots({ store, runId, domains: rootDomains });
  const reverseWhoisTerms = [...new Set([...(suggestions.includeTerms || []), ...extractBrandTerms(rootDomains)])];
  const associatedDomains = suggestions.associatedDomains || [];
  const hasUsefulWhoisPivots = reverseWhoisTerms.length > 0 || associatedDomains.length > 0;
  store.appendEvent(runId, {
    phase: "whois-rdap",
    severity: hasUsefulWhoisPivots ? "ok" : "warn",
    source: "rdap",
    message: hasUsefulWhoisPivots
      ? `Intel phase prepared WHOIS pivots: ${formatWhoisSuggestionSummary({ ...suggestions, includeTerms: reverseWhoisTerms })}`
      : suggestions.rationale || "No WHOIS pivots were found."
  });

  const rdapDomains = filterScopeDomains({ domains: associatedDomains, config, rootDomains });
  if (rdapDomains.length > 0) {
    saveBootstrapDomains({ store, runId, targetName, domains: rdapDomains, roots: rootDomains, source: "rdap-associated-domain" });
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
    const saved = store.saveAssetLeads(runId, targetName, alternateTldLeads);
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
    await waitForRunControl(store, runId, "Bootstrap");
    providerDomains = await collectReverseWhoisDomains({
      store,
      runId,
      targetName,
      config,
      rootDomains,
      suggestions: { ...suggestions, includeTerms: reverseWhoisTerms }
    });
    correlationInputs = correlationInputs.concat(store.listAssetLeads({ targetName })
      .filter((lead) => lead.run_id === runId && lead.source === "whoisxmlapi"));
  }

  runCandidateCorrelation({ store, runId, targetName, rootDomains, leads: correlationInputs, config });

  const seeds = filterScopeDomains({ domains: [...rootDomains, ...rdapDomains, ...providerDomains], config, rootDomains });
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
  await waitForRunControl(store, runId, "Bootstrap");
  await reconEngine.runRecon({
    store,
    runId,
    targetName,
    rootDomains: seeds,
    passiveSources: reconEngine.DEFAULT_PASSIVE_SOURCES,
    linuxTools: reconEngine.DEFAULT_LINUX_TOOLS,
    screenshotTools: reconEngine.DEFAULT_SCREENSHOT_TOOLS,
    linuxRuntime,
    useLinuxRunner: true,
    subdomainWordlistPath: domainWordlist?.path || null,
    timeoutMs,
    proxyUrl
  });
}

module.exports = {
  startTargetBootstrap
};
