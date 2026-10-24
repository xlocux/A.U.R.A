"use strict";

const { normalizeDomain, rootForDomain } = require("../../recon/domain-utils");

const DEFAULT_ALTERNATE_TLDS = [
  "com", "net", "org", "info", "biz", "io", "co", "app", "dev", "cloud", "ai", "tech", "site", "online",
  "store", "shop", "me", "tv", "xyz", "security", "it", "uk", "us", "ca", "au", "de", "fr", "es", "nl",
  "ch", "se", "no", "dk", "fi", "pl", "br", "mx", "in", "jp", "kr", "cn"
];
const MAX_ALTERNATE_TLD_LEADS = 50;
const SECOND_LEVEL_TLDS = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);

function normalizeDomainList(values) {
  return [...new Set((values || []).map(normalizeDomain).filter(Boolean))];
}

function matchesDomainRule(domain, rule) {
  return domain === rule || domain.endsWith(`.${rule}`);
}

function extractBrandTerms(rootDomains) {
  const terms = new Set();
  for (const root of (rootDomains || []).map(normalizeDomain).filter(Boolean)) {
    const labels = root.split(".");
    const isCountrySecondLevel = labels.length > 2 && labels.at(-1).length === 2 && SECOND_LEVEL_TLDS.has(labels.at(-2));
    const brand = isCountrySecondLevel ? labels.at(-3) : labels.length > 1 ? labels.at(-2) : labels[0];
    if (/^[a-z0-9][a-z0-9-]{2,62}$/.test(brand)) terms.add(brand);
  }
  return [...terms];
}

function filterScopeDomains({ domains, config, rootDomains }) {
  const excluded = normalizeDomainList(config?.scope?.out_of_scope);
  const roots = normalizeDomainList(rootDomains);
  return normalizeDomainList(domains)
    .filter((domain) => !excluded.some((rule) => matchesDomainRule(domain, rule)))
    .filter((domain) => roots.length === 0 || roots.some((root) => matchesDomainRule(domain, root)));
}

function generateAlternateTldLeads({ rootDomains, config }) {
  const excluded = normalizeDomainList(config?.scope?.out_of_scope);
  const roots = new Set(normalizeDomainList(rootDomains));
  const leads = new Map();
  for (const root of roots) {
    if (root.split(".").length < 2) continue;
    const brand = extractBrandTerms([root])[0];
    if (!brand) continue;
    for (const tld of DEFAULT_ALTERNATE_TLDS) {
      const candidate = normalizeDomain(`${brand}.${tld}`);
      if (!candidate || roots.has(candidate) || leads.has(candidate)) continue;
      if (excluded.some((rule) => matchesDomainRule(candidate, rule))) continue;
      leads.set(candidate, {
        leadType: "domain_candidate",
        value: candidate,
        source: "alternate-tld-correlation",
        confidence: "candidate",
        matchTerms: [brand],
        metadata: {
          rootDomain: root,
          reason: "Same registrable label on an alternate TLD. Review scope before scanning."
        }
      });
    }
  }
  return [...leads.values()].slice(0, MAX_ALTERNATE_TLD_LEADS);
}

function inferRootsFromDomainRows(rows) {
  const roots = new Set();
  for (const row of rows || []) {
    const domain = normalizeDomain(row?.domain || row?.host || row);
    if (!domain) continue;
    const parts = domain.split(".");
    roots.add(parts.length > 2 ? parts.slice(-2).join(".") : domain);
  }
  return [...roots].sort();
}

function saveBootstrapDomains({ store, runId, targetName, domains, roots, source }) {
  if (!domains.length) return 0;
  return store.saveDomains(runId, targetName, domains.map((domain) => ({
    domain,
    rootDomain: rootForDomain(domain, roots) || domain,
    kind: roots.includes(domain) ? "root" : "associated",
    source,
    metadata: { runId }
  })));
}

module.exports = {
  DEFAULT_ALTERNATE_TLDS,
  extractBrandTerms,
  filterScopeDomains,
  generateAlternateTldLeads,
  inferRootsFromDomainRows,
  normalizeDomainList,
  saveBootstrapDomains
};
