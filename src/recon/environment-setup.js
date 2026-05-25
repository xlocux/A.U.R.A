"use strict";

const { spawn } = require("node:child_process");
const { loadToolRegistry } = require("./tool-registry");

const DEFAULT_SETUP_TIMEOUT_MS = 10 * 60 * 1000;
const OPENCODE_TOOL = {
  tool_id: "opencode",
  binary: "opencode",
  version_check: { command: "opencode", args: ["--version"] },
  install: { method: "shell", source: "curl -fsSL https://opencode.ai/install | bash" }
};
const SYSTEM_PREREQUISITES_TOOL = {
  tool_id: "system-prerequisites",
  binary: "sh",
  install: { method: "system_prerequisites" }
};

function setupToolIds(registry = loadToolRegistry()) {
  return registry.list().map((tool) => tool.tool_id);
}

async function checkWslEnvironment({ distro = "linux", toolIds = null, registry = loadToolRegistry() } = {}) {
  const requested = toolIds || setupToolIds(registry);
  const runner = createEnvironmentRunner();
  const distroCheck = await runner.run("printf '%s' \"${PRETTY_NAME:-$(uname -s)}\"", 30000);
  const agent = await checkTool({ runner, tool: OPENCODE_TOOL });
  const tools = [];
  for (const toolId of requested) {
    const tool = registry.require(toolId);
    tools.push(await checkTool({ runner, tool }));
  }
  return {
    distro,
    runtime: "linux",
    mode: runner.mode,
    environmentAvailable: distroCheck.status === "completed",
    wslAvailable: false,
    distroName: distroCheck.stdout || null,
    agent,
    tools
  };
}

async function installWslTools({ distro = "linux", toolIds = null, registry = loadToolRegistry() } = {}) {
  const requested = toolIds || setupToolIds(registry);
  const runner = createEnvironmentRunner();
  const results = [];
  results.push(await installTool({ runner, tool: SYSTEM_PREREQUISITES_TOOL }));
  results.push(await installTool({ runner, tool: OPENCODE_TOOL }));
  for (const toolId of requested) {
    const tool = registry.require(toolId);
    results.push(await installTool({ runner, tool }));
  }
  return { distro, runtime: "linux", mode: runner.mode, tools: results };
}

async function checkTool({ runner, tool }) {
  const binary = shellQuote(tool.binary);
  const command = `export PATH="$HOME/go/bin:$HOME/.npm-global/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH" && command -v ${binary} >/dev/null 2>&1 && ${versionCommand(tool)} || exit 127`;
  const result = await runner.run(command, 60000);
  return {
    tool_id: tool.tool_id,
    binary: tool.binary,
    installed: result.status === "completed",
    status: result.status,
    version: result.status === "completed" ? firstLine(result.stdout || result.stderr) : null,
    error: result.status === "completed" ? null : firstLine(result.stderr || result.errorMessage || "Tool not found")
  };
}

async function installTool({ runner, tool }) {
  if (tool.install?.method === "system_prerequisites") {
    return installSystemPrerequisites({ runner, tool });
  }
  if (!tool.install || !["go_install", "shell", "npm_global", "apt"].includes(tool.install.method) || !tool.install.source) {
    return {
      tool_id: tool.tool_id,
      status: "skipped",
      message: "No supported install method is declared for this tool"
    };
  }
  const command = tool.install.method === "shell"
    ? [
      "command -v curl >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y curl)",
      tool.install.source,
      `export PATH="$HOME/go/bin:$HOME/.npm-global/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"`,
      `command -v ${shellQuote(tool.binary)}`
    ].join(" && ")
    : tool.install.method === "npm_global"
      ? [
        "command -v npm >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y nodejs npm)",
        "mkdir -p \"$HOME/.npm-global\"",
        "npm config set prefix \"$HOME/.npm-global\"",
        `export PATH="$HOME/go/bin:$HOME/.npm-global/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"`,
        `npm install -g ${shellQuote(tool.install.source)}`,
        `command -v ${shellQuote(tool.binary)}`
      ].join(" && ")
      : tool.install.method === "apt"
        ? [
          "command -v apt-get >/dev/null 2>&1 || exit 127",
          "sudo apt-get update",
          `sudo apt-get install -y ${shellQuote(tool.install.source)}`,
          `command -v ${shellQuote(tool.binary)}`
        ].join(" && ")
        : [
      "command -v go >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y golang-go git)",
      `export PATH="$HOME/go/bin:$PATH"`,
      `go install ${shellQuote(tool.install.source)}`,
      `command -v ${shellQuote(tool.binary)}`
    ].join(" && ");
  const result = await runner.run(command, DEFAULT_SETUP_TIMEOUT_MS);
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

async function installSystemPrerequisites({ runner, tool }) {
  const command = [
    "set -eu",
    "if command -v apt-get >/dev/null 2>&1; then",
    "  export DEBIAN_FRONTEND=noninteractive",
    "  sudo apt-get update",
    "  sudo apt-get install -y ca-certificates curl git build-essential unzip tar jq golang-go dnsutils python3 ruby ruby-dev pkg-config libcurl4-openssl-dev",
    "  sudo apt-get install -y seclists || true",
    "  sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser || true",
    "  if ! node -v 2>/dev/null | grep -q '^v24\\.'; then",
    "    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -",
    "    sudo apt-get install -y nodejs",
    "  fi",
    "elif command -v dnf >/dev/null 2>&1; then",
    "  sudo dnf install -y ca-certificates curl git gcc make unzip tar jq golang bind-utils",
    "elif command -v pacman >/dev/null 2>&1; then",
    "  sudo pacman -Sy --needed --noconfirm ca-certificates curl git base-devel unzip tar jq go bind",
    "else",
    "  echo 'No supported package manager found. Install ca-certificates curl git build tools jq Go Node.js 24 and DNS tools manually.' >&2",
    "  exit 1",
    "fi",
    "node -v",
    "go version",
    "git --version",
    "curl --version | head -n 1"
  ].join("\n");
  const result = await runner.run(command, DEFAULT_SETUP_TIMEOUT_MS);
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

function createEnvironmentRunner() {
  return {
    mode: "native",
    run: (command, timeoutMs) => runNativeShell({ command, timeoutMs })
  };
}

function runNativeShell({ command, timeoutMs }) {
  return runShellProcess({ command: "sh", args: ["-lc", command], timeoutMs });
}

function runShellProcess({ command, args, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
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
  createEnvironmentRunner,
  installWslTools,
  setupToolIds
};
