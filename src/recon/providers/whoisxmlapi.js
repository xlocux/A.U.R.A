"use strict";

const https = require("node:https");
const { extractDomains, normalizeDomain } = require("../domain-utils");

const ENDPOINT = "https://reverse-whois.whoisxmlapi.com/api/v2";
const WHOIS_ENDPOINT = "https://www.whoisxmlapi.com/whoisserver/WhoisService";
const DOMAIN_INFO_ENDPOINT = "https://domain-info.whoisxmlapi.com/api/v1";
const SUBDOMAINS_ENDPOINT = "https://subdomains.whoisxmlapi.com/api/v1";

function normalizeTerms(terms) {
  return [...new Set((terms || [])
    .map((term) => String(term || "").trim())
    .filter(Boolean))]
    .slice(0, 4);
}

function buildReverseWhoisRequest({
  apiKey,
  include,
  exclude = [],
  mode = "preview",
  searchType = "current",
  includeAuditDates = true,
  punycode = true,
  searchAfter = null
}) {
  const includeTerms = normalizeTerms(include);
  const excludeTerms = normalizeTerms(exclude);
  if (includeTerms.length === 0) {
    throw new Error("Reverse WHOIS requires at least one include term");
  }
  if (!["preview", "purchase"].includes(mode)) {
    throw new Error("Reverse WHOIS mode must be preview or purchase");
  }
  if (!["current", "historic"].includes(searchType)) {
    throw new Error("Reverse WHOIS searchType must be current or historic");
  }

  const body = {
    searchType,
    mode,
    punycode,
    includeAuditDates,
    responseFormat: "json",
    basicSearchTerms: {
      include: includeTerms,
      exclude: excludeTerms
    }
  };
  if (apiKey) body.apiKey = apiKey;
  if (searchAfter) body.searchAfter = searchAfter;
  return body;
}

function callReverseWhois(options) {
  const apiKey = options.apiKey || process.env.WHOISXMLAPI_KEY || process.env.WHOISXML_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error("Set WHOISXMLAPI_KEY to use Reverse WHOIS"));
  }
  const body = buildReverseWhoisRequest({ ...options, apiKey });
  return postJson(ENDPOINT, body, {
    "X-Authentication-Token": apiKey
  }).then((response) => parseReverseWhoisResponse(response, body));
}

async function collectWhoisXmlDrsDomains({ apiKey, rootDomain, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("WhoisXMLAPI key is required");
  const root = normalizeDomain(rootDomain);
  if (!root) throw new Error("A valid root domain is required");
  const calls = await Promise.allSettled([
    callWhoisApi({ apiKey, domainName: root, fetchImpl }),
    callDomainInfoApi({ apiKey, domainName: root, fetchImpl }),
    callSubdomainsLookupApi({ apiKey, domainName: root, fetchImpl })
  ]);
  const successful = calls.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (successful.length === 0) {
    const firstError = calls.find((result) => result.status === "rejected")?.reason;
    throw firstError || new Error("WhoisXMLAPI DRS calls failed");
  }
  const raw = successful.map((result) => result.raw);
  return {
    domains: extractDomains(JSON.stringify(raw), [root]),
    metadata: {
      mode: "whoisxmlapi-drs",
      products: successful.map((result) => result.product),
      pivots: successful.flatMap((result) => result.pivots || [])
    }
  };
}

async function callWhoisApi({ apiKey, domainName, fetchImpl = fetch }) {
  const url = new URL(WHOIS_ENDPOINT);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("domainName", domainName);
  url.searchParams.set("outputFormat", "JSON");
  const raw = await requestJsonFetch(url.toString(), { fetchImpl });
  return {
    product: "whois",
    raw,
    pivots: extractWhoisPivots(raw)
  };
}

async function callDomainInfoApi({ apiKey, domainName, fetchImpl = fetch }) {
  const url = new URL(DOMAIN_INFO_ENDPOINT);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("domainName", domainName);
  const raw = await requestJsonFetch(url.toString(), { fetchImpl });
  return {
    product: "domain-info",
    raw,
    pivots: extractWhoisPivots(raw)
  };
}

async function callSubdomainsLookupApi({ apiKey, domainName, fetchImpl = fetch }) {
  const url = new URL(SUBDOMAINS_ENDPOINT);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("domainName", domainName);
  url.searchParams.set("outputFormat", "JSON");
  const raw = await requestJsonFetch(url.toString(), { fetchImpl });
  return {
    product: "subdomains",
    raw,
    pivots: []
  };
}

async function requestJsonFetch(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": "AURA recon/0.1" },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`WhoisXMLAPI returned non-JSON response: HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`WhoisXMLAPI HTTP ${response.status}: ${json.message || json.error || text.slice(0, 180)}`);
  }
  return json;
}

function extractWhoisPivots(raw) {
  const record = raw?.WhoisRecord || raw?.whoisRecord || raw || {};
  const registrant = record.registrant || record.registryData?.registrant || {};
  const administrative = record.administrativeContact || record.registryData?.administrativeContact || {};
  const technical = record.technicalContact || record.registryData?.technicalContact || {};
  const nameservers = record.nameServers?.hostNames || record.registryData?.nameServers?.hostNames || [];
  return [
    pivot("registrant-organization", registrant.organization),
    pivot("registrant-email", registrant.email),
    pivot("admin-organization", administrative.organization),
    pivot("tech-organization", technical.organization),
    ...nameservers.map((value) => pivot("nameserver", value))
  ].filter(Boolean);
}

function pivot(type, value) {
  const text = String(value || "").trim();
  return text ? { type, value: text } : null;
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const request = https.request({
      method: "POST",
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "User-Agent": "AURA recon/0.1",
        ...headers
      },
      timeout: 60000
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        let json = null;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          reject(new Error(`Reverse WHOIS returned non-JSON response: HTTP ${response.statusCode}`));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Reverse WHOIS HTTP ${response.statusCode}: ${json.message || json.error || text}`));
          return;
        }
        resolve(json);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Reverse WHOIS request timed out")));
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function parseReverseWhoisResponse(response, requestBody) {
  const leads = [];
  for (const item of response.domainsList || []) {
    const domain = normalizeDomain(typeof item === "string" ? item : item.domainName);
    if (!domain) continue;
    leads.push({
      domain,
      source: "whoisxmlapi-reverse-whois",
      confidence: "candidate",
      matchTerms: requestBody.basicSearchTerms.include,
      metadata: {
        audit: typeof item === "object" ? item.audit || null : null,
        searchType: requestBody.searchType,
        mode: requestBody.mode
      }
    });
  }

  return {
    provider: "whoisxmlapi",
    mode: requestBody.mode,
    searchType: requestBody.searchType,
    include: requestBody.basicSearchTerms.include,
    exclude: requestBody.basicSearchTerms.exclude,
    domainsCount: response.domainsCount || leads.length,
    nextPageSearchAfter: response.nextPageSearchAfter || null,
    leads,
    raw: response
  };
}

module.exports = {
  buildReverseWhoisRequest,
  callDomainInfoApi,
  callReverseWhois,
  callSubdomainsLookupApi,
  callWhoisApi,
  collectWhoisXmlDrsDomains,
  parseReverseWhoisResponse
};
