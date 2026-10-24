"use strict";

const { TOOL_PATH_EXPORT, shellQuote } = require("../core/shell");
const { createEnvironmentRunner } = require("./environment-setup");
const { loadToolRegistry } = require("./tool-registry");

const DEFAULT_CHECK_TIMEOUT_MS = 30000;

function commandFor(check) {
  if (!check?.command) return "";
  return [check.command, ...(check.args || [])].map(shellQuote).join(" ");
}

function extractPath(output) {
  const line = output.split("\n").find((entry) => entry.startsWith("FOUND:"));
  return line ? line.slice(6).trim() : null;
}

function extractVersion(output) {
  return output.split("\n").find((line) => line.trim() && !line.startsWith("FOUND:")) || null;
}

function evaluateCapability(tool, output) {
  const expected = tool.capability_check?.expected_output;
  return expected ? new RegExp(expected, "i").test(output) : true;
}

// Checks one tool through the same shell runner used for execution, so PATH resolution matches.
async function checkToolBinary(tool, { runner = createEnvironmentRunner(), timeoutMs = DEFAULT_CHECK_TIMEOUT_MS } = {}) {
  const binary = String(tool.binary || "");
  const versionCommand = commandFor(tool.version_check);
  const capabilityCommand = commandFor(tool.capability_check);
  const command = [
    TOOL_PATH_EXPORT,
    `resolved="$(command -v ${shellQuote(binary)} 2>/dev/null || true)"`,
    "test -n \"$resolved\" || exit 127",
    "printf 'FOUND:%s\\n' \"$resolved\"",
    versionCommand ? `{ ${versionCommand} 2>&1 | head -n 1; true; }` : "",
    capabilityCommand ? `{ ${capabilityCommand} 2>&1 | head -n 40; true; }` : ""
  ].filter(Boolean).join(" && ");
  const result = await runner.run(command, timeoutMs);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const found = result.status === "completed" && output.includes("FOUND:");
  const capabilityOk = found && evaluateCapability(tool, output);
  return {
    tool_id: tool.tool_id,
    binary,
    found,
    capabilityOk,
    status: !found ? "missing" : capabilityOk ? "ok" : "wrong_identity",
    path: found ? extractPath(output) : null,
    version: found ? extractVersion(output) : null,
    error: !found
      ? result.status === "timed_out" ? `Checking '${binary}' timed out` : `Binary '${binary}' not found on PATH`
      : capabilityOk ? null : `Binary '${binary}' does not match expected capability signature`
  };
}

/**
 * Verifies that the requested tools are installed and have the expected identity.
 * `toolIds: null` checks every registry tool; an empty array checks nothing.
 * Returns { available, missing, wrongCapability, details }.
 */
async function preflightCheckToolAvailability({ toolIds = null, registry = loadToolRegistry(), runner = createEnvironmentRunner() } = {}) {
  const requested = Array.isArray(toolIds) ? [...new Set(toolIds)] : registry.list().map((tool) => tool.tool_id);
  const results = { available: true, missing: [], wrongCapability: [], details: [] };
  const checks = await Promise.all(requested.map(async (toolId) => {
    const tool = registry.get(toolId);
    if (!tool) return { tool_id: toolId, status: "unknown", found: false, capabilityOk: false, error: "Tool not in registry" };
    return checkToolBinary(tool, { runner });
  }));
  for (const detail of checks) {
    results.details.push(detail);
    if (!detail.found) {
      results.available = false;
      results.missing.push(detail.tool_id);
    } else if (!detail.capabilityOk) {
      results.available = false;
      results.wrongCapability.push(detail.tool_id);
    }
  }
  return results;
}

/** Throws when critical tools are missing or are the wrong binary. */
function assertToolsAvailable({ missing = [], wrongCapability = [], criticalTools = ["httpx", "dnsx"] } = {}) {
  const criticalMissing = missing.filter((id) => criticalTools.includes(id));
  if (criticalMissing.length) {
    throw new Error(`Critical recon tools missing on PATH: ${criticalMissing.join(", ")}. Run environment setup from Settings > Environment before starting recon.`);
  }
  const criticalWrong = wrongCapability.filter((id) => criticalTools.includes(id));
  if (criticalWrong.length) {
    throw new Error(`Tool identity mismatch for: ${criticalWrong.join(", ")}. These tools may be outdated or wrong binaries installed. Reinstall from Settings > Environment.`);
  }
}

module.exports = {
  DEFAULT_CHECK_TIMEOUT_MS,
  assertToolsAvailable,
  checkToolBinary,
  preflightCheckToolAvailability
};
