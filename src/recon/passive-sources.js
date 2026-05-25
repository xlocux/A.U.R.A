"use strict";

const https = require("node:https");
const { extractDomains } = require("./domain-utils");
const { collectProviderDomains } = require("./provider-apis");
const { queryRapidDns } = require("./providers/rapiddns");
const { queryRapid7Fdns } = require("./providers/rapid7-opendata");

const API_PASSIVE_SOURCES = new Set([
  "censys",
  "hunterio",
  "binaryedge",
  "certspotter",
  "passivetotal",
  "securitytrails",
  "shodan",
  "urlscan",
  "virustotal",
  "zoomeye",
  "spyse",
  "intelx",
  "whoisxmlapi",
  "whoisfreaks"
]);

function fetchText(url, timeoutMs = 20000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { "User-Agent": "AURA recon/0.1" },
      timeout: timeoutMs
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects from ${url}`));
          return;
        }
        const nextUrl = new URL(response.headers.location, url).toString();
        fetchText(nextUrl, timeoutMs, redirectCount + 1).then(resolve, reject);
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} from ${url}`));
          return;
        }
        resolve(body);
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    request.on("error", reject);
  });
}

async function fetchCrtSh(rootDomain) {
  const wildcardUrl = `https://crt.sh/?q=%25.${encodeURIComponent(rootDomain)}&output=json`;
  const exactUrl = `https://crt.sh/?q=${encodeURIComponent(rootDomain)}&output=json`;
  let body = "";
  try {
    body = await fetchText(wildcardUrl);
  } catch {
    body = await fetchText(exactUrl);
  }
  let rows = [];
  try {
    rows = JSON.parse(body);
  } catch {
    rows = [];
  }
  const names = rows.flatMap((row) => String(row.name_value || "").split(/\s+/));
  return extractDomains(names.join("\n"), [rootDomain]);
}

async function fetchWayback(rootDomain) {
  const url = `https://web.archive.org/cdx?url=*.${encodeURIComponent(rootDomain)}/*&output=text&fl=original&collapse=urlkey`;
  const body = await fetchText(url, 30000);
  return extractDomains(body, [rootDomain]);
}

async function runPassiveSource(source, rootDomain, options = {}) {
  if (source === "crtsh") return { domains: await fetchCrtSh(rootDomain), metadata: { mode: "crtsh" } };
  if (source === "wayback") return { domains: await fetchWayback(rootDomain), metadata: { mode: "wayback-cdx" } };
  if (source === "rapiddns") return queryRapidDns({ rootDomain, fetchText });
  if (source === "rapid7") return queryRapid7Fdns({
    rootDomain,
    apiKey: options.apiKeys?.rapid7?.api_key || null,
    localPath: options.rapid7FdnsPath || process.env.AURA_RAPID7_FDNS_PATH || null
  });
  if (API_PASSIVE_SOURCES.has(source)) return collectProviderDomains({
    provider: source,
    rootDomain,
    apiKey: options.apiKeys?.[source] || null
  });
  throw new Error(`Unknown passive source: ${source}`);
}

module.exports = {
  API_PASSIVE_SOURCES,
  fetchCrtSh,
  fetchWayback,
  queryRapidDns,
  queryRapid7Fdns,
  runPassiveSource
};
