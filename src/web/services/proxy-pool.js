"use strict";

const ProxyDetection = require("../../recon/proxy-detection");
const ProxyPreflight = require("../../recon/proxy-preflight");
const ProxyService = require("../../recon/proxy-service");
const ProxySources = require("../../recon/proxy-sources");
const { HttpError } = require("../http-utils");

const DEFAULT_POOL_MAX_LATENCY_MS = 2500;
const DEFAULT_PREFLIGHT_CONCURRENCY = 50;
const MAX_PREFLIGHT_CONCURRENCY = 100;
const PROXY_TYPES = new Set(["http", "https", "socks4", "socks5"]);
const REDACTED = "****";
const PROXIFLY_ALL_URL = ProxySources.PROXIFLY_ALL_URL || "https://github.com/proxifly/free-proxy-list/blob/main/proxies/all/data.txt";

let services = null;

// One shared service graph (and one SQLite handle) for every proxy request.
function getProxyServices() {
  if (!services) {
    const proxyService = new ProxyService();
    services = {
      proxyService,
      store: proxyService.store,
      preflight: new ProxyPreflight({ proxyService }),
      sources: new ProxySources(),
      detection: new ProxyDetection()
    };
  }
  return services;
}

function parseInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) ? number : fallback;
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function credential(value) {
  if (value === undefined || value === null || value === "" || value === REDACTED) return null;
  return String(value);
}

function normalizeProxyRecord(input) {
  if (!input || typeof input !== "object") throw new HttpError(400, "Proxy object is required");
  const address = String(input.address || input.host || input.ip || "").trim();
  const port = Number.parseInt(input.port, 10);
  const type = String(input.type || "http").toLowerCase();
  if (!address || !Number.isInteger(port) || port <= 0 || port > 65535) throw new HttpError(400, "Proxy must include address and valid port");
  if (!PROXY_TYPES.has(type)) throw new HttpError(400, "Proxy type must be http, https, socks4, or socks5");
  return {
    address,
    port,
    type,
    country: input.country || null,
    username: credential(input.username),
    password: credential(input.password),
    status: input.status || "unknown"
  };
}

function normalizePreflightOptions(input = {}) {
  return {
    concurrency: clampInteger(input.concurrency, DEFAULT_PREFLIGHT_CONCURRENCY, 1, MAX_PREFLIGHT_CONCURRENCY),
    timeout: clampInteger(input.timeout, 3500, 500, 30000),
    tcpTimeout: clampInteger(input.tcpTimeout, 1200, 250, 30000),
    maxLatencyMs: parseInteger(input.maxLatencyMs, DEFAULT_POOL_MAX_LATENCY_MS),
    purgeFailed: input.purgeFailed !== false,
    purgeHighLatency: input.purgeHighLatency !== false
  };
}

// Returns "failed", "high_latency", or "" (keep) for a preflight result under the given options.
function shouldRemovePreflightResult(result, options) {
  if (options.purgeFailed && !result.success) return "failed";
  const latency = Number(result.latency || result.latencyMs || result.responseTime || 0);
  if (options.purgeHighLatency && result.success && latency > options.maxLatencyMs) return "high_latency";
  return "";
}

async function cleanupPreflightResults(results, options) {
  const { store } = getProxyServices();
  const cleanup = { removed: 0, failedRemoved: 0, highLatencyRemoved: 0 };
  for (const result of results) {
    const id = result.proxyId || result.proxy?.id || result.proxy?.proxy_id;
    const reason = id ? shouldRemovePreflightResult(result, options) : "";
    if (!reason || !(await store.deleteProxy(Number(id)))) continue;
    cleanup.removed += 1;
    if (reason === "failed") cleanup.failedRemoved += 1;
    else cleanup.highLatencyRemoved += 1;
  }
  return cleanup;
}

function summarizeResults(results) {
  const total = results.length;
  const successful = results.filter((result) => result.success).length;
  return { total, successful, failed: total - successful, successRate: total ? successful / total : 0 };
}

function compareProxyQuality(a, b) {
  const successDelta = Number(b.success_rate || 0) - Number(a.success_rate || 0);
  if (successDelta !== 0) return successDelta;
  return Number(a.latency_ms || Number.MAX_SAFE_INTEGER) - Number(b.latency_ms || Number.MAX_SAFE_INTEGER);
}

function redactProxy(proxy) {
  return { ...proxy, username: proxy.username ? REDACTED : null, password: proxy.password ? REDACTED : null };
}

function dedupeProxyRecords(proxies) {
  const seen = new Set();
  return proxies.filter((proxy) => {
    const key = `${proxy.type}://${proxy.address}:${proxy.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function parseProxyImportSource(source, params = {}) {
  const { sources } = getProxyServices();
  if (source === "txt") return sources.parseTxtFile(params.content || "");
  if (source === "json") return sources.parseJsonFile(params.content || "[]");
  if (source === "csv") return sources.parseCsvFile(params.content || "");
  if (source === "github") return sources.fetchFromGitHub(params.url);
  if (source === "proxifly") return sources.fetchFromProxifly();
  throw new HttpError(400, `Unsupported source: ${source}`);
}

// Adds each parseable proxy to the pool; malformed rows are counted instead of aborting the import.
async function importProxyRecords(proxies) {
  const { store } = getProxyServices();
  const imported = [];
  let invalid = 0;
  for (const proxy of proxies) {
    try {
      const normalized = normalizeProxyRecord(proxy);
      const id = await store.addProxy(normalized.address, normalized.port, normalized.type, {
        country: normalized.country,
        username: normalized.username,
        password: normalized.password
      });
      imported.push({ ...normalized, id });
    } catch {
      invalid += 1;
    }
  }
  return { imported: dedupeProxyRecords(imported), invalid };
}

const PROXY_SOURCES = [
  { id: "txt", name: "Text", description: "Manual proxy list, one entry per line" },
  { id: "proxifly", name: "Proxifly Free Proxy List", description: "Built-in GitHub source for scheme-prefixed proxies", url: PROXIFLY_ALL_URL },
  { id: "json", name: "JSON", description: "Manual JSON proxy list" },
  { id: "csv", name: "CSV", description: "Manual CSV proxy list" },
  { id: "github", name: "GitHub Raw", description: "User-provided raw.githubusercontent.com URL" }
];

module.exports = {
  PROXIFLY_ALL_URL,
  PROXY_SOURCES,
  cleanupPreflightResults,
  compareProxyQuality,
  getProxyServices,
  importProxyRecords,
  normalizePreflightOptions,
  normalizeProxyRecord,
  parseInteger,
  parseProxyImportSource,
  redactProxy,
  shouldRemovePreflightResult,
  summarizeResults
};
