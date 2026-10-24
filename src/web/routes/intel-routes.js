"use strict";

const fs = require("node:fs");
const { runCandidateCorrelation } = require("../../recon/candidate-correlation");
const { callReverseWhois } = require("../../recon/providers/whoisxmlapi");
const { HttpError, readBody, sendJson } = require("../http-utils");
const { inferRootDomains } = require("../target-service");
const { generateAlternateTldLeads, normalizeDomainList } = require("../services/scope-leads");
const { loadTarget, targetConfigPath } = require("../services/target-configs");
const { recordReverseWhoisQueryFailure, saveReverseWhoisResult, suggestWhoisPivots } = require("../services/whois-intel");

const DEFAULT_REVIEW_THRESHOLD = 60;
const DEFAULT_CORRELATION_SOURCES = [
  "whois_data", "dns_records", "ip_addresses", "favicon_hashes",
  "nameserver_records", "certificate_sans", "rdap_records", "cidr_blocks"
];

async function runTldDiscoveryPhase({ request, response, store, params }) {
  const runId = params.id;
  const run = store.getRun(runId);
  if (!run) throw new HttpError(404, "run not found");
  const body = await readBody(request);
  const target = store.getTarget(run.target_name);
  if (!target) throw new HttpError(404, "target not found for run");

  const correlationEnabled = body.correlation_engine_enabled !== false;
  const autoPromotion = body.auto_promotion_enabled === true;
  const reviewThreshold = Number(body.confidence_threshold_for_review) || DEFAULT_REVIEW_THRESHOLD;
  const rootDomains = normalizeDomainList(body.root_domains || body.rootDomains || inferRootDomains(target));
  const label = String(body.registrable_label || body.registrableLabel || "").trim().toLowerCase();
  const strategies = Array.isArray(body.strategies) && body.strategies.length
    ? body.strategies.map(String)
    : ["certificate_transparency", "dns_validation"];
  const syntheticRoots = /^[a-z0-9-]{3,63}$/.test(label) ? [`${label}.com`] : rootDomains;

  const candidates = generateAlternateTldLeads({ rootDomains: syntheticRoots, config: target }).map((lead) => ({
    ...lead,
    leadType: "domain_tld_candidate",
    metadata: {
      ...(lead.metadata || {}),
      observationType: "domain_tld_candidate",
      correlationSettings: { enabled: correlationEnabled, autoPromotionEnabled: autoPromotion, reviewThreshold }
    }
  }));
  if (candidates.length > 0) store.saveAssetLeads(runId, target.target_name, candidates);
  const scored = correlationEnabled
    ? runCandidateCorrelation({ store, runId, targetName: target.target_name, rootDomains, leads: candidates, config: target, autoPromote: autoPromotion })
    : candidates;
  const jobsQueued = strategies.map((strategy) => store.createJob({
    runId,
    targetName: target.target_name,
    phase: "domain_intelligence",
    type: "tld_discovery",
    toolId: `tld_discovery_${strategy}`,
    priority: 80,
    maxAttempts: 1,
    payload: {
      target_name: target.target_name,
      registrable_label: label || null,
      strategy,
      correlation_engine_enabled: correlationEnabled,
      auto_promotion_enabled: autoPromotion,
      correlation_sources: Array.isArray(body.correlation_sources) ? body.correlation_sources : DEFAULT_CORRELATION_SOURCES,
      confidence_threshold_for_review: reviewThreshold
    }
  }));
  store.appendEvent(runId, {
    phase: "domain_intelligence",
    severity: "ok",
    source: "tld-correlation",
    message: `TLD discovery correlation evaluated ${candidates.length} candidates; ${jobsQueued.length} strategy jobs queued for evidence collection.`,
    payload: { candidates: candidates.length, jobsQueued: jobsQueued.map((job) => job.id), autoPromotionEnabled: autoPromotion }
  });
  sendJson(response, {
    jobs_queued: jobsQueued.map((job) => ({ job_id: String(job.id), tool_id: job.tool_id, status: job.status })),
    correlation_settings: { enabled: correlationEnabled, auto_promotion_threshold: 100, review_threshold: reviewThreshold },
    candidates_evaluated: scored.length,
    correlation_results: scored.map((lead) => ({
      value: lead.value,
      status: lead.status,
      confidence: lead.confidence,
      correlation_engine_result: lead.metadata?.correlationEngineResult || null
    }))
  });
}

async function runReverseWhois({ request, response, store }) {
  const body = await readBody(request);
  if (!body.authorized) throw new HttpError(400, "Authorization confirmation is required before provider discovery");
  const { target } = loadTarget(store, body.targetName);
  const query = {
    include: Array.isArray(body.include) ? body.include : [],
    exclude: Array.isArray(body.exclude) ? body.exclude : [],
    mode: body.mode === "purchase" ? "purchase" : "preview",
    searchType: body.searchType === "historic" ? "historic" : "current"
  };
  const run = store.createRun({
    targetName: target.target_name,
    runType: "provider-discovery",
    mode: "passive",
    providerProfile: "automatic-passive"
  });
  try {
    const selectedKey = store.getActiveApiKey("whoisxmlapi");
    const result = await callReverseWhois({ apiKey: selectedKey?.api_key, ...query });
    if (selectedKey) store.markApiKeyUsed(selectedKey.id);
    const savedLeads = saveReverseWhoisResult(store, run.id, target.target_name, result);
    runCandidateCorrelation({
      store,
      runId: run.id,
      targetName: target.target_name,
      rootDomains: inferRootDomains(target),
      leads: store.listAssetLeads({ targetName: target.target_name }).filter((lead) => lead.run_id === run.id),
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
    recordReverseWhoisQueryFailure(store, run.id, target.target_name, query, error);
    store.updateRun(run.id, {
      status: "failed",
      activePhase: "failed",
      finishedAt: new Date().toISOString(),
      errorMessage: error.message
    });
    throw new HttpError(502, error.message);
  }
}

function loadTargetDomains(targetName, store) {
  if (!targetName) return [];
  if (!fs.existsSync(targetConfigPath(targetName))) return [];
  return inferRootDomains(loadTarget(store, targetName).target);
}

async function suggestWhoisTerms({ request, response, store }) {
  const body = await readBody(request);
  const domains = Array.isArray(body.domains) && body.domains.length
    ? normalizeDomainList(body.domains)
    : loadTargetDomains(body.targetName, store);
  sendJson(response, await suggestWhoisPivots({ store, domains }));
}

module.exports = [
  { method: "POST", path: "/api/v1/runs/:id/phases/domain_intelligence/tld-discovery", handler: runTldDiscoveryPhase },
  { method: "POST", path: "/api/asset-discovery/reverse-whois", handler: runReverseWhois },
  { method: "POST", path: "/api/recon/provider-discovery", handler: runReverseWhois },
  { method: "POST", path: "/api/recon/whois-term-suggestions", handler: suggestWhoisTerms }
];
