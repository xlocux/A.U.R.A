"use strict";

const { CORRELATION_TECHNIQUES } = require("../../recon/candidate-correlation");
const { buildResultTree } = require("../../recon/result-tree");
const { HttpError, sendJson } = require("../http-utils");
const { buildRunDelta } = require("../services/run-delta");
const { withScreenshotImages } = require("../services/screenshot-files");

const FULL_LIST_LIMIT = 100000;
const MAX_LIST_LIMIT = 100000;

function requireRun(store, runId) {
  const run = store.getRun(runId);
  if (!run) throw new HttpError(404, "Run not found");
  return run;
}

function listLimit(url, fallback) {
  const value = Number(url.searchParams.get("limit"));
  return Number.isFinite(value) && value > 0 ? Math.min(MAX_LIST_LIMIT, Math.floor(value)) : fallback;
}

// Builds a GET handler that 404s for unknown runs and wraps a store listing under `key`.
function runList(key, list) {
  return ({ response, store, params, url }) => {
    requireRun(store, params.id);
    sendJson(response, { [key]: list(store, params.id, url) });
  };
}

function getRun({ response, store, params }) {
  sendJson(response, { run: requireRun(store, params.id) });
}

function listEvents({ response, store, params, url }) {
  requireRun(store, params.id);
  const tail = Math.floor(Number(url.searchParams.get("tail")));
  if (Number.isFinite(tail) && tail > 0) {
    sendJson(response, { events: store.listLatestEvents(params.id, Math.min(MAX_LIST_LIMIT, tail)) });
    return;
  }
  const after = Number(url.searchParams.get("after")) || 0;
  sendJson(response, { events: store.listEvents(params.id, after, listLimit(url, 500)) });
}

function listAiLog({ response, store, params }) {
  requireRun(store, params.id);
  const events = store.listLatestEvents(params.id, 5000, "ai-%");
  sendJson(response, { events, techniques: CORRELATION_TECHNIQUES });
}

function getResultTree({ response, store, params }) {
  const run = requireRun(store, params.id);
  const runId = run.id;
  const domains = store.listDomains({ runId, limit: FULL_LIST_LIMIT });
  const httpServices = store.listHttpServices({ runId, limit: FULL_LIST_LIMIT });
  const urls = store.listUrls({ runId, limit: FULL_LIST_LIMIT });
  const tree = buildResultTree({
    run,
    target: store.getTarget(run.target_name),
    counts: store.getRunObservationCounts(runId),
    domains,
    httpServices,
    urls,
    screenshots: store.listScreenshots({ runId }),
    assetLeads: store.listAssetLeads({ targetName: run.target_name, limit: FULL_LIST_LIMIT })
      .filter((lead) => !lead.run_id || lead.run_id === runId),
    delta: buildRunDelta(store, runId, { domains, urls, httpServices })
  });
  sendJson(response, { tree });
}

function listArtifacts({ response, store, params, url }) {
  requireRun(store, params.id);
  const artifacts = store.listUrls({ runId: params.id, limit: listLimit(url, 2000) }).map((item) => ({
    artifact_type: "url",
    value: item.url,
    source: item.source,
    extra_json: { host: item.host, path: item.path, query: item.query, params: item.params }
  }));
  sendJson(response, { artifacts });
}

function searchSavedData({ response, url, store }) {
  const query = url.searchParams.get("q") || "";
  const targetName = url.searchParams.get("target") || null;
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 200));
  if (!query.trim()) {
    sendJson(response, { query, results: [] });
    return;
  }
  sendJson(response, { query, results: store.searchAll({ query, targetName, limit }) });
}

module.exports = [
  { method: "GET", path: "/api/search", handler: searchSavedData },
  { method: "GET", path: "/api/recon-runs/:id", handler: getRun },
  { method: "GET", path: "/api/recon-runs/:id/events", handler: listEvents },
  { method: "GET", path: "/api/recon-runs/:id/ai-log", handler: listAiLog },
  { method: "GET", path: "/api/recon-runs/:id/result-tree", handler: getResultTree },
  { method: "GET", path: "/api/recon-runs/:id/artifacts", handler: listArtifacts },
  { method: "GET", path: "/api/recon-runs/:id/delta", handler: runList("delta", (store, id) => buildRunDelta(store, id)) },
  { method: "GET", path: "/api/recon-runs/:id/counts", handler: runList("counts", (store, id) => store.getRunObservationCounts(id)) },
  { method: "GET", path: "/api/recon-runs/:id/tool-results", handler: runList("toolResults", (store, id, url) => store.listToolResults({ runId: id, limit: listLimit(url, 500) })) },
  { method: "GET", path: "/api/recon-runs/:id/domains", handler: runList("domains", (store, id, url) => store.listDomains({ runId: id, limit: listLimit(url, FULL_LIST_LIMIT) })) },
  { method: "GET", path: "/api/recon-runs/:id/http-services", handler: runList("services", (store, id, url) => store.listHttpServices({ runId: id, limit: listLimit(url, FULL_LIST_LIMIT) })) },
  { method: "GET", path: "/api/recon-runs/:id/technologies", handler: runList("technologies", (store, id, url) => store.listTechnologySummary({ runId: id, limit: listLimit(url, 1000) })) },
  { method: "GET", path: "/api/recon-runs/:id/urls", handler: runList("urls", (store, id, url) => store.listUrls({ runId: id, limit: listLimit(url, FULL_LIST_LIMIT) })) },
  { method: "GET", path: "/api/recon-runs/:id/screenshots", handler: runList("screenshots", (store, id) => store.listScreenshots({ runId: id }).map(withScreenshotImages)) }
];
