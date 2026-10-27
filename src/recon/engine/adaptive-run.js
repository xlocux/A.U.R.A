"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { benchmarkReconHost } = require("../adaptive-recon-profile");
const { withRunContext } = require("../run-context");
const { DEPRECATED_SCREENSHOT_TOOLS, SUPPORTED_SCREENSHOT_TOOLS } = require("./constants");
const { watchRunCancellation } = require("./run-control");

function defaultArtifactsDir(runId) {
  return path.resolve("data", "recon-runs", String(Number(runId)));
}

function splitScreenshotTools(tools) {
  const requested = Array.isArray(tools) ? tools.map((tool) => String(tool).toLowerCase()) : null;
  if (!requested) return { screenshotTools: undefined, deprecated: [], unsupported: [] };
  return {
    screenshotTools: requested.filter((tool) => SUPPORTED_SCREENSHOT_TOOLS.has(tool)),
    deprecated: requested.filter((tool) => DEPRECATED_SCREENSHOT_TOOLS.has(tool)),
    unsupported: requested.filter((tool) => !SUPPORTED_SCREENSHOT_TOOLS.has(tool) && !DEPRECATED_SCREENSHOT_TOOLS.has(tool))
  };
}

function recordPreflight({ store, runId, functionName, profile, artifactsDir, deprecated, unsupported }) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "adaptive-preflight.json"), JSON.stringify({ functionName, generatedAt: new Date().toISOString(), profile }, null, 2), "utf8");
  if (!store || !runId) return;
  store.appendEvent(runId, {
    phase: "adaptive-preflight",
    severity: "ok",
    source: "adaptive-benchmark",
    message: `${functionName} adaptive preflight selected ${profile.profile} profile before recon execution.`,
    payload: profile
  });
  store.appendEvent(runId, { phase: "ai-stage-awareness", severity: "info", source: "ai-stage-awareness", message: profile.aiRationale, payload: { functionName, adaptiveProfile: profile } });
  if (deprecated.length) {
    store.appendEvent(runId, {
      phase: "tool-deprecation",
      severity: "warn",
      source: "tool-registry",
      message: `${functionName} removed deprecated screenshot tools from this run: ${deprecated.join(", ")}.`,
      payload: { removed: deprecated, replacement: "gowitness" }
    });
  }
  if (unsupported.length) {
    store.appendEvent(runId, { phase: "tool-deprecation", severity: "warn", source: "tool-registry", message: `${functionName} ignored unsupported screenshot tools: ${unsupported.join(", ")}.` });
  }
}

// Wraps a pipeline with the per-run adaptive profile, a cancel signal that kills running tools,
// and an isolated run context (replaces the old global monkeypatch).
function withAdaptiveRun(functionName, pipeline) {
  return async function adaptiveRun(options = {}) {
    const { store, runId, targetName } = options;
    const profile = options.adaptiveProfile || benchmarkReconHost();
    const artifactsDir = options.artifactsDir || defaultArtifactsDir(runId);
    const { screenshotTools, deprecated, unsupported } = splitScreenshotTools(options.screenshotTools);
    recordPreflight({ store, runId, functionName, profile, artifactsDir, deprecated, unsupported });
    const cancellation = store && runId ? watchRunCancellation(store, runId) : null;
    try {
      return await withRunContext(
        // artifactsDir: where tools run; rootDomains: the in-scope roots (page scripts are fetched only from them)
        { store, runId, targetName, adaptiveProfile: profile, cancelSignal: cancellation?.signal || null, artifactsDir, rootDomains: (options.rootDomains || []).map((d) => String(d).trim().toLowerCase()).filter(Boolean) },
        () => pipeline({ ...options, artifactsDir, adaptiveProfile: profile, ...(screenshotTools ? { screenshotTools } : {}) })
      );
    } finally {
      cancellation?.stop();
    }
  };
}

module.exports = {
  withAdaptiveRun
};
