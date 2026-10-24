"use strict";

const { runCandidateCorrelation } = require("../../recon/candidate-correlation");
const { suggestReverseWhoisTerms } = require("../../recon/providers/rdap-suggestions");
const { callReverseWhois } = require("../../recon/providers/whoisxmlapi");
const { callWhoisFreaksHistorical } = require("../../recon/providers/whoisfreaks");
const {
  filterScopeDomains,
  generateAlternateTldLeads,
  normalizeDomainList,
  saveBootstrapDomains
} = require("./scope-leads");

const MAX_HISTORICAL_TERMS = 4;

function appendOptionalEvent(store, runId, event) {
  if (runId) store.appendEvent(runId, event);
}

function formatWhoisSuggestionSummary(suggestions) {
  const parts = [];
  if (suggestions.includeTerms?.length) parts.push(`terms: ${suggestions.includeTerms.join(", ")}`);
  if (suggestions.associatedDomains?.length) parts.push(`associated domains: ${suggestions.associatedDomains.join(", ")}`);
  return parts.join("; ") || "none";
}

// Current RDAP pivots first; fall back to WhoisFreaks history only when RDAP yields nothing useful.
async function suggestWhoisPivots({ store, runId = null, domains }) {
  const suggestions = await suggestReverseWhoisTerms({ domains });
  return enrichWhoisSuggestionsWithHistory({ store, runId, domains, suggestions });
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
  const mergedIncludeTerms = [...new Set([...(suggestions.includeTerms || []), ...includeTerms])].slice(0, MAX_HISTORICAL_TERMS);
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

function recordReverseWhoisQueryFailure(store, runId, targetName, { mode, include, exclude }, error) {
  store.recordAssetDiscoveryQuery(targetName, {
    runId,
    provider: "whoisxmlapi",
    queryType: "reverse-whois",
    mode: mode || "preview",
    includeTerms: include || [],
    excludeTerms: exclude || [],
    status: "failed",
    errorMessage: error.message
  });
}

// Bootstrap expansion: purchase-mode reverse WHOIS on the suggested pivots, keeping only in-scope seeds.
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
    const domains = filterScopeDomains({ domains: result.leads.map((lead) => lead.domain), config, rootDomains });
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

async function runReconIntelPreflight({ store, runId, targetName, rootDomains, config }) {
  store.appendEvent(runId, {
    phase: "whois-rdap",
    severity: "ok",
    source: "engine",
    message: "Running WHOIS/RDAP and alternate TLD intel preflight before enumeration."
  });
  const suggestions = await suggestWhoisPivots({ store, runId, domains: rootDomains });
  const rdapDomains = filterScopeDomains({ domains: suggestions.associatedDomains || [], config, rootDomains });
  if (rdapDomains.length > 0) {
    saveBootstrapDomains({ store, runId, targetName, domains: rdapDomains, roots: rootDomains, source: "rdap-associated-domain" });
  }
  const alternateTldLeads = generateAlternateTldLeads({ rootDomains, config });
  if (alternateTldLeads.length > 0) store.saveAssetLeads(runId, targetName, alternateTldLeads);
  runCandidateCorrelation({ store, runId, targetName, rootDomains, leads: alternateTldLeads, config });
  store.appendEvent(runId, {
    phase: "whois-rdap",
    severity: rdapDomains.length || alternateTldLeads.length ? "ok" : "warn",
    source: "rdap",
    message: `Intel preflight saved ${rdapDomains.length} RDAP-associated seeds and ${alternateTldLeads.length} alternate TLD review leads.`
  });
  return [...new Set([...rootDomains, ...rdapDomains])];
}

async function expandFullReconRoots({ store, runId, targetName, rootDomains, config, fullRecon }) {
  const include = (fullRecon.include || []).map((value) => String(value || "").trim()).filter(Boolean);
  const exclude = fullRecon.exclude || [];
  const mode = fullRecon.mode || "preview";
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
      exclude,
      mode,
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
    recordReverseWhoisQueryFailure(store, runId, targetName, { mode, include, exclude }, error);
    store.appendEvent(runId, {
      phase: "provider-discovery",
      severity: "warn",
      source: "whoisxmlapi",
      message: `Full recon continues without Reverse WHOIS: ${error.message}`
    });
    return rootDomains;
  }
}

module.exports = {
  collectReverseWhoisDomains,
  expandFullReconRoots,
  formatWhoisSuggestionSummary,
  recordReverseWhoisQueryFailure,
  runReconIntelPreflight,
  saveReverseWhoisResult,
  suggestWhoisPivots
};
