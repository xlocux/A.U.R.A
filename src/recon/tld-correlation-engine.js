"use strict";

const { normalizeDomain } = require("./domain-utils");

function calculateTLDConfidence(tldCandidate, existingObservations = []) {
  const candidate = normalizeCandidate(tldCandidate);
  const observations = Array.isArray(existingObservations) ? existingObservations : [];
  let confidenceScore = 0;
  const signals = [];
  const correlatedWith = new Set();

  function add(signal, weight, evidence, observation = null) {
    confidenceScore += weight;
    signals.push({ signal, weight, evidence });
    if (observation?.id) correlatedWith.add(observation.id);
  }

  if (candidate.sourceTools.includes("crt_sh") || candidate.sourceTools.includes("certificate_transparency")) {
    add(
      "certificate_transparency",
      60,
      `Found in certificate transparency: ${candidate.certificateSans.length} SAN names`
    );
  }

  if (candidate.hasDnsResolution && candidate.dnsRecords.a_record) {
    add("dns_resolution", 20, `A record resolves: ${candidate.dnsRecords.a_record}`);
  }

  const whoisObservation = observations.find((item) =>
    item.type === "whois_record" &&
    item.registrable_label === candidate.registrableLabel
  );
  const whoisMatch = whoisOwnerMatch(whoisObservation, candidate);
  if (whoisMatch.is_match) {
    add("whois_organization_match", 15, `Same organization: ${whoisMatch.organization}`, whoisObservation);
  }

  const sameIp = observations.find((item) =>
    item.type === "ip_address" &&
    item.value === candidate.dnsRecords.a_record
  );
  if (sameIp) {
    add("same_ip_address", 15, `IP ${sameIp.value} already appears in stored evidence`, sameIp);
  }

  const sameCidr = findCIDROverlap(candidate.dnsRecords.a_record, observations);
  if (sameCidr) {
    add("cidr_block_overlap", 10, `Within authorized CIDR ${sameCidr.value || sameCidr.cidr}`, sameCidr);
  }

  const faviconObservation = observations.find((item) =>
    item.type === "favicon_hash" &&
    item.registrable_label === candidate.registrableLabel &&
    String(item.value || "") === String(candidate.faviconHash || "")
  );
  if (faviconObservation && candidate.faviconHash) {
    add("favicon_hash_match", 10, `Favicon hash matches: ${candidate.faviconHash}`, faviconObservation);
  }

  const nameserverObservation = observations.find((item) =>
    item.type === "dns_record" &&
    item.record_type === "NS" &&
    item.registrable_label === candidate.registrableLabel
  );
  const nsMatch = nameserverMatch(nameserverObservation?.value, candidate.nameservers);
  if (nsMatch.overlapping_count > 0) {
    add("nameserver_overlap", 10, `${nsMatch.overlapping_count}/${nsMatch.total_ns} nameservers match`, nameserverObservation);
  }

  const sanObservation = candidate.certificateSans.find((san) =>
    observations.some((item) => item.type === "domain" && normalizeDomain(item.value) === normalizeDomain(san))
  );
  if (sanObservation) {
    add("certificate_san_match", 5, "SAN names match existing domains");
  }

  const rdapObservation = observations.find((item) =>
    item.type === "rdap_record" &&
    item.registrable_label === candidate.registrableLabel
  );
  const acquisitionMatch = findAcquisitionEvidence(rdapObservation);
  if (acquisitionMatch) {
    add("acquisition_evidence", 10, `RDAP shows same owner/organization: ${acquisitionMatch.organization}`, rdapObservation);
  }

  const explicitExclusion = observations.find((item) =>
    item.type === "domain" &&
    normalizeDomain(item.value) === candidate.value &&
    item.scope_status === "out_of_scope"
  );
  if (explicitExclusion) {
    add("explicit_exclusion", -50, "This TLD is explicitly out-of-scope", explicitExclusion);
  }

  const finalConfidence = Math.min(100, Math.max(0, confidenceScore));
  return {
    confidence_score: finalConfidence,
    confidence_level: getConfidenceLevel(finalConfidence),
    signals,
    promotion_eligible: finalConfidence === 100,
    requires_review: finalConfidence < 100,
    correlated_with: [...correlatedWith],
    reasoning: buildReasoning(signals, finalConfidence)
  };
}

function scopeEvaluateTldCandidate(observation) {
  const result = observation?.correlation_engine_result || observation?.correlationEngineResult;
  if (!result) {
    return {
      scope_status: "unknown",
      promotion_eligible: false,
      requires_review: true,
      rationale: "Alternate TLD - requires manual authorization",
      confidence: "candidate"
    };
  }
  if (result.confidence_score === 100 && result.promotion_eligible) {
    return {
      scope_status: "in_scope",
      promotion_eligible: true,
      requires_review: false,
      rationale: "TLD verified 100% via correlation engine - auto-promoted",
      confidence: "verified_100"
    };
  }
  if (result.confidence_score >= 60) {
    return {
      scope_status: "unknown",
      promotion_eligible: true,
      requires_review: true,
      rationale: `TLD ${result.confidence_score}% confidence - requires user approval`,
      confidence: confidenceLabel(result.confidence_score)
    };
  }
  return {
    scope_status: "unknown",
    promotion_eligible: false,
    requires_review: true,
    rationale: "Alternate TLD has insufficient correlation evidence",
    confidence: confidenceLabel(result.confidence_score)
  };
}

function buildTldCandidateFromLead(lead) {
  const value = normalizeDomain(lead?.value || lead?.domain);
  const metadata = lead?.metadata || {};
  return normalizeCandidate({
    type: "domain_tld_candidate",
    value,
    registrable_label: metadata.registrableLabel || extractRegistrableLabel(value),
    tld: metadata.tld || extractTld(value),
    source_tools: metadata.sourceTools || metadata.source_tools || [lead?.source].filter(Boolean),
    certificate_sans: metadata.certificateSans || metadata.certificate_sans || [],
    has_dns_resolution: Boolean(metadata.hasDnsResolution || metadata.dnsRecords?.a_record || metadata.aRecord),
    dns_records: metadata.dnsRecords || { a_record: metadata.aRecord || metadata.ip || null },
    whois_organization: metadata.whoisOrganization || metadata.organization || null,
    favicon_hash: metadata.faviconHash || null,
    nameservers: metadata.nameservers || metadata.nameServers || []
  });
}

function buildExistingObservations({ rootDomains = [], domains = [], httpServices = [], assetLeads = [], outOfScope = [] } = {}) {
  const observations = [];
  for (const domain of rootDomains) {
    const value = normalizeDomain(domain);
    if (value) observations.push({ id: `root:${value}`, type: "domain", value, registrable_label: extractRegistrableLabel(value), scope_status: "in_scope" });
  }
  for (const domain of domains || []) {
    const value = normalizeDomain(domain.domain || domain.value);
    const metadata = domain.metadata || {};
    if (!value) continue;
    observations.push({ id: `domain:${domain.id || value}`, type: "domain", value, registrable_label: extractRegistrableLabel(value), scope_status: domain.status || "discovered" });
    pushMetadataObservations(observations, value, metadata, `domain:${domain.id || value}`);
  }
  for (const service of httpServices || []) {
    const host = normalizeDomain(service.host || hostFromUrl(service.url));
    const metadata = service.raw || service.metadata || {};
    if (!host) continue;
    pushMetadataObservations(observations, host, metadata, `service:${service.id || service.url || host}`);
  }
  for (const lead of assetLeads || []) {
    const value = normalizeDomain(lead.value || lead.domain);
    const metadata = lead.metadata || {};
    if (!value) continue;
    pushMetadataObservations(observations, value, metadata, `lead:${lead.id || value}`);
  }
  for (const rule of outOfScope || []) {
    const value = normalizeDomain(rule);
    if (value) observations.push({ id: `out:${value}`, type: "domain", value, registrable_label: extractRegistrableLabel(value), scope_status: "out_of_scope" });
    if (String(rule || "").includes("/")) observations.push({ id: `cidr:${rule}`, type: "cidr_block", value: String(rule).trim() });
  }
  return observations;
}

function pushMetadataObservations(observations, domain, metadata, idPrefix) {
  const label = extractRegistrableLabel(domain);
  for (const ip of [metadata.ip, metadata.aRecord, metadata.dnsRecords?.a_record, metadata.host_ip].flat().filter(Boolean)) {
    observations.push({ id: `${idPrefix}:ip:${ip}`, type: "ip_address", value: String(ip), registrable_label: label });
  }
  for (const cidr of [metadata.cidr, metadata.cidrBlock].flat().filter(Boolean)) {
    observations.push({ id: `${idPrefix}:cidr:${cidr}`, type: "cidr_block", value: String(cidr), registrable_label: label });
  }
  if (metadata.faviconHash) observations.push({ id: `${idPrefix}:favicon`, type: "favicon_hash", value: String(metadata.faviconHash), registrable_label: label });
  const nameservers = metadata.nameservers || metadata.nameServers || [];
  if (nameservers.length) observations.push({ id: `${idPrefix}:ns`, type: "dns_record", record_type: "NS", value: normalizeList(nameservers), registrable_label: label });
  const organization = metadata.organization || metadata.whoisOrganization || metadata.registrar || null;
  if (organization) observations.push({ id: `${idPrefix}:whois`, type: "whois_record", organization: String(organization), registrable_label: label });
  const rdapEntities = metadata.rdapEntities || metadata.entities || null;
  if (rdapEntities) observations.push({ id: `${idPrefix}:rdap`, type: "rdap_record", entities: rdapEntities, registrable_label: label });
}

function normalizeCandidate(candidate = {}) {
  const value = normalizeDomain(candidate.value);
  return {
    value,
    registrableLabel: candidate.registrable_label || candidate.registrableLabel || extractRegistrableLabel(value),
    tld: candidate.tld || extractTld(value),
    sourceTools: normalizeList(candidate.source_tools || candidate.sourceTools),
    certificateSans: normalizeList(candidate.certificate_sans || candidate.certificateSans),
    hasDnsResolution: Boolean(candidate.has_dns_resolution || candidate.hasDnsResolution),
    dnsRecords: candidate.dns_records || candidate.dnsRecords || {},
    whoisOrganization: candidate.whois_organization || candidate.whoisOrganization || "",
    faviconHash: candidate.favicon_hash || candidate.faviconHash || "",
    nameservers: normalizeList(candidate.nameservers)
  };
}

function whoisOwnerMatch(existingWhois, candidate) {
  if (!existingWhois) return { is_match: false, organization: "" };
  const existingOrg = normalizeOrg(existingWhois.organization || existingWhois.registrar);
  const candidateOrg = normalizeOrg(candidate.whoisOrganization);
  const isMatch = Boolean(existingOrg && candidateOrg && (existingOrg === candidateOrg || existingOrg.includes(candidateOrg) || candidateOrg.includes(existingOrg)));
  return { is_match: isMatch, organization: existingOrg };
}

function findCIDROverlap(ip, observations) {
  if (!ip) return null;
  return observations.find((item) => item.type === "cidr_block" && ipInCIDR(ip, item.value || item.cidr)) || null;
}

function ipInCIDR(ip, cidr) {
  const [range, bitsText] = String(cidr || "").split("/");
  const bits = Number(bitsText);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function nameserverMatch(existingNsList, candidateNsList) {
  const existing = normalizeList(existingNsList);
  const candidate = normalizeList(candidateNsList);
  const overlapping = existing.filter((ns) => candidate.includes(ns));
  return {
    overlapping_count: overlapping.length,
    total_ns: Math.max(existing.length, candidate.length)
  };
}

function findAcquisitionEvidence(rdapData) {
  const entities = rdapData?.entities;
  if (!Array.isArray(entities) || entities.length === 0) return null;
  const first = entities.find((entity) => entity?.name || entity?.vcardArray) || entities[0];
  return { organization: first.name || extractVcardName(first.vcardArray) || "RDAP entity" };
}

function buildReasoning(signals, finalScore) {
  const positive = signals.filter((item) => item.weight > 0);
  const negative = signals.filter((item) => item.weight < 0);
  const lines = [`TLD candidate evaluated with confidence score: ${finalScore}%`, "", "Supporting evidence:"];
  if (positive.length === 0) lines.push("  - none");
  for (const signal of positive) lines.push(`  - [+${signal.weight}] ${signal.signal}: ${signal.evidence}`);
  if (negative.length > 0) {
    lines.push("", "Conflicting evidence:");
    for (const signal of negative) lines.push(`  - [${signal.weight}] ${signal.signal}: ${signal.evidence}`);
  }
  lines.push("", `Conclusion: ${finalScore === 100 ? "AUTO-PROMOTED - 100% verified ownership" : finalScore >= 80 ? "High confidence - recommended for approval" : finalScore >= 60 ? "Medium confidence - requires manual review" : "Low confidence - additional validation needed"}`);
  return lines.join("\n");
}

function getConfidenceLevel(score) {
  if (score === 100) return "VERIFIED_100";
  if (score >= 80) return "VERY_HIGH";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  if (score >= 20) return "LOW";
  return "MINIMAL";
}

function confidenceLabel(score) {
  if (score === 100) return "verified_100";
  if (score >= 80) return "very_high";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function extractRegistrableLabel(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return "";
  const parts = normalized.split(".");
  const secondLevelTlds = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);
  const isCountrySecondLevel = parts.length > 2 && parts.at(-1).length === 2 && secondLevelTlds.has(parts.at(-2));
  return isCountrySecondLevel ? parts.at(-3) : parts.length > 1 ? parts.at(-2) : parts[0];
}

function extractTld(domain) {
  const normalized = normalizeDomain(domain);
  return normalized ? normalized.split(".").at(-1) : "";
}

function normalizeList(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || "").split(/[,\s]+/)).map((item) => normalizeDomain(item) || String(item || "").trim().toLowerCase()).filter(Boolean))];
}

function normalizeOrg(value) {
  return String(value || "").toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|srl|spa)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function ipv4ToInt(ip) {
  const parts = String(ip || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function extractVcardName(vcardArray) {
  if (!Array.isArray(vcardArray)) return "";
  const entries = Array.isArray(vcardArray[1]) ? vcardArray[1] : [];
  const org = entries.find((entry) => entry?.[0] === "org");
  return Array.isArray(org?.[3]) ? org[3].join(" ") : org?.[3] || "";
}

module.exports = {
  buildExistingObservations,
  buildTldCandidateFromLead,
  calculateTLDConfidence,
  confidenceLabel,
  extractRegistrableLabel,
  extractTld,
  getConfidenceLevel,
  ipInCIDR,
  nameserverMatch,
  scopeEvaluateTldCandidate,
  whoisOwnerMatch
};
