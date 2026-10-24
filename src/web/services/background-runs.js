"use strict";

const reconEngine = require("../../recon/recon-engine");

const RUN_CONTROL_POLL_MS = 1000;

function createRunControlError(message) {
  const error = new Error(message);
  error.name = "RunControlError";
  return error;
}

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

// Blocks while a run is paused; throws a RunControlError when it is cancelled or deleted.
async function waitForRunControl(store, runId, label = "Run") {
  let run = store.getRun(runId);
  if (!run || run.status === "cancelled") throw createRunControlError("Run cancelled by user");
  if (run.status !== "paused") return;
  store.appendEvent(runId, {
    phase: "control",
    severity: "warn",
    source: "engine",
    message: `${label} paused. Waiting for resume or cancel.`
  });
  while (run?.status === "paused") {
    await new Promise((resolve) => setTimeout(resolve, RUN_CONTROL_POLL_MS));
    run = store.getRun(runId);
    if (!run || run.status === "cancelled") throw createRunControlError("Run cancelled by user");
  }
}

module.exports = {
  createRunControlError,
  isRunControlError,
  runInBackground,
  waitForRunControl
};
