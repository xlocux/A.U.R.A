"use strict";

const { extractDomains, normalizeDomain } = require("../domain-utils");
const { domainBrandTokens, isNoisyTerm, isTargetRelatedTerm } = require("./rdap-suggestions");

const WHOISFREAKS_ENDPOINT = "https://api.whoisfreaks.com/v1.0/whois";

function buildWhoisFreaksUrl({ apiKey, domainName, whois = "historical" }) {
  const url = new URL(WHOISFREAKS_ENDPOINT);
  url.searchParams.set("whois", whois);
  url.searchParams.set("domainName", domainName);
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

async function callWhoisFreaksHistorical({ apiKey, domainName, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("WhoisFreaks API key is required");
  const domain = normalizeDomain(domainName);
  if (!domain) throw new Error("A valid domain is required");
  const response = await fetchImpl(buildWhoisFreaksUrl({ apiKey, domainName: domain, whois: "historical" }), {
    headers: { Accept: "application/json", "User-Agent": "AURA recon/0.1" }
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`WhoisFreaks returned non-JSON response: HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`WhoisFreaks HTTP ${response.status}: ${json.message || json.error || text.slice(0, 160)}`);
  }
  return parseWhoisFreaksHistoricalResponse(json, [domain]);
}

function parseWhoisFreaksHistoricalResponse(response, rootDomains = []) {
  const roots = [...new Set((rootDomains || []).map(normalizeDomain).filter(Boolean))];
  const records = normalizeHistoricalRecords(response);
  const brandTokens = domainBrandTokens(roots);
  const candidates = new Map();
  for (const record of records) {
    for (const term of extractHistoricalTerms(record)) {
      if (isNoisyTerm(term) || !isTargetRelatedTerm(term, brandTokens)) continue;
      candidates.set(term.toLowerCase(), term);
    }
  }
  return {
    records,
    domains: extractDomains(JSON.stringify(records), roots),
    includeTerms: [...candidates.values()].slice(0, 4),
    totalRecords: records.length
  };
}

function normalizeHistoricalRecords(response) {
  const containers = Array.isArray(response) ? response : [response];
  return containers.flatMap((item) => {
    if (Array.isArray(item?.whois_domains_historical)) return item.whois_domains_historical;
    if (Array.isArray(item?.whois_records)) return item.whois_records;
    if (item?.domain_name || item?.domainName) return [item];
    return [];
  });
}

function extractHistoricalTerms(record) {
  const terms = [];
  for (const section of ["registrant_contact", "administrative_contact", "technical_contact", "billing_contact", "reseller_contact"]) {
    const contact = record?.[section] || {};
    for (const field of ["company", "name", "email_address"]) {
      const value = normalizeHistoricalTerm(contact[field]);
      if (value) terms.push(value);
    }
  }
  const registrar = normalizeHistoricalTerm(record?.domain_registrar?.registrar_name);
  if (registrar) terms.push(registrar);
  return [...new Set(terms)];
}

function normalizeHistoricalTerm(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[<>"{}[\]]/g, "")
    .trim();
  if (!text || /^n\/a$/i.test(text) || text.length < 3 || text.length > 80) return null;
  if (/^[\w.-]+@[\w.-]+$/.test(text)) return text.split("@")[1];
  return text;
}

module.exports = {
  WHOISFREAKS_ENDPOINT,
  buildWhoisFreaksUrl,
  callWhoisFreaksHistorical,
  parseWhoisFreaksHistoricalResponse
};
