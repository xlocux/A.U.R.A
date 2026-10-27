"use strict";

const DELTA_SAMPLE_LIMIT = 250;
const FULL_LIST_LIMIT = 100000;
const COMPARABLE_RUN_TYPES = new Set(["recon", "full-recon", "target-bootstrap"]);

function emptyDeltaSet() {
  return { currentCount: 0, previousCount: 0, addedCount: 0, removedCount: 0, stableCount: 0, added: [], removed: [] };
}

function mapByNormalizedValue(items, valueKey) {
  const mapped = new Map();
  for (const item of items || []) {
    const value = String(item?.[valueKey] || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!mapped.has(key)) mapped.set(key, item);
  }
  return mapped;
}

function compareDeltaItems(left, right) {
  return String(left.domain || left.url || "").localeCompare(String(right.domain || right.url || ""));
}

function compareValues({ current, previous, valueKey }) {
  const currentMap = mapByNormalizedValue(current, valueKey);
  const previousMap = mapByNormalizedValue(previous, valueKey);
  const added = [];
  const removed = [];
  for (const [key, item] of currentMap) if (!previousMap.has(key)) added.push(item);
  for (const [key, item] of previousMap) if (!currentMap.has(key)) removed.push(item);
  return {
    currentCount: currentMap.size,
    previousCount: previousMap.size,
    addedCount: added.length,
    removedCount: removed.length,
    stableCount: currentMap.size - added.length,
    // Sorting only the kept sample: localeCompare on 30k items per poll was the cost.
    added: added.slice(0, DELTA_SAMPLE_LIMIT).sort(compareDeltaItems),
    removed: removed.slice(0, DELTA_SAMPLE_LIMIT).sort(compareDeltaItems)
  };
}

// Compares a run's discoveries with the previous completed recon run for the same target.
// `loaded` ({ domains, urls, httpServices } of this run) lets callers reuse lists they already read.
function buildRunDelta(store, runId, loaded = {}) {
  const run = store.getRun(runId);
  if (!run) return null;
  const previousRun = COMPARABLE_RUN_TYPES.has(run.run_type) ? store.getPreviousRunForTarget(run.target_name, run.id) : null;
  const base = { runId: run.id, targetName: run.target_name };
  if (!previousRun) {
    return {
      ...base,
      comparedToRunId: null,
      comparedToStartedAt: null,
      domains: emptyDeltaSet(),
      urls: emptyDeltaSet(),
      httpServices: emptyDeltaSet()
    };
  }
  const list = (method, id) => store[method]({ runId: id, limit: FULL_LIST_LIMIT });
  const current = (key, method) => loaded[key] || list(method, run.id);
  return {
    ...base,
    comparedToRunId: previousRun.id,
    comparedToStartedAt: previousRun.started_at,
    domains: compareValues({ current: current("domains", "listDomains"), previous: list("listDomains", previousRun.id), valueKey: "domain" }),
    urls: compareValues({ current: current("urls", "listUrls"), previous: list("listUrls", previousRun.id), valueKey: "url" }),
    httpServices: compareValues({ current: current("httpServices", "listHttpServices"), previous: list("listHttpServices", previousRun.id), valueKey: "url" })
  };
}

module.exports = {
  buildRunDelta
};
