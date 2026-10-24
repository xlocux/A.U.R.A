"use strict";

const POLL_MS = 1000;
const CANCEL_WATCH_MS = 2000;

class RunControlError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "RunControlError";
    this.status = status;
  }
}

function isRunControlError(error) {
  return error?.name === "RunControlError";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Blocks while the run is paused; throws RunControlError once it is cancelled or deleted.
async function waitForRunControl(store, runId) {
  let run = store.getRun(runId);
  if (!run) throw new RunControlError("cancelled", "Run no longer exists");
  if (run.status === "cancelled") throw new RunControlError("cancelled", "Run cancelled by user");
  if (run.status !== "paused") return;
  store.appendEvent(runId, { phase: "control", severity: "warn", source: "engine", message: "Run paused. Waiting for resume or cancel." });
  while (run.status === "paused") {
    await sleep(POLL_MS);
    run = store.getRun(runId);
    if (!run || run.status === "cancelled") throw new RunControlError("cancelled", "Run cancelled by user");
  }
  store.appendEvent(runId, { phase: "control", severity: "ok", source: "engine", message: "Run resumed." });
}

// Aborts the returned signal when the run is cancelled, so running tools are killed instead of
// finishing their full timeout.
function watchRunCancellation(store, runId) {
  const controller = new AbortController();
  const timer = setInterval(() => {
    const run = store.getRun(runId);
    if (!run || run.status === "cancelled") {
      controller.abort();
      clearInterval(timer);
    }
  }, CANCEL_WATCH_MS);
  timer.unref?.();
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}

// Marks a run completed unless the user cancelled it meanwhile (a cancel must never be overwritten).
async function completeRun(store, runId, checkpoint) {
  await waitForRunControl(store, runId);
  return store.updateRun(runId, {
    status: "completed",
    activePhase: "completed",
    finishedAt: new Date().toISOString(),
    checkpoint
  });
}

module.exports = {
  RunControlError,
  completeRun,
  isRunControlError,
  sleep,
  waitForRunControl,
  watchRunCancellation
};
