"use strict";

const reconEngine = require("../../recon/recon-engine");

function isRunControlError(error) {
  return error?.name === "RunControlError" || reconEngine.isRunControlError(error);
}

// Executes a run task detached from the HTTP request and records failures on the run itself,
// so a crashed background task never leaves a run stuck in "running".
function runInBackground({ store, runId, phase, task }) {
  Promise.resolve()
    .then(task)
    .catch((error) => recordBackgroundFailure({ store, runId, phase, error }));
}

function recordBackgroundFailure({ store, runId, phase, error }) {
  try {
    if (isRunControlError(error)) {
      store.appendEvent(runId, { phase: "control", severity: "warn", source: "engine", message: error.message });
      return;
    }
    const message = error?.message || String(error);
    store.appendEvent(runId, { phase, severity: "error", source: "engine", message });
    store.updateRun(runId, {
      status: "failed",
      activePhase: "failed",
      finishedAt: new Date().toISOString(),
      errorMessage: message
    });
  } catch (storeError) {
    console.error(`[background-run ${runId}] failed to record failure:`, storeError);
  }
}

module.exports = {
  isRunControlError,
  runInBackground
};
