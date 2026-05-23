"use strict";

const { normalizeDomain } = require("../domain-utils");

const RDAP_BASE_URL = "https://rdap.org/domain/";
const MAX_INCLUDE_TERMS = 4;
const DEFAULT_EXCLUDE_TERMS = [
  "privacy",
  "proxy",
  "redacted",
  "whoisguard",
  "domains by proxy",
  "gdpr"
];
const RESERVED_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "invalid",
  "localhost",
  "test"
]);
const GENERIC_DOMAIN_TOKENS = new Set([
  "www",
  "app",
  "api",
  "mail",
  "admin",
  "login",
  "portal",
  "secure",
  "dev",
  "stage",
  "staging",
  "test"
]);

const NOISE_PATTERNS = [
  /privacy/i,
  /proxy/i,
  /redacted/i,
  /whoisguard/i,
  /data protected/i,
  /identity protect/i,
  /domains by proxy/i,
  /domain administrator/i,
  /registrar/i,
  /abuse/i,
  /gdpr/i,
  /withheld/i,
  /not disclosed/i,
  /internet assigned numbers authority/i,
  /\biana\b/i,
  /\bicann\b/i,
  /\bregistry\b/i,
  /\bregistries\b/i,
  /reserved/i,
  /verisign/i,
  /public interest registry/i
];

async function suggestReverseWhoisTerms({ domains, fetchImpl = fetch } = {}) {
  const rootDomains = [...new Set((domains || []).map(normalizeDomain).filter(Boolean))].slice(0, 10);
  const records = [];
  for (const domain of rootDomains) {
    records.push(await fetchRdapRecord({ domain, fetchImpl }));
  }
  return suggestReverseWhoisTermsFromRdapRecords(records, rootDomains);
}

async function fetchRdapRecord({ domain, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(`${RDAP_BASE_URL}${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/rdap+json, application/json" }
    });
    const data = await response.json().catch(() => ({}));
    return {
      domain,
      status: response.ok ? "completed" : "failed",
      httpStatus: response.status,
      raw: data,
      error: response.ok ? null : data.description?.[0] || data.errorCode || response.statusText
    };
  } catch (error) {
    return {
      domain,
      status: "failed",
      httpStatus: null,
      raw: {},
      error: error.message
    };
  }
}

function suggestReverseWhoisTermsFromRdapRecords(records, domains = []) {
  const normalizedDomains = (domains || []).map(normalizeDomain).filter(Boolean);
  const brandTokens = domainBrandTokens(normalizedDomains);
  const candidates = new Map();
  for (const record of records || []) {
    for (const candidate of extractRdapCandidates(record)) {
      const existing = candidates.get(candidate.value);
      if (!existing || candidate.score > existing.score) {
        candidates.set(candidate.value, candidate);
      }
    }
  }

  const includeTerms = [...candidates.values()]
    .filter((candidate) => !isNoisyTerm(candidate.value))
    .filter((candidate) => isTargetRelatedTerm(candidate.value, brandTokens))
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
    .slice(0, MAX_INCLUDE_TERMS);

  const skippedPrivate = [...candidates.values()]
    .filter((candidate) => isNoisyTerm(candidate.value) || !isTargetRelatedTerm(candidate.value, brandTokens))
    .map((candidate) => candidate.value);
  const associatedDomains = [...new Set((records || [])
    .flatMap((record) => extractRdapAssociatedDomains(record))
    .filter((domain) => isTargetRelatedTerm(domain, brandTokens)))];

  return {
    domains: normalizedDomains,
    includeTerms: includeTerms.map((term) => term.value),
    excludeTerms: DEFAULT_EXCLUDE_TERMS,
    associatedDomains,
    suggestions: includeTerms,
    skippedPrivate,
    records: (records || []).map((record) => ({
      domain: record.domain,
      status: record.status,
      httpStatus: record.httpStatus,
      error: record.error || null
    })),
    rationale: includeTerms.length > 0
      ? "Suggested terms come from target-related, non-private RDAP organization/contact fields."
      : "No useful organization terms were found. RDAP/WHOIS data may be private, redacted, registrar-only, reserved, or not clearly tied to the target."
  };
}

function extractRdapCandidates(record) {
  const raw = record?.raw || {};
  const candidates = [];
  for (const entity of raw.entities || []) {
    const roles = (entity.roles || []).join(",");
    for (const item of extractVcardValues(entity.vcardArray)) {
      const score = item.field === "org" ? 95 : item.field === "fn" ? 75 : 45;
      addCandidate(candidates, item.value, {
        source: "rdap",
        field: item.field,
        roles,
        score,
        evidence: `${record.domain}: ${item.field}${roles ? ` (${roles})` : ""}`
      });
    }
  }
  addCandidate(candidates, raw.name, {
    source: "rdap",
    field: "name",
    roles: "",
    score: 35,
    evidence: `${record.domain}: domain name`
  });
  return candidates;
}

function extractVcardValues(vcardArray) {
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return [];
  const values = [];
  for (const entry of vcardArray[1]) {
    if (!Array.isArray(entry) || entry.length < 4) continue;
    const field = String(entry[0] || "").toLowerCase();
    if (!["fn", "org", "email"].includes(field)) continue;
    const rawValue = entry[3];
    const flattened = Array.isArray(rawValue) ? rawValue.flat(Infinity).join(" ") : rawValue;
    const value = normalizeTerm(flattened);
    if (value) values.push({ field, value });
  }
  return values;
}

function extractRdapAssociatedDomains(record) {
  const raw = record?.raw || {};
  const domains = [];
  for (const nameserver of raw.nameservers || []) {
    const domain = normalizeDomain(nameserver.ldhName || nameserver.unicodeName || nameserver.name);
    if (domain) domains.push(domain);
  }
  for (const entity of raw.entities || []) {
    for (const item of extractVcardValues(entity.vcardArray)) {
      const domain = normalizeDomain(item.value);
      if (domain) domains.push(domain);
    }
  }
  return [...new Set(domains)];
}

function addCandidate(candidates, value, metadata) {
  const normalized = normalizeTerm(value);
  if (!normalized) return;
  candidates.push({
    value: normalized,
    source: metadata.source,
    field: metadata.field,
    roles: metadata.roles,
    score: isNoisyTerm(normalized) ? 1 : metadata.score,
    evidence: metadata.evidence
  });
}

function normalizeTerm(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[<>"{}[\]]/g, "")
    .trim();
  if (text.length < 3 || text.length > 80) return null;
  if (/^https?:\/\//i.test(text)) return null;
  if (/^[\w.-]+@[\w.-]+$/.test(text)) return text.split("@")[1];
  return text;
}

function isNoisyTerm(value) {
  const text = String(value || "").trim();
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function domainBrandTokens(domains) {
  const tokens = new Set();
  for (const domain of domains || []) {
    if (RESERVED_DOMAINS.has(domain)) continue;
    const labels = domain.split(".").filter(Boolean);
    const candidate = labels.length > 1 ? labels[labels.length - 2] : labels[0];
    for (const token of String(candidate || "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length >= 3 && !GENERIC_DOMAIN_TOKENS.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

function isTargetRelatedTerm(value, brandTokens) {
  if (!brandTokens || brandTokens.size === 0) return false;
  const text = String(value || "").toLowerCase();
  return [...brandTokens].some((token) => text.includes(token));
}

module.exports = {
  DEFAULT_EXCLUDE_TERMS,
  fetchRdapRecord,
  suggestReverseWhoisTerms,
  suggestReverseWhoisTermsFromRdapRecords
};
