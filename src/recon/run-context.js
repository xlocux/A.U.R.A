"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

// Per-run execution context (store, runId, targetName, adaptive profile, cancel signal).
// AsyncLocalStorage keeps concurrent runs isolated: every tool spawned while a run's pipeline
// is executing sees that run's context and nobody else's.
const storage = new AsyncLocalStorage();

function withRunContext(context, fn) {
  return storage.run({ ...(storage.getStore() || {}), ...context }, fn);
}

function getRunContext() {
  return storage.getStore() || null;
}

module.exports = {
  getRunContext,
  withRunContext
};
