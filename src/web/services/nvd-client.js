"use strict";

// On-demand NVD (National Vulnerability Database) API 2.0 client.
// Correlates a detected product:version to published CVEs. Results are cached on disk and
// requests are serialized with a polite delay to respect NVD's unauthenticated rate limits.
// This module never throws to the caller: every failure path returns an empty array.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const NVD_ENDPOINT = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const CACHE_DIR = path.resolve("data", "nvd-cache");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESULTS_PER_PAGE = 20;
const REQUEST_TIMEOUT_MS = 30000;
// NVD allows ~5 req / 30s without a key and ~50 with one; serialize and pace to stay well under.
const DELAY_WITH_KEY_MS = 700;
const DELAY_WITHOUT_KEY_MS = 6500;

// Serializes outbound NVD calls: each request waits for the previous one plus a polite delay.
let requestChain = Promise.resolve();

function cacheKey(product, version) {
  return crypto.createHash("sha1").update(`${product}@${version}`.toLowerCase()).digest("hex");
}

function cachePath(product, version) {
  return path.join(CACHE_DIR, `${cacheKey(product, version)}.json`);
}

function readCache(product, version) {
  const file = cachePath(product, version);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed?.findings) ? parsed.findings : null;
  } catch {
    return null;
  }
}

function writeCache(product, version, findings) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(product, version), JSON.stringify({
      product,
      version,
      cachedAt: new Date().toISOString(),
      findings
    }), "utf8");
  } catch {
    // Cache is best-effort; a write failure must not break the lookup.
  }
}

// Picks the strongest available CVSS metric: prefer v3.1, then v3.0, then v2.
function pickCvss(metrics = {}) {
  const v31 = Array.isArray(metrics.cvssMetricV31) ? metrics.cvssMetricV31[0] : null;
  const v30 = Array.isArray(metrics.cvssMetricV30) ? metrics.cvssMetricV30[0] : null;
  const v2 = Array.isArray(metrics.cvssMetricV2) ? metrics.cvssMetricV2[0] : null;
  const chosen = v31 || v30 || v2;
  if (!chosen) return { cvss: null, severity: null };
  const data = chosen.cvssData || {};
  const cvss = typeof data.baseScore === "number" ? data.baseScore : null;
  const severity = normalizeSeverity(chosen.baseSeverity || data.baseSeverity || severityFromScore(cvss));
  return { cvss, severity };
}

function severityFromScore(score) {
  if (typeof score !== "number") return null;
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "none";
}

function normalizeSeverity(value) {
  const text = String(value || "").toLowerCase().trim();
  return text || null;
}

function englishDescription(descriptions = []) {
  const list = Array.isArray(descriptions) ? descriptions : [];
  const english = list.find((entry) => entry && entry.lang === "en") || list[0] || null;
  return english?.value ? String(english.value).trim() : "";
}

// Pure response->findings mapper, exported for offline unit tests.
function parseNvdResponse(json) {
  const vulnerabilities = Array.isArray(json?.vulnerabilities) ? json.vulnerabilities : [];
  const findings = [];
  const seen = new Set();
  for (const entry of vulnerabilities) {
    const cve = entry?.cve;
    if (!cve || !cve.id || seen.has(cve.id)) continue;
    seen.add(cve.id);
    const { cvss, severity } = pickCvss(cve.metrics || {});
    findings.push({
      id: cve.id,
      cvss,
      severity,
      summary: englishDescription(cve.descriptions),
      url: `https://nvd.nist.gov/vuln/detail/${cve.id}`
    });
  }
  return findings;
}

function buildRequestUrl(product, version) {
  const url = new URL(NVD_ENDPOINT);
  url.searchParams.set("keywordSearch", `${product} ${version}`.trim());
  // Exact match keeps noise down when both a product name and a specific version are present.
  if (product && version) url.searchParams.set("keywordExactMatch", "");
  url.searchParams.set("resultsPerPage", String(RESULTS_PER_PAGE));
  return url.toString();
}

async function fetchNvd(product, version, apiKey, fetchImpl) {
  const headers = { Accept: "application/json", "User-Agent": "AURA recon/0.1" };
  if (apiKey) headers.apiKey = apiKey;
  const response = await fetchImpl(buildRequestUrl(product, version), {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) return []; // 403 (rate limit / bad key), 404, 5xx: degrade gracefully.
  const text = await response.text();
  if (!text) return [];
  return parseNvdResponse(JSON.parse(text));
}

// Queues a lookup behind any in-flight request, then paces the next one.
function enqueue(task, delayMs) {
  const result = requestChain.then(task, task);
  requestChain = result.then(() => sleep(delayMs), () => sleep(delayMs));
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Looks up CVEs for a product:version pair. Returns an array of {id, cvss, severity, summary, url};
// returns [] on any error (bad input, 403/404, timeout, non-JSON). Never throws.
async function lookupCves({ product, version, apiKey = null, fetchImpl = fetch } = {}) {
  const cleanProduct = String(product || "").trim();
  const cleanVersion = String(version || "").trim();
  if (!cleanProduct || !cleanVersion) return [];

  const cached = readCache(cleanProduct, cleanVersion);
  if (cached) return cached;

  const delayMs = apiKey ? DELAY_WITH_KEY_MS : DELAY_WITHOUT_KEY_MS;
  try {
    const findings = await enqueue(() => fetchNvd(cleanProduct, cleanVersion, apiKey, fetchImpl), delayMs);
    writeCache(cleanProduct, cleanVersion, findings);
    return findings;
  } catch {
    return [];
  }
}

module.exports = {
  CACHE_DIR,
  CACHE_TTL_MS,
  buildRequestUrl,
  lookupCves,
  parseNvdResponse
};
