"use strict";

const { spawn } = require("node:child_process");
const { loadToolRegistry } = require("./tool-registry");

const DEFAULT_CHECK_TIMEOUT_MS = 30000;
const TOOL_PATH_EXPORT = "export PATH=\"$HOME/go/bin:$HOME/.npm-global/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH\"";

/**
 * Verify that requested tools are available and have correct capabilities
 * before running recon. This prevents silent degradation when tools are missing.
 *
 * Returns { available: boolean, missing: [], wrongCapability: [], details: [] }
 */
async function preflightCheckToolAvailability({ toolIds = [], registry = loadToolRegistry() } = {}) {
  const requested = toolIds.length ? toolIds : registry.list().map(t => t.tool_id);
  const results = { available: true, missing: [], wrongCapability: [], details: [] };

  for (const toolId of requested) {
    const tool = registry.get(toolId);
    if (!tool) {
      results.available = false;
      results.missing.push(toolId);
      results.details.push({ toolId, status: "unknown", error: "Tool not in registry" });
      continue;
    }

    const check = await checkToolBinary(tool);
    results.details.push(check);

    if (!check.found) {
      results.available = false;
      results.missing.push(toolId);
    } else if (!check.capabilityOk) {
      results.available = false;
      results.wrongCapability.push(toolId);
    }
  }

  return results;
}

/**
 * Check if a single tool binary is available and has expected capability
 */
async function checkToolBinary(tool) {
  const binary = tool.binary || "";
  const command = [
    TOOL_PATH_EXPORT,
    `resolved="$(command -v '${binary.replace(/'/g, "'\"'\"'")}'  2>/dev/null || true)"`,
    "test -n \"$resolved\" || exit 127",
    `printf 'FOUND:%s\\n' "$resolved"`,
    buildVersionCheck(tool),
    buildCapabilityCheck(tool)
  ].filter(Boolean).join(" && ");

  const result = await runShellCheck(command, DEFAULT_CHECK_TIMEOUT_MS);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const found = result.exitCode === 0 && output.includes("FOUND:");
  const capabilityOk = found && evaluateCapability(tool, output);

  return {
    tool_id: tool.tool_id,
    binary: tool.binary,
    found,
    capabilityOk,
    status: !found ? "missing" : !capabilityOk ? "wrong_identity" : "ok",
    path: found ? extractPathFromOutput(output) : null,
    version: found ? extractVersionFromOutput(output) : null,
    error: !found ? `Binary '${binary}' not found on PATH` : !capabilityOk ? `Binary '${binary}' does not match expected capability signature` : null,
    raw: { stdout: result.stdout, stderr: result.stderr }
  };
}

/**
 * Throw error if critical tools are missing before running recon
 */
function assertToolsAvailable({ missing = [], wrongCapability = [], criticalTools = ["httpx", "dnsx"] } = {}) {
  const criticalMissing = missing.filter(id => criticalTools.includes(id));
  const criticalWrong = wrongCapability.filter(id => criticalTools.includes(id));

  if (criticalMissing.length) {
    throw new Error(
      `Critical recon tools missing on PATH: ${criticalMissing.join(", ")}. ` +
      `Run environment setup from Settings > Environment before starting recon.`
    );
  }

  if (criticalWrong.length) {
    throw new Error(
      `Tool identity mismatch for: ${criticalWrong.join(", ")}. ` +
      `These tools may be outdated or wrong binaries installed. ` +
      `Reinstall from Settings > Environment.`
    );
  }
}

function buildVersionCheck(tool) {
  const check = tool.version_check || {};
  if (!check.command) return "";
  const cmd = `'${(check.command || "").replace(/'/g, "'\"'\"'")}'`;
  const args = (check.args || []).map(arg => `'${arg.replace(/'/g, "'\"'\"'")}'`).join(" ");
  return `${cmd}${args ? ` ${args}` : ""} 2>&1 | head -n 1 || true`;
}

function buildCapabilityCheck(tool) {
  const check = tool.capability_check || {};
  if (!check.command) return "";
  const cmd = `'${(check.command || "").replace(/'/g, "'\"'\"'")}'`;
  const args = (check.args || []).map(arg => `'${arg.replace(/'/g, "'\"'\"'")}'`).join(" ");
  return `${cmd}${args ? ` ${args}` : ""} 2>&1 || true`;
}

function evaluateCapability(tool, output) {
  const check = tool.capability_check || {};
  if (!check.expected_output) return true;
  const regex = new RegExp(check.expected_output, "i");
  return regex.test(output);
}

function extractPathFromOutput(output) {
  const line = output.split("\n").find(l => l.startsWith("FOUND:"));
  return line ? line.slice(5).trim() : null;
}

function extractVersionFromOutput(output) {
  const lines = output.split("\n").filter(l => !l.startsWith("FOUND:") && l.trim());
  return lines.length ? lines[0] : null;
}

function runShellCheck(command, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", command], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs
    });

    let stdout = "", stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (exitCode || 0),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut
      });
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: "", stderr: "Process error", timedOut: false });
    });
  });
}

module.exports = {
  preflightCheckToolAvailability,
  checkToolBinary,
  assertToolsAvailable,
  DEFAULT_CHECK_TIMEOUT_MS
};
