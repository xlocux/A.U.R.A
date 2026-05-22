"use strict";

const { spawn } = require("node:child_process");
const { loadToolRegistry } = require("./tool-registry");

const DEFAULT_SETUP_TIMEOUT_MS = 10 * 60 * 1000;

function setupToolIds(registry = loadToolRegistry()) {
  return registry.list().map((tool) => tool.tool_id);
}

async function checkWslEnvironment({ distro = "kali-linux", toolIds = null, registry = loadToolRegistry() } = {}) {
  const requested = toolIds || setupToolIds(registry);
  const distroCheck = await runWslShell({ distro, command: "printf '%s' \"$PRETTY_NAME\"", timeoutMs: 30000 });
  const tools = [];
  for (const toolId of requested) {
    const tool = registry.require(toolId);
    tools.push(await checkTool({ distro, tool }));
  }
  return {
    distro,
    wslAvailable: distroCheck.status === "completed",
    distroName: distroCheck.stdout || null,
    tools
  };
}

async function installWslTools({ distro = "kali-linux", toolIds = null, registry = loadToolRegistry() } = {}) {
  const requested = toolIds || setupToolIds(registry);
  const results = [];
  for (const toolId of requested) {
    const tool = registry.require(toolId);
    results.push(await installTool({ distro, tool }));
  }
  return { distro, tools: results };
}

async function checkTool({ distro, tool }) {
  const binary = shellQuote(tool.binary);
  const command = `command -v ${binary} >/dev/null 2>&1 && ${versionCommand(tool)} || exit 127`;
  const result = await runWslShell({ distro, command, timeoutMs: 60000 });
  return {
    tool_id: tool.tool_id,
    binary: tool.binary,
    installed: result.status === "completed",
    status: result.status,
    version: result.status === "completed" ? firstLine(result.stdout || result.stderr) : null,
    error: result.status === "completed" ? null : firstLine(result.stderr || result.errorMessage || "Tool not found")
  };
}

async function installTool({ distro, tool }) {
  if (!tool.install || tool.install.method !== "go_install" || !tool.install.source) {
    return {
      tool_id: tool.tool_id,
      status: "skipped",
      message: "No supported install method is declared for this tool"
    };
  }
  const command = [
    "command -v go >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y golang-go git)",
    `go install ${shellQuote(tool.install.source)}`,
    `command -v ${shellQuote(tool.binary)} >/dev/null 2>&1 || export PATH="$PATH:$HOME/go/bin"`,
    `command -v ${shellQuote(tool.binary)}`
  ].join(" && ");
  const result = await runWslShell({ distro, command, timeoutMs: DEFAULT_SETUP_TIMEOUT_MS });
  return {
    tool_id: tool.tool_id,
    binary: tool.binary,
    status: result.status,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.errorMessage
  };
}

function versionCommand(tool) {
  const check = tool.version_check || {};
  const command = shellQuote(check.command || tool.binary);
  const args = (check.args || []).map(shellQuote).join(" ");
  return `${command}${args ? ` ${args}` : ""}`;
}

function runWslShell({ distro, command, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn("wsl", ["-d", distro, "--", "sh", "-lc", command], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
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
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: "error", exitCode: null, stdout, stderr, errorMessage: error.message });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        status: timedOut ? "timed_out" : exitCode === 0 ? "completed" : "failed",
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        errorMessage: timedOut ? `Timed out after ${timeoutMs}ms` : null
      });
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

module.exports = {
  checkWslEnvironment,
  installWslTools,
  setupToolIds
};
