"use strict";

const https = require("node:https");
const { normalizeDomain } = require("../domain-utils");

const ENDPOINT = "https://reverse-whois.whoisxmlapi.com/api/v2";

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
  callReverseWhois,
  parseReverseWhoisResponse
};
