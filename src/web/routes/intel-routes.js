"use strict";

const fs = require("node:fs");
const { runCandidateCorrelation } = require("../../recon/candidate-correlation");
const { callReverseWhois } = require("../../recon/providers/whoisxmlapi");
const { HttpError, readBody, sendJson } = require("../http-utils");
const { inferRootDomains } = require("../target-service");
const { normalizeDomainList } = require("../services/scope-leads");
const { loadTarget, targetConfigPath } = require("../services/target-configs");
const { recordReverseWhoisQueryFailure, saveReverseWhoisResult, suggestWhoisPivots } = require("../services/whois-intel");

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
  { method: "POST", path: "/api/recon/provider-discovery", handler: runReverseWhois },
  { method: "POST", path: "/api/recon/whois-term-suggestions", handler: suggestWhoisTerms }
];
