"use strict";

const { extractDomains, normalizeDomain } = require("./domain-utils");
const { collectWhoisXmlDrsDomains } = require("./providers/whoisxmlapi");
const { callWhoisFreaksHistorical, buildWhoisFreaksUrl } = require("./providers/whoisfreaks");

const INTELX_BASE_URL = "https://free.intelx.io";
const ZOOMEYE_BASE_URL = "https://api.zoomeye.ai";

const PROVIDERS = {
  censys: {
    label: "Censys",
    secretFormat: "api_id:api_secret",
    docs: "https://docs.censys.com/docs/ls-api",
    usefulFor: ["certificate names", "host/service intelligence"],
    auth: basicAuth,
    preflight: { url: "https://search.censys.io/api/v1/account" },
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson("https://search.censys.io/api/v2/certificates/search", {
        method: "POST",
        headers: { ...basicAuth(secret), "Content-Type": "application/json" },
        body: JSON.stringify({
          q: `names: *.${rootDomain} or names: ${rootDomain}`,
          per_page: 50,
          fields: ["names"]
        })
      });
      return extractDomains(JSON.stringify(response), [rootDomain]);
    }
  },
  hunterio: {
    label: "Hunter.io",
    secretFormat: "api_key",
    docs: "https://hunter.io/api-documentation",
    usefulFor: ["email patterns", "public source attribution"],
    preflight: ({ secret }) => ({ url: `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(secret)}` }),
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(rootDomain)}&limit=10&api_key=${encodeURIComponent(secret)}`);
      return extractDomains(JSON.stringify(response), [rootDomain]);
    }
  },
  binaryedge: {
    label: "BinaryEdge",
    secretFormat: "api_key",
    docs: "https://docs.binaryedge.io/api-v2/",
    usefulFor: ["known subdomains", "DNS intelligence"],
    auth: (secret) => ({ "X-Key": secret }),
    preflight: { url: "https://api.binaryedge.io/v2/user/subscription" },
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`https://api.binaryedge.io/v2/query/domains/subdomain/${encodeURIComponent(rootDomain)}`, {
        headers: { "X-Key": secret }
      });
      return extractDomains(JSON.stringify(response.events || response), [rootDomain]);
    }
  },
  certspotter: {
    label: "Cert Spotter",
    secretFormat: "api_key",
    docs: "https://sslmate.com/help/reference/ct_search_api_v1",
    usefulFor: ["certificate transparency", "subdomains"],
    auth: bearerAuth,
    preflight: ({ secret }) => ({ url: "https://api.certspotter.com/v1/issuances?domain=example.com", headers: bearerAuth(secret) }),
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(rootDomain)}&include_subdomains=true&expand=dns_names`, {
        headers: bearerAuth(secret)
      });
      return extractDomains(JSON.stringify(response), [rootDomain]);
    }
  },
  passivetotal: {
    label: "RiskIQ PassiveTotal",
    secretFormat: "username:api_secret",
    docs: "https://passivetotal.readthedocs.io/en/latest/getting-started.html",
    usefulFor: ["passive DNS", "subdomains"],
    auth: basicAuth,
    preflight: { url: "https://api.riskiq.net/pt/v2/account/quota" },
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`https://api.riskiq.net/pt/v2/enrichment/subdomains?query=${encodeURIComponent(rootDomain)}`, {
        headers: basicAuth(secret)
      });
      return extractDomains(JSON.stringify(response), [rootDomain]);
    }
  },
  securitytrails: {
    label: "SecurityTrails",
    secretFormat: "api_key",
    docs: "https://docs.securitytrails.com/reference/list-subdomains-old-1",
    usefulFor: ["subdomains", "DNS records", "WHOIS"],
    auth: (secret) => ({ APIKEY: secret }),
    preflight: { url: "https://api.securitytrails.com/v1/ping" },
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`https://api.securitytrails.com/v1/domain/${encodeURIComponent(rootDomain)}/subdomains`, {
        headers: { APIKEY: secret }
      });
      return (response.subdomains || []).map((subdomain) => normalizeDomain(`${subdomain}.${rootDomain}`)).filter(Boolean);
    }
  },
  shodan: {
    label: "Shodan",
    secretFormat: "api_key",
    docs: "https://book.shodan.io/developer-apis/shodan-api/",
    usefulFor: ["DNS domain lookup", "host/service enrichment"],
    preflight: ({ secret }) => ({ url: `https://api.shodan.io/api-info?key=${encodeURIComponent(secret)}` }),
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`https://api.shodan.io/dns/domain/${encodeURIComponent(rootDomain)}?key=${encodeURIComponent(secret)}`);
      return (response.subdomains || []).map((subdomain) => normalizeDomain(`${subdomain}.${rootDomain}`)).filter(Boolean);
    }
  },
  urlscan: {
    label: "urlscan.io",
    secretFormat: "api_key",
    docs: "https://urlscan.io/docs/api/",
    usefulFor: ["archived scans", "observed URLs/domains"],
    auth: (secret) => ({ "API-Key": secret }),
    preflight: { url: "https://urlscan.io/user/quotas/" },
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(rootDomain)}&size=100`, {
        headers: { "API-Key": secret }
      });
      return extractDomains(JSON.stringify(response.results || response), [rootDomain]);
    }
  },
  virustotal: {
    label: "VirusTotal",
    secretFormat: "api_key",
    docs: "https://docs.virustotal.com/reference/subdomains",
    usefulFor: ["direct subdomains", "domain reputation metadata"],
    auth: (secret) => ({ "x-apikey": secret }),
    preflight: ({ secret }) => ({ url: "https://www.virustotal.com/api/v3/domains/example.com", headers: { "x-apikey": secret } }),
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`https://www.virustotal.com/api/v3/domains/${encodeURIComponent(rootDomain)}/subdomains?limit=40`, {
        headers: { "x-apikey": secret }
      });
      return extractDomains(JSON.stringify(response.data || response), [rootDomain]);
    }
  },
  zoomeye: {
    label: "ZoomEye",
    secretFormat: "api_key",
    docs: "https://www.zoomeye.ai/doc",
    usefulFor: ["web/host asset search"],
    auth: (secret) => ({ "API-KEY": secret }),
    preflight: { url: `${ZOOMEYE_BASE_URL}/resources-info` },
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`${ZOOMEYE_BASE_URL}/web/search?query=${encodeURIComponent(`site:${rootDomain}`)}&page=1`, {
        headers: { "API-KEY": secret }
      });
      return extractDomains(JSON.stringify(response), [rootDomain]);
    }
  },
  spyse: {
    label: "Spyse",
    secretFormat: "api_key",
    docs: "https://spyse-dev.readme.io/reference/quick-start",
    usefulFor: ["subdomains", "domain intelligence"],
    auth: bearerAuth,
    preflight: { url: "https://api.spyse.com/v4/data/domain/search?limit=1" },
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`https://api.spyse.com/v4/data/domain/subdomains?domain=${encodeURIComponent(rootDomain)}&limit=100`, {
        headers: bearerAuth(secret)
      });
      return extractDomains(JSON.stringify(response), [rootDomain]);
    }
  },
  intelx: {
    label: "Intelligence X",
    secretFormat: "api_key",
    docs: "https://free.intelx.io/",
    usefulFor: ["domain mentions", "phonebook emails/URLs"],
    auth: (secret) => ({ "X-Key": secret }),
    preflight: { url: `${INTELX_BASE_URL}/authenticate/info` },
    domains: async ({ rootDomain, secret }) => {
      const response = await requestJson(`${INTELX_BASE_URL}/phonebook/search?term=${encodeURIComponent(rootDomain)}&target=1&maxresults=100&timeout=20&media=0`, {
        method: "POST",
        headers: { "X-Key": secret }
      });
      return extractDomains(JSON.stringify(response), [rootDomain]);
    }
  },
  whoisxmlapi: {
    label: "WhoisXMLAPI DRS",
    secretFormat: "api_key",
    docs: "https://drs.whoisxmlapi.com/",
    usefulFor: ["current WHOIS", "domain info", "subdomains", "reverse WHOIS"],
    preflight: ({ secret }) => ({ url: `https://www.whoisxmlapi.com/whoisserver/WhoisService?apiKey=${encodeURIComponent(secret)}&domainName=example.com&outputFormat=JSON` }),
    domains: async ({ rootDomain, secret }) => {
      const result = await collectWhoisXmlDrsDomains({ apiKey: secret, rootDomain });
      return result;
    }
  },
  whoisfreaks: {
    label: "WhoisFreaks",
    secretFormat: "api_key",
    docs: "https://whoisfreaks.com/documentation/whois-history-api",
    usefulFor: ["historical WHOIS", "registrant history", "nameserver pivots"],
    preflight: ({ secret }) => ({ url: buildWhoisFreaksUrl({ apiKey: secret, domainName: "example.com", whois: "live" }) }),
    domains: async ({ rootDomain, secret }) => {
      const result = await callWhoisFreaksHistorical({ apiKey: secret, domainName: rootDomain });
      return result.domains;
    }
  }
};

async function validateProviderKey(provider, secret) {
  const definition = PROVIDERS[provider];
  if (!definition) return { ok: true, message: "No provider preflight is configured." };
  if (!String(secret || "").trim()) return { ok: false, message: "Secret is empty." };
  if (definition.secretFormat?.includes(":") && !String(secret).includes(":")) {
    return { ok: false, message: `${definition.label} expects ${definition.secretFormat}.` };
  }
  if (!definition.preflight) return { ok: true, message: "No provider preflight is configured." };
  try {
    const request = typeof definition.preflight === "function"
      ? definition.preflight({ secret })
      : { ...definition.preflight, headers: { ...(definition.auth ? definition.auth(secret) : {}), ...(definition.preflight.headers || {}) } };
    await requestJson(request.url, {
      method: request.method || "GET",
      headers: request.headers || {},
      body: request.body
    });
    return { ok: true, message: `${definition.label} preflight succeeded.`, docs: definition.docs, usefulFor: definition.usefulFor };
  } catch (error) {
    const failure = classifyApiFailure(error.message);
    return { ok: false, status: failure.status, message: `${definition.label} preflight failed: ${error.message}`, docs: definition.docs, usefulFor: definition.usefulFor, action: failure.action };
  }
}

async function collectProviderDomains({ provider, rootDomain, apiKey }) {
  const definition = PROVIDERS[provider];
  if (!definition?.domains) return { domains: [], metadata: { mode: "unsupported-provider", reason: `${provider} is not configured as a passive domain source.` } };
  if (!apiKey?.api_key) return { domains: [], metadata: { mode: "missing-api-key", reason: `${definition.label} skipped: no active API key.` } };
  const result = await definition.domains({ rootDomain, secret: apiKey.api_key });
  const domains = Array.isArray(result) ? result : result.domains || [];
  return {
    domains: [...new Set(domains.map(normalizeDomain).filter(Boolean))],
    metadata: { mode: "api-provider", provider, docs: definition.docs, usefulFor: definition.usefulFor, ...(!Array.isArray(result) ? result.metadata || {} : {}) }
  };
}

function providerCatalog() {
  return Object.entries(PROVIDERS).map(([id, provider]) => ({
    id,
    label: provider.label,
    secretFormat: provider.secretFormat,
    docs: provider.docs,
    usefulFor: provider.usefulFor
  }));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { Accept: "application/json", "User-Agent": "AURA recon/0.1", ...(options.headers || {}) },
    body: options.body,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 30000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function classifyApiFailure(message) {
  const text = String(message || "");
  // Network errors carry no HTTP status; test them first so "timed out ... plan" style noise is not read as quota.
  if (!/\bHTTP \d{3}\b/.test(text) && /(fetch failed|ECONN\w+|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|socket hang up|timed? ?out|aborted|network)/i.test(text)) {
    return { kind: "network", status: "failed", action: "Network error reaching the provider: check connectivity/proxy and retry; the API key is probably fine." };
  }
  // Quota/billing: the key is valid but cannot serve more calls.
  if (/\bHTTP (402|429)\b|\b(quota|credits?|rate.?limit|too many requests|exhaust\w*|payment required|insufficient|limit (reached|exceeded)|(plan|subscription) (limit|required|upgrade))/i.test(text)) {
    return { kind: "quota", status: "exhausted", action: "Replace the API key, upgrade/enable the provider plan, or disable this provider for recon." };
  }
  // Auth: the key itself is rejected.
  if (/\bHTTP (401|403)\b|unauthori[sz]ed|forbidden|not authori[sz]ed|invalid (api )?key/i.test(text)) {
    return { kind: "auth", status: "failed", action: "The provider rejected the API key: check or replace it." };
  }
  return { kind: "other", status: "failed", action: "Check the API key and provider status." };
}

function basicAuth(secret) {
  return { Authorization: `Basic ${Buffer.from(String(secret || "")).toString("base64")}` };
}

function bearerAuth(secret) {
  return { Authorization: `Bearer ${secret}` };
}

module.exports = {
  INTELX_BASE_URL,
  PROVIDERS,
  ZOOMEYE_BASE_URL,
  collectProviderDomains,
  classifyApiFailure,
  providerCatalog,
  validateProviderKey
};
