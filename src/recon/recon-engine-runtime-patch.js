"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { applyAdaptiveTimeout, benchmarkReconHost } = require("./adaptive-recon-profile");
const { patchLinuxToolRunner } = require("./adaptive-linux-tool-runner");

const DEPRECATED_SCREENSHOT_TOOLS = new Set(["aquatone"]);
let activeProfile = null;

function installReconRuntimePatch() {
  const linuxTools = require("./linux-tools");
  patchLinuxToolRunner(linuxTools, () => activeProfile);

  const reconEngine = require("./recon-engine");
  if (reconEngine.__auraAdaptiveRuntimePatched) return reconEngine;

  if (typeof reconEngine.runRecon === "function") {
    reconEngine.runRecon = wrapReconFunction("runRecon", reconEngine.runRecon);
  }
  if (typeof reconEngine.runHttpFollowup === "function") {
    reconEngine.runHttpFollowup = wrapReconFunction("runHttpFollowup", reconEngine.runHttpFollowup);
  }
  if (typeof reconEngine.runFocusedFollowup === "function") {
    reconEngine.runFocusedFollowup = wrapReconFunction("runFocusedFollowup", reconEngine.runFocusedFollowup);
  }

  Object.defineProperty(reconEngine, "__auraAdaptiveRuntimePatched", {
    value: true,
    enumerable: false
  });
  return reconEngine;
}

function wrapReconFunction(functionName, original) {
  return async function patchedReconFunction(options = {}) {
    const previousProfile = activeProfile;
    const profile = benchmarkReconHost();
    activeProfile = profile;
    const patchedOptions = sanitizeDeprecatedOptions({
      ...options,
      timeoutMs: applyAdaptiveTimeout(options.timeoutMs, profile),
      adaptiveProfile: profile
    });
    persistPreflight({ options: patchedOptions, profile, functionName });
    appendPreflightEvents({ options: patchedOptions, profile, functionName });
    appendDeprecationEvents({ options: patchedOptions, functionName });
    try {
      return await original(patchedOptions);
    } finally {
      activeProfile = previousProfile;
    }
  };
}

function sanitizeDeprecatedOptions(options) {
  if (!Array.isArray(options.screenshotTools)) return options;
  const removed = options.screenshotTools.filter((tool) => DEPRECATED_SCREENSHOT_TOOLS.has(String(tool).toLowerCase()));
  const screenshotTools = options.screenshotTools.filter((tool) => !DEPRECATED_SCREENSHOT_TOOLS.has(String(tool).toLowerCase()));
  return { ...options, screenshotTools, deprecatedScreenshotToolsRemoved: removed };
}

function appendPreflightEvents({ options, profile, functionName }) {
  if (!options?.store || !options?.runId) return;
  options.store.appendEvent(options.runId, {
    phase: "adaptive-preflight",
    severity: "ok",
    source: "adaptive-benchmark",
    message: `${functionName} adaptive preflight selected ${profile.profile} profile before recon execution.`,
    payload: profile
  });
  options.store.appendEvent(options.runId, {
    phase: "ai-stage-awareness",
    severity: "info",
    source: "ai-stage-awareness",
    message: profile.aiRationale,
    payload: { functionName, adaptiveProfile: profile }
  });
}

function appendDeprecationEvents({ options, functionName }) {
  if (!options?.store || !options?.runId || !options.deprecatedScreenshotToolsRemoved?.length) return;
  options.store.appendEvent(options.runId, {
    phase: "tool-deprecation",
    severity: "warn",
    source: "tool-registry",
    message: `${functionName} removed deprecated screenshot tools from this run: ${options.deprecatedScreenshotToolsRemoved.join(", ")}.`,
    payload: { removed: options.deprecatedScreenshotToolsRemoved, replacement: "gowitness" }
  });
}

function persistPreflight({ options, profile, functionName }) {
  const artifactsDir = options?.artifactsDir || (options?.runId ? path.resolve("data", "recon-runs", String(options.runId)) : path.resolve("data", "preflight"));
  fs.mkdirSync(artifactsDir, { recursive: true });
  const reportPath = path.join(artifactsDir, "adaptive-preflight.json");
  fs.writeFileSync(reportPath, JSON.stringify({ functionName, generatedAt: new Date().toISOString(), profile }, null, 2), "utf8");
}

module.exports = {
  installReconRuntimePatch
};
