"use strict";

const fs = require("node:fs");
const https = require("node:https");
const readline = require("node:readline");
const zlib = require("node:zlib");
const { extractDomains, normalizeDomain } = require("../domain-utils");

const RAPID7_STUDY_URL = "https://us.api.insight.rapid7.com/opendata/studies/sonar.fdns_v2/";
const DEFAULT_MATCH_LIMIT = 5000;

async function queryRapid7Fdns({ rootDomain, apiKey = null, localPath = process.env.AURA_RAPID7_FDNS_PATH || null, matchLimit = DEFAULT_MATCH_LIMIT } = {}) {
  const root = normalizeDomain(rootDomain);
  if (!root) return { domains: [], metadata: { mode: "invalid-root" } };
  if (localPath) return scanLocalFdns({ rootDomain: root, localPath, matchLimit });
  const metadata = await fetchRapid7StudyMetadata(apiKey);
  return {
    domains: [],
    metadata: {
      mode: "metadata-only",
      reason: "Rapid7 Open Data requires an account and exposes very large downloadable FDNS files; configure AURA_RAPID7_FDNS_PATH to parse an authorized local FDNS extract.",
      study: metadata
    }
  };
}

async function fetchRapid7StudyMetadata(apiKey) {
  if (!apiKey) {
    return { requiresApiKey: true, study: "sonar.fdns_v2" };
  }
  const body = await fetchJsonText(RAPID7_STUDY_URL, {
    "X-Api-Key": apiKey
  });
  const parsed = JSON.parse(body);
  const files = Array.isArray(parsed.sonarfile_set) ? parsed.sonarfile_set : [];
  return {
    uniqid: parsed.uniqid,
    name: parsed.name,
    shortDesc: parsed.short_desc,
    files: files.slice(-10),
    fileCount: files.length
  };
}

async function scanLocalFdns({ rootDomain, localPath, matchLimit = DEFAULT_MATCH_LIMIT }) {
  if (!fs.existsSync(localPath)) throw new Error(`Rapid7 local FDNS file not found: ${localPath}`);
  const domains = new Set();
  let scannedLines = 0;
  const input = fs.createReadStream(localPath);
  const stream = /\.gz$/i.test(localPath) ? input.pipe(zlib.createGunzip()) : input;
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    scannedLines += 1;
    const values = domainsFromFdnsLine(line, rootDomain);
    for (const domain of values) {
      domains.add(domain);
      if (domains.size >= matchLimit) {
        lines.close();
        input.destroy();
        break;
      }
    }
    if (domains.size >= matchLimit) break;
  }
  return {
    domains: [...domains],
    metadata: {
      mode: "local-fdns",
      localPath,
      scannedLines,
      matchLimit,
      truncated: domains.size >= matchLimit
    }
  };
}

function domainsFromFdnsLine(line, rootDomain) {
  const root = normalizeDomain(rootDomain);
  if (!root) return [];
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return extractDomains(line, [root]);
  }
  const haystack = [
    parsed.name,
    parsed.value,
    parsed.type,
    Array.isArray(parsed.values) ? parsed.values.join("\n") : ""
  ].filter(Boolean).join("\n");
  return extractDomains(haystack, [root]);
}

function fetchJsonText(url, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Accept: "application/json", "User-Agent": "AURA recon/0.1", ...headers },
      timeout: timeoutMs
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} from Rapid7 Open Data`));
          return;
        }
        resolve(body);
      });
    });
    request.on("timeout", () => request.destroy(new Error(`Timeout after ${timeoutMs}ms`)));
    request.on("error", reject);
  });
}

module.exports = {
  domainsFromFdnsLine,
  queryRapid7Fdns
};
