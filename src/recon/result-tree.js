"use strict";

function buildResultTree({ run, target, counts, domains, httpServices, urls, screenshots, assetLeads, delta }) {
  const rootMap = new Map();
  const nodeIndex = new Map();
  const addedDomains = new Set((delta?.domains?.added || []).map((item) => lower(item.domain)));

  for (const domain of domains || []) {
    const host = lower(domain.domain);
    if (!host) continue;
    const rootName = domain.root_domain || domain.rootDomain || fallbackRoot(host);
    const root = getRoot(rootMap, rootName);
    const node = getDomainNode(root, nodeIndex, host);
    node.kind = domain.kind || node.kind;
    node.scopeStatus = domain.status || "discovered";
    node.sources = mergeCsv(node.sources, domain.source);
    node.firstSeenAt = minDate(node.firstSeenAt, domain.first_seen_at);
    node.lastSeenAt = maxDate(node.lastSeenAt, domain.last_seen_at);
    node.isNew = addedDomains.has(host);
  }

  for (const service of httpServices || []) {
    const host = lower(service.host || hostFromUrl(service.url));
    if (!host) continue;
    const root = getRoot(rootMap, fallbackRoot(host));
    const node = getDomainNode(root, nodeIndex, host);
    node.services.push(service);
    node.sources = mergeCsv(node.sources, service.source);
    for (const tech of service.technologies || []) {
      if (!node.technologies.includes(tech)) node.technologies.push(tech);
    }
  }

  for (const url of urls || []) {
    const host = lower(url.host || hostFromUrl(url.url));
    if (!host) continue;
    const root = getRoot(rootMap, fallbackRoot(host));
    const node = getDomainNode(root, nodeIndex, host);
    node.urls.push(url);
    node.parameters = [...new Set(node.parameters.concat(url.params || []))].sort();
    node.sources = mergeCsv(node.sources, url.source);
  }

  const candidateNodes = [];
  for (const lead of assetLeads || []) {
    const value = lower(lead.value);
    if (!value) continue;
    const score = Number(lead.metadata?.correlationScore || 0);
    const candidate = {
      id: `candidate:${value}:${lead.source}`,
      type: "candidate",
      domain: value,
      source: lead.source,
      status: lead.status || "review",
      confidence: lead.confidence,
      score,
      matchTerms: lead.matchTerms || [],
      rationale: lead.metadata?.correlationRationale || [],
      techniques: lead.metadata?.correlationTechniques || [],
      recommendedAction: lead.metadata?.recommendedAction || "Review before scanning.",
      correlationEngineResult: lead.metadata?.correlationEngineResult || null,
      promotionEligible: Boolean(lead.metadata?.correlationEngineResult?.promotion_eligible)
    };
    candidateNodes.push(candidate);
  }

  const roots = [...rootMap.values()]
    .map((root) => summarizeRoot(root))
    .sort((left, right) => right.summary.domains - left.summary.domains || left.domain.localeCompare(right.domain));
  const candidates = candidateNodes
    .sort((left, right) => right.score - left.score || left.domain.localeCompare(right.domain));

  return {
    run: run ? { id: run.id, targetName: run.target_name, status: run.status, startedAt: run.started_at, finishedAt: run.finished_at } : null,
    target: target ? { name: target.target_name, programUrl: target.program_url } : null,
    counts: counts || {},
    summary: summarizeTree({ roots, candidates, screenshots }),
    roots,
    candidates,
    screenshots: screenshots || [],
    delta: delta || null
  };
}

function getRoot(rootMap, rootName) {
  const key = lower(rootName) || "unknown";
  if (!rootMap.has(key)) {
    rootMap.set(key, {
      id: `root:${key}`,
      type: "root",
      domain: key,
      children: [],
      summary: emptySummary()
    });
  }
  return rootMap.get(key);
}

function getDomainNode(root, nodeIndex, host) {
  const key = lower(host);
  if (nodeIndex.has(key)) return nodeIndex.get(key);
  const node = {
    id: `domain:${key}`,
    type: "domain",
    domain: key,
    kind: key === root.domain ? "root" : "subdomain",
    scopeStatus: "discovered",
    sources: [],
    services: [],
    urls: [],
    technologies: [],
    parameters: [],
    firstSeenAt: null,
    lastSeenAt: null,
    isNew: false
  };
  root.children.push(node);
  nodeIndex.set(key, node);
  return node;
}

function summarizeRoot(root) {
  root.children.sort((left, right) => {
    const leftWeight = nodeWeight(left);
    const rightWeight = nodeWeight(right);
    return rightWeight - leftWeight || left.domain.localeCompare(right.domain);
  });
  root.summary = root.children.reduce((summary, node) => {
    summary.domains += 1;
    summary.services += node.services.length;
    summary.urls += node.urls.length;
    summary.technologies += node.technologies.length;
    summary.parameters += node.parameters.length;
    if (node.isNew) summary.newDomains += 1;
    return summary;
  }, emptySummary());
  return root;
}

function summarizeTree({ roots, candidates, screenshots }) {
  const summary = roots.reduce((total, root) => ({
    domains: total.domains + root.summary.domains,
    services: total.services + root.summary.services,
    urls: total.urls + root.summary.urls,
    technologies: total.technologies + root.summary.technologies,
    parameters: total.parameters + root.summary.parameters,
    newDomains: total.newDomains + root.summary.newDomains
  }), emptySummary());
  summary.candidates = candidates.length;
  summary.strongCandidates = candidates.filter((candidate) => candidate.score >= 80).length;
  summary.screenshotRuns = (screenshots || []).length;
  summary.screenshotCount = (screenshots || []).reduce((count, shot) => count + Number(shot.metadata?.screenshotCount || 0), 0);
  return summary;
}

function emptySummary() {
  return { domains: 0, services: 0, urls: 0, technologies: 0, parameters: 0, newDomains: 0 };
}

function nodeWeight(node) {
  return (node.isNew ? 1000 : 0) + node.services.length * 100 + node.technologies.length * 20 + node.urls.length;
}

function mergeCsv(existing, value) {
  const values = new Set(existing || []);
  for (const item of String(value || "").split(",").map((part) => part.trim()).filter(Boolean)) {
    values.add(item);
  }
  return [...values].sort();
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function fallbackRoot(hostname) {
  const parts = lower(hostname).split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  return parts.slice(-2).join(".");
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function minDate(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return left < right ? left : right;
}

function maxDate(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return left > right ? left : right;
}

module.exports = {
  buildResultTree
};
