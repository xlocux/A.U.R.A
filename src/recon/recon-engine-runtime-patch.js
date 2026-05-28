"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { applyAdaptiveTimeout, benchmarkReconHost } = require("./adaptive-recon-profile");

let activeProfile = null;

function installReconRuntimePatch() {
  const linuxTools = require("./linux-tools");
  patchLinuxToolRunner(linuxTools);

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

function patchLinuxToolRunner(linuxTools) {
  if (!linuxTools || linuxTools.__auraAdaptiveToolRunnerPatched || typeof linuxTools.runLinuxTool !== "function") return;
  const original = linuxTools.runLinuxTool;
  linuxTools.runLinuxTool = function adaptiveRunLinuxTool(options = {}) {
    const profile = activeProfile;
    if (!profile) return original(options);
    const adapted = adaptToolInvocation(options, profile);
    return original(adapted);
  };
  Object.defineProperty(linuxTools, "__auraAdaptiveToolRunnerPatched", {
    value: true,
    enumerable: false
  });
}

function wrapReconFunction(functionName, original) {
  return async function patchedReconFunction(options = {}) {
    const previousProfile = activeProfile;
    const profile = benchmarkReconHost();
    activeProfile = profile;
    const patchedOptions = {
      ...options,
      timeoutMs: applyAdaptiveTimeout(options.timeoutMs, profile),
      adaptiveProfile: profile
    };
    persistPreflight({ options: patchedOptions, profile, functionName });
    appendPreflightEvents({ options: patchedOptions, profile, functionName });
    try {
      return await original(patchedOptions);
    } finally {
      activeProfile = previousProfile;
    }
  };
}

function adaptToolInvocation(options, profile) {
  const toolName = String(options.toolName || "").toLowerCase();
  const adapted = {
    ...options,
    timeoutMs: applyAdaptiveTimeout(options.timeoutMs, profile)
  };
  if (toolName === "httpx") {
    adapted.args = adaptFlagValue(options.args || [], ["-threads", "-t"], String(profile.httpxThreads));
    adapted.args = ensureFlagValue(adapted.args, "-retries", "1");
    adapted.args = ensureFlagValue(adapted.args, "-timeout", "10");
  }
  if (toolName === "dnsx") {
    adapted.args = adaptFlagValue(options.args || [], ["-t", "-threads"], String(profile.dnsxThreads));
    adapted.args = ensureFlagValue(adapted.args, "-retry", "1");
  }
  if (toolName === "gowitness") {
    adapted.args = ensureFlagValue(options.args || [], "--threads", String(profile.screenshotConcurrency));
  }
  return adapted;
}

function adaptFlagValue(args, flags, value) {
  const output = [...args];
  for (const flag of flags) {
    const index = output.indexOf(flag);
    if (index !== -1) {
      output[index + 1] = value;
      return output;
    }
  }
  output.push(flags[0], value);
  return output;
}

function ensureFlagValue(args, flag, value) {
  const output = [...args];
  const index = output.indexOf(flag);
  if (index !== -1) {
    if (output[index + 1] === undefined || String(output[index + 1]).startsWith("-")) output.splice(index + 1, 0, value);
    return output;
  }
  output.push(flag, value);
  return output;
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

function persistPreflight({ options, profile, functionName }) {
  const artifactsDir = options?.artifactsDir || (options?.runId ? path.resolve("data", "recon-runs", String(options.runId)) : path.resolve("data", "preflight"));
  fs.mkdirSync(artifactsDir, { recursive: true });
  const reportPath = path.join(artifactsDir, "adaptive-preflight.json");
  fs.writeFileSync(reportPath, JSON.stringify({ functionName, generatedAt: new Date().toISOString(), profile }, null, 2), "utf8");
}

module.exports = {
  installReconRuntimePatch
};
