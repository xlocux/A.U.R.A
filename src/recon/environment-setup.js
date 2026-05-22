"use strict";

const { spawn } = require("node:child_process");
const os = require("node:os");
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

async function checkWslEnvironment({ distro = "kali-linux", toolIds = null, registry = loadToolRegistry() } = {}) {
  const requested = toolIds || setupToolIds(registry);
  const runner = createEnvironmentRunner({ distro });
  const distroCheck = await runner.run("printf '%s' \"${PRETTY_NAME:-$(uname -s)}\"", 30000);
  const agent = await checkTool({ runner, tool: OPENCODE_TOOL });
  const tools = [];
  for (const toolId of requested) {
    const tool = registry.require(toolId);
    tools.push(await checkTool({ runner, tool }));
  }
  return {
    distro,
    mode: runner.mode,
    environmentAvailable: distroCheck.status === "completed",
    wslAvailable: distroCheck.status === "completed",
    distroName: distroCheck.stdout || null,
    agent,
    tools
  };
}

async function installWslTools({ distro = "kali-linux", toolIds = null, registry = loadToolRegistry() } = {}) {
  const requested = toolIds || setupToolIds(registry);
  const runner = createEnvironmentRunner({ distro });
  const results = [];
  results.push(await installTool({ runner, tool: SYSTEM_PREREQUISITES_TOOL }));
  results.push(await installTool({ runner, tool: OPENCODE_TOOL }));
  for (const toolId of requested) {
    const tool = registry.require(toolId);
    results.push(await installTool({ runner, tool }));
  }
  return { distro, mode: runner.mode, tools: results };
}

async function checkTool({ runner, tool }) {
  const binary = shellQuote(tool.binary);
  const command = `export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/go/bin:$PATH" && command -v ${binary} >/dev/null 2>&1 && ${versionCommand(tool)} || exit 127`;
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
  if (!tool.install || !["go_install", "shell"].includes(tool.install.method) || !tool.install.source) {
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
      `export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/go/bin:$PATH"`,
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
    "  sudo apt-get install -y ca-certificates curl git build-essential unzip tar jq golang-go",
    "elif command -v dnf >/dev/null 2>&1; then",
    "  sudo dnf install -y ca-certificates curl git gcc make unzip tar jq golang",
    "elif command -v pacman >/dev/null 2>&1; then",
    "  sudo pacman -Sy --needed --noconfirm ca-certificates curl git base-devel unzip tar jq go",
    "else",
    "  echo 'No supported package manager found. Install ca-certificates curl git build tools jq and Go manually.' >&2",
    "  exit 1",
    "fi",
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

function createEnvironmentRunner({ distro }) {
  if (os.platform() === "win32") {
    return {
      mode: "wsl",
      run: (command, timeoutMs) => runWslShell({ distro, command, timeoutMs })
    };
  }
  return {
    mode: "native",
    run: (command, timeoutMs) => runNativeShell({ command, timeoutMs })
  };
}

function runNativeShell({ command, timeoutMs }) {
  return runShellProcess({ command: "sh", args: ["-lc", command], timeoutMs });
}

function runWslShell({ distro, command, timeoutMs }) {
  return runShellProcess({ command: "wsl", args: ["-d", distro, "--", "sh", "-lc", command], timeoutMs });
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
