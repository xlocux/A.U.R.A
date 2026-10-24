"use strict";

const DELTA_SAMPLE_LIMIT = 250;
const FULL_LIST_LIMIT = 100000;

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
  const added = [...currentMap].filter(([key]) => !previousMap.has(key)).map(([, item]) => item).sort(compareDeltaItems);
  const removed = [...previousMap].filter(([key]) => !currentMap.has(key)).map(([, item]) => item).sort(compareDeltaItems);
  return {
    currentCount: currentMap.size,
    previousCount: previousMap.size,
    addedCount: added.length,
    removedCount: removed.length,
    stableCount: currentMap.size - added.length,
    added: added.slice(0, DELTA_SAMPLE_LIMIT),
    removed: removed.slice(0, DELTA_SAMPLE_LIMIT)
  };
}

// Compares a run's discoveries with the previous run for the same target.
function buildRunDelta(store, runId) {
  const run = store.getRun(runId);
  if (!run) return null;
  const previousRun = store.getPreviousRunForTarget(run.target_name, run.id);
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
  return {
    ...base,
    comparedToRunId: previousRun.id,
    comparedToStartedAt: previousRun.started_at,
    domains: compareValues({ current: list("listDomains", run.id), previous: list("listDomains", previousRun.id), valueKey: "domain" }),
    urls: compareValues({ current: list("listUrls", run.id), previous: list("listUrls", previousRun.id), valueKey: "url" }),
    httpServices: compareValues({ current: list("listHttpServices", run.id), previous: list("listHttpServices", previousRun.id), valueKey: "url" })
  };
}

module.exports = {
  buildRunDelta
};
