"use strict";

const { HttpError, readBody, sendJson } = require("../http-utils");
const {
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
} = require("../services/proxy-pool");

const PREFLIGHT_CANDIDATE_STATUSES = new Set(["active", "unknown", "testing"]);

async function listProxies({ response, url }) {
  const { store } = getProxyServices();
  const query = url.searchParams;
  const limit = Math.max(1, Math.min(5000, parseInteger(query.get("limit"), 50)));
  const offset = Math.max(0, parseInteger(query.get("offset"), 0));
  let proxies = await store.getProxies({
    status: query.get("status") || "active",
    type: query.get("type"),
    country: query.get("country"),
    minSuccessRate: query.has("minSuccessRate") ? Number.parseFloat(query.get("minSuccessRate")) : null,
    maxLatency: query.has("maxLatency") ? parseInteger(query.get("maxLatency"), null) : null
  });
  if (query.get("best") === "true") proxies = proxies.filter((proxy) => proxy.status === "active").sort(compareProxyQuality);
  sendJson(response, { proxies: proxies.slice(offset, offset + limit).map(redactProxy), total: proxies.length, limit, offset });
}

async function createProxy({ request, response }) {
  const { store } = getProxyServices();
  const proxy = normalizeProxyRecord(await readBody(request));
  const id = await store.addProxy(proxy.address, proxy.port, proxy.type, {
    country: proxy.country,
    username: proxy.username,
    password: proxy.password,
    status: proxy.status
  });
  sendJson(response, { id, message: "Proxy added successfully" }, 201);
}

async function requireProxy(store, id) {
  const proxy = await store.getProxy(id);
  if (!proxy) throw new HttpError(404, "Proxy not found");
  return proxy;
}

async function getProxy({ response, params }) {
  const { store } = getProxyServices();
  const proxy = await requireProxy(store, params.id);
  sendJson(response, { ...redactProxy(proxy), metrics: (await store.getProxyMetrics(params.id)) || null });
}

async function updateProxy({ request, response, params }) {
  const { store } = getProxyServices();
  const existing = await requireProxy(store, params.id);
  const body = await readBody(request);
  const next = normalizeProxyRecord({ ...existing, ...body });
  // Redacted "****" values round-tripped from GET keep the stored credentials.
  if (!next.username) next.username = existing.username;
  if (!next.password) next.password = existing.password;
  try {
    await store.updateProxy(params.id, next);
  } catch (error) {
    if (/UNIQUE/i.test(error.message)) throw new HttpError(409, "Another proxy already uses this address, port, and type");
    throw error;
  }
  sendJson(response, { message: "Proxy updated successfully" });
}

async function deleteProxy({ response, params }) {
  const { store } = getProxyServices();
  if (!(await store.deleteProxy(params.id))) throw new HttpError(404, "Proxy not found");
  sendJson(response, { message: "Proxy deleted successfully" });
}

async function testProxies({ request, response }) {
  const body = await readBody(request);
  const proxies = Array.isArray(body.proxies) ? body.proxies.map(normalizeProxyRecord) : [];
  if (proxies.length === 0) throw new HttpError(400, "Proxies array is required");
  const results = await getProxyServices().preflight.batchTest(proxies, normalizePreflightOptions(body.options));
  sendJson(response, { results, summary: summarizeResults(results) });
}

async function preflightPool({ request, response }) {
  const { store, preflight } = getProxyServices();
  const body = await readBody(request);
  const options = normalizePreflightOptions(body.options);
  const proxies = await store.getProxies({ status: body.status === "active" ? "active" : "all" });
  const candidates = proxies.filter((proxy) => PREFLIGHT_CANDIDATE_STATUSES.has(proxy.status));
  if (candidates.length === 0) throw new HttpError(400, "No imported proxies to test. Import proxies to the server-side pool first.");
  const results = await preflight.batchTest(candidates, options);
  const cleanup = await cleanupPreflightResults(results, options);
  sendJson(response, { results, summary: summarizeResults(results), cleanup, concurrency: options.concurrency });
}

async function importAndPreflight({ request, response }) {
  const body = await readBody(request);
  const params = body.params || {};
  const source = String(body.source || "txt").toLowerCase();
  const proxies = await parseProxyImportSource(source, { ...params, content: body.content ?? params.content ?? "" });
  if (proxies.length === 0) throw new HttpError(400, "No valid proxy candidates were supplied.");
  const options = normalizePreflightOptions({ purgeFailed: true, purgeHighLatency: true, ...(body.options || {}) });
  const { imported, invalid } = await importProxyRecords(proxies);
  if (imported.length === 0) {
    sendJson(response, { error: "Proxy import did not contain any supported entries.", fetched: proxies.length, invalid }, 400);
    return;
  }
  const results = await getProxyServices().preflight.batchTest(imported, options);
  const cleanup = await cleanupPreflightResults(results, options);
  sendJson(response, {
    source,
    sourceUrl: source === "proxifly" ? PROXIFLY_ALL_URL : params.url || null,
    fetched: proxies.length,
    imported: imported.length,
    invalid,
    concurrency: options.concurrency,
    results,
    summary: summarizeResults(results),
    cleanup
  }, 201);
}

async function importFromSource({ request, response, params: routeParams }) {
  const body = await readBody(request);
  const proxies = await parseProxyImportSource(String(routeParams.source).toLowerCase(), body.params || {});
  const { imported } = await importProxyRecords(proxies);
  sendJson(response, { fetched: proxies.length, added: imported.length, proxies: imported.map(redactProxy) });
}

async function detectBlocking({ request, response }) {
  const body = await readBody(request);
  if (!body.response) throw new HttpError(400, "Response object is required");
  sendJson(response, { detection: getProxyServices().detection.detectBlockage(body.response, body.body || "") });
}

async function getStats({ response }) {
  const { store } = getProxyServices();
  sendJson(response, {
    counts: await store.listStatusCounts(),
    averages: await store.getAverages(),
    recentTests: await store.getRecentTests()
  });
}

async function getHealth({ response }) {
  const { store } = getProxyServices();
  let database = "connected";
  let proxies = [];
  try {
    proxies = await store.getProxies({ status: "active" });
  } catch {
    database = "error";
  }
  const best = [...proxies].sort(compareProxyQuality)[0] || null;
  sendJson(response, {
    database,
    healthy: database === "connected" && proxies.length > 0,
    activeCount: proxies.length,
    best: best ? redactProxy(best) : null,
    recommendation: proxies.length ? "Proxy pool is ready for recon routing." : "Import and preflight proxies before enabling proxy routing."
  });
}

const routes = [
  { method: "GET", path: "/api/proxies", handler: listProxies },
  { method: "POST", path: "/api/proxies", handler: createProxy },
  { method: "POST", path: "/api/proxies/test", handler: testProxies },
  { method: "POST", path: "/api/proxies/preflight", handler: preflightPool },
  { method: "POST", path: "/api/proxies/import-preflight", handler: importAndPreflight },
  { method: "GET", path: "/api/proxies/sources", handler: ({ response }) => sendJson(response, { sources: PROXY_SOURCES }) },
  { method: "POST", path: "/api/proxies/sources/:source", handler: importFromSource },
  { method: "POST", path: "/api/proxies/detect", handler: detectBlocking },
  { method: "GET", path: "/api/proxies/stats", handler: getStats },
  { method: "GET", path: "/api/proxies/health", handler: getHealth },
  { method: "GET", path: "/api/proxies/:id", handler: getProxy },
  { method: "PUT", path: "/api/proxies/:id", handler: updateProxy },
  { method: "DELETE", path: "/api/proxies/:id", handler: deleteProxy }
];

module.exports = routes;
module.exports._internal = { normalizePreflightOptions, shouldRemovePreflightResult };
