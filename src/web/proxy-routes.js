"use strict";

const ProxyDetection = require("../recon/proxy-detection");
const ProxyPreflight = require("../recon/proxy-preflight");
const ProxyService = require("../recon/proxy-service");
const ProxySources = require("../recon/proxy-sources");
const { readBody, sendJson } = require("./http-utils");

const DEFAULT_POOL_MAX_LATENCY_MS = 2500;
const PROXIFLY_ALL_URL = ProxySources.PROXIFLY_ALL_URL || "https://github.com/proxifly/free-proxy-list/blob/main/proxies/all/data.txt";

let proxyService;
let proxyPreflight;
let proxySources;
let proxyDetection;

function initServices() {
  if (!proxyService) {
    proxyService = new ProxyService();
    proxyPreflight = new ProxyPreflight({ proxyService });
    proxySources = new ProxySources();
    proxyDetection = new ProxyDetection();
  }
}

async function handleApiRequest({ request, response, url }) {
  if (!url.pathname.startsWith("/api/proxies")) return false;
  initServices();

  try {
    const pathParts = url.pathname.replace(/^\/api\/proxies\/?/, "").split("/").filter(Boolean);

    if (request.method === "GET" && pathParts.length === 0) {
      await listProxies(response, url);
      return true;
    }

    if (request.method === "POST" && pathParts.length === 0) {
      await createProxy(request, response);
      return true;
    }

    if (request.method === "POST" && pathParts[0] === "test") {
      await testProxies(request, response);
      return true;
    }

    if (request.method === "POST" && pathParts[0] === "preflight") {
      await preflightActiveProxies(request, response);
      return true;
    }

    if (request.method === "POST" && pathParts[0] === "import-preflight") {
      await importAndPreflightProxies(request, response);
      return true;
    }

    if (request.method === "GET" && pathParts[0] === "sources") {
      listSources(response);
      return true;
    }

    if (request.method === "POST" && pathParts[0] === "sources" && pathParts[1]) {
      await importFromSource(request, response, pathParts[1]);
      return true;
    }

    if (request.method === "POST" && pathParts[0] === "detect") {
      await detectBlocking(request, response);
      return true;
    }

    if (request.method === "GET" && pathParts[0] === "stats") {
      await getStats(response);
      return true;
    }

    if (request.method === "GET" && pathParts[0] === "health") {
      await getHealth(response);
      return true;
    }

    const proxyId = Number.parseInt(pathParts[0], 10);
    if (Number.isInteger(proxyId)) {
      if (request.method === "GET") {
        await getProxy(response, proxyId);
        return true;
      }
      if (request.method === "PUT") {
        await updateProxy(request, response, proxyId);
        return true;
      }
      if (request.method === "DELETE") {
        await deleteProxy(response, proxyId);
        return true;
      }
    }

    sendJson(response, { error: "Proxy endpoint not found" }, 404);
    return true;
  } catch (error) {
    sendJson(response, { error: error.message }, 500);
    return true;
  }
}

async function listProxies(response, url) {
  const status = url.searchParams.get("status") || "active";
  const limit = parseInteger(url.searchParams.get("limit"), 50);
  const offset = parseInteger(url.searchParams.get("offset"), 0);
  const type = url.searchParams.get("type");
  const country = url.searchParams.get("country");
  const minSuccessRate = url.searchParams.has("minSuccessRate") ? Number.parseFloat(url.searchParams.get("minSuccessRate")) : null;
  const maxLatency = url.searchParams.has("maxLatency") ? parseInteger(url.searchParams.get("maxLatency"), null) : null;

  let proxies = status === "all"
    ? await proxyService.store.getProxies({ status: "all", type, country, minSuccessRate, maxLatency })
    : await proxyService.store.getProxies({ status, type, country, minSuccessRate, maxLatency });

  if (url.searchParams.get("best") === "true") {
    proxies = proxies
      .filter((proxy) => proxy.status === "active")
      .sort(compareProxyQuality);
  }

  const paginated = proxies.slice(offset, offset + limit);
  sendJson(response, { proxies: paginated.map(redactProxy), total: proxies.length, limit, offset });
}

async function createProxy(request, response) {
  const body = await readBody(request);
  const proxy = normalizeProxyRecord(body);
  const id = await proxyService.store.addProxy(proxy.address, proxy.port, proxy.type, {
    country: proxy.country,
    username: proxy.username,
    password: proxy.password,
    status: proxy.status || "unknown"
  });
  sendJson(response, { id, message: "Proxy added successfully" }, 201);
}

async function getProxy(response, proxyId) {
  const proxy = await proxyService.store.getProxy(proxyId);
  if (!proxy) {
    sendJson(response, { error: "Proxy not found" }, 404);
    return;
  }
  const metrics = await proxyService.store.getProxyMetrics(proxyId);
  sendJson(response, { ...redactProxy(proxy), metrics: metrics || null });
}

async function updateProxy(request, response, proxyId) {
  const existing = await proxyService.store.getProxy(proxyId);
  if (!existing) {
    sendJson(response, { error: "Proxy not found" }, 404);
    return;
  }
  const body = await readBody(request);
  const next = normalizeProxyRecord({ ...existing, ...body });
  await proxyService.store.updateProxy(proxyId, next);
  sendJson(response, { message: "Proxy updated successfully" });
}

async function deleteProxy(response, proxyId) {
  const deleted = await proxyService.store.deleteProxy(proxyId);
  if (!deleted) {
    sendJson(response, { error: "Proxy not found" }, 404);
    return;
  }
  sendJson(response, { message: "Proxy deleted successfully" });
}

async function testProxies(request, response) {
  const body = await readBody(request);
  const proxies = Array.isArray(body.proxies) ? body.proxies.map(normalizeProxyRecord) : [];
  if (proxies.length === 0) {
    sendJson(response, { error: "Proxies array is required" }, 400);
    return;
  }
  const results = await proxyPreflight.batchTest(proxies, body.options || {});
  sendJson(response, { results, summary: summarizeResults(results) });
}

async function preflightActiveProxies(request, response) {
  const body = await readBody(request);
  const status = body.status || "preflight";
  const options = normalizePreflightOptions(body.options || {});
  const proxies = status === "active"
    ? await proxyService.store.getProxies({ status: "active" })
    : await proxyService.store.getProxies({ status: "all" });
  const candidates = proxies.filter((proxy) => ["active", "unknown", "testing"].includes(proxy.status));
  if (candidates.length === 0) {
    sendJson(response, { error: "No imported proxies to test. Import proxies to the server-side pool first." }, 400);
    return;
  }
  const results = await proxyPreflight.batchTest(candidates, options);
  const cleanup = await cleanupPreflightResults(results, options);
  sendJson(response, { results, summary: summarizeResults(results), cleanup });
}

async function importAndPreflightProxies(request, response) {
  const body = await readBody(request);
  const params = body.params || {};
  const source = String(body.source || "txt").toLowerCase();
  const content = body.content ?? params.content ?? "";
  const proxies = await parseProxyImportSource(source, { ...params, content });
  if (proxies.length === 0) {
    sendJson(response, { error: "No valid proxy candidates were supplied." }, 400);
    return;
  }

  const options = normalizePreflightOptions({ purgeFailed: true, purgeHighLatency: true, ...(body.options || {}) });
  const imported = [];
  let invalid = 0;
  for (const proxy of proxies) {
    try {
      const normalized = normalizeProxyRecord(proxy);
      const id = await proxyService.store.addProxy(normalized.address, normalized.port, normalized.type, {
        country: normalized.country,
        username: normalized.username,
        password: normalized.password,
        status: "unknown"
      });
      imported.push({ ...normalized, id });
    } catch {
      invalid += 1;
    }
  }

  if (imported.length === 0) {
    sendJson(response, { error: "Proxy import did not contain any supported entries.", fetched: proxies.length, invalid }, 400);
    return;
  }

  const candidates = dedupeProxyRecords(imported);
  const results = await proxyPreflight.batchTest(candidates, options);
  const cleanup = await cleanupPreflightResults(results, options);
  sendJson(response, {
    source,
    sourceUrl: source === "proxifly" ? PROXIFLY_ALL_URL : params.url || null,
    fetched: proxies.length,
    imported: imported.length,
    invalid,
    results,
    summary: summarizeResults(results),
    cleanup
  }, 201);
}

async function parseProxyImportSource(source, params) {
  if (source === "txt") return proxySources.parseTxtFile(params.content || "");
  if (source === "json") return proxySources.parseJsonFile(params.content || "[]");
  if (source === "csv") return proxySources.parseCsvFile(params.content || "");
  if (source === "github") return proxySources.fetchFromGitHub(params.url);
  if (source === "proxifly") return proxySources.fetchFromProxifly();
  throw new Error(`Unsupported source: ${source}`);
}

function dedupeProxyRecords(proxies) {
  const seen = new Set();
  const unique = [];
  for (const proxy of proxies) {
    const key = `${proxy.type}://${proxy.address}:${proxy.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(proxy);
  }
  return unique;
}

function listSources(response) {
  sendJson(response, {
    sources: [
      { id: "txt", name: "Text", description: "Manual proxy list, one entry per line" },
      { id: "proxifly", name: "Proxifly Free Proxy List", description: "Built-in GitHub source for scheme-prefixed proxies", url: PROXIFLY_ALL_URL },
      { id: "json", name: "JSON", description: "Manual JSON proxy list" },
      { id: "csv", name: "CSV", description: "Manual CSV proxy list" },
      { id: "github", name: "GitHub Raw", description: "User-provided raw text URL" }
    ]
  });
}

async function importFromSource(request, response, source) {
  const body = await readBody(request);
  const params = body.params || {};
  let proxies;
  try {
    proxies = await parseProxyImportSource(source, params);
  } catch (error) {
    sendJson(response, { error: error.message }, 400);
    return;
  }

  const added = [];
  for (const proxy of proxies) {
    try {
      const normalized = normalizeProxyRecord(proxy);
      const id = await proxyService.store.addProxy(normalized.address, normalized.port, normalized.type, {
        country: normalized.country,
        username: normalized.username,
        password: normalized.password,
        status: "unknown"
      });
      added.push(redactProxy({ ...normalized, id }));
    } catch {
      // Keep importing valid entries when one row is malformed.
    }
  }
  sendJson(response, { fetched: proxies.length, added: added.length, proxies: added });
}

async function detectBlocking(request, response) {
  const body = await readBody(request);
  if (!body.response) {
    sendJson(response, { error: "Response object is required" }, 400);
    return;
  }
  sendJson(response, { detection: proxyDetection.detectBlockage(body.response, body.body || "") });
}

async function getStats(response) {
  const counts = await proxyService.store.listStatusCounts();
  const averages = await proxyService.store.getAverages();
  const recentTests = await proxyService.store.getRecentTests();
  sendJson(response, { counts, averages, recentTests });
}

async function getHealth(response) {
  const proxies = await proxyService.store.getProxies({ status: "active" });
  const best = proxies.sort(compareProxyQuality)[0] || null;
  sendJson(response, {
    healthy: proxies.length > 0,
    activeCount: proxies.length,
    best: best ? redactProxy(best) : null,
    recommendation: proxies.length ? "Proxy pool is ready for recon routing." : "Import and preflight proxies before enabling proxy routing."
  });
}

async function cleanupPreflightResults(results, options) {
  const cleanup = { removed: 0, failedRemoved: 0, highLatencyRemoved: 0 };
  for (const result of results) {
    const id = result.proxy?.id || result.proxyId || result.proxy?.proxy_id;
    if (!id) continue;
    const shouldRemoveFailed = options.purgeFailed && !result.success;
    const latency = Number(result.latency || result.latencyMs || result.responseTime || 0);
    const shouldRemoveSlow = options.purgeHighLatency && result.success && latency > options.maxLatencyMs;
    if (!shouldRemoveFailed && !shouldRemoveSlow) continue;
    const deleted = await proxyService.store.deleteProxy(Number(id));
    if (deleted) {
      cleanup.removed += 1;
      if (shouldRemoveFailed) cleanup.failedRemoved += 1;
      if (shouldRemoveSlow) cleanup.highLatencyRemoved += 1;
    }
  }
  return cleanup;
}

function normalizePreflightOptions(input) {
  return {
    concurrency: parseInteger(input.concurrency, 5),
    timeout: parseInteger(input.timeout, 3500),
    maxLatencyMs: parseInteger(input.maxLatencyMs, DEFAULT_POOL_MAX_LATENCY_MS),
    purgeFailed: input.purgeFailed !== false,
    purgeHighLatency: input.purgeHighLatency !== false
  };
}

function normalizeProxyRecord(input) {
  if (!input || typeof input !== "object") throw new Error("Proxy object is required");
  const address = String(input.address || input.host || input.ip || "").trim();
  const port = Number.parseInt(input.port, 10);
  const type = String(input.type || "http").toLowerCase();
  if (!address || !Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Proxy must include address and valid port");
  if (!["http", "https", "socks4", "socks5"].includes(type)) throw new Error("Proxy type must be http, https, socks4, or socks5");
  return { address, port, type, country: input.country || null, username: input.username || null, password: input.password || null, status: input.status || "unknown" };
}

function summarizeResults(results) {
  const total = results.length;
  const successful = results.filter((result) => result.success).length;
  return { total, successful, failed: total - successful, successRate: total ? successful / total : 0 };
}

function compareProxyQuality(a, b) {
  const leftSuccess = Number(a.success_rate || 0);
  const rightSuccess = Number(b.success_rate || 0);
  if (rightSuccess !== leftSuccess) return rightSuccess - leftSuccess;
  return Number(a.latency_ms || Number.MAX_SAFE_INTEGER) - Number(b.latency_ms || Number.MAX_SAFE_INTEGER);
}

function redactProxy(proxy) {
  return { ...proxy, username: proxy.username ? "****" : null, password: proxy.password ? "****" : null };
}

function parseInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) ? number : fallback;
}

module.exports = { handleApiRequest };
