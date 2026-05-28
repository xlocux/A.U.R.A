"use strict";

const { spawn } = require("node:child_process");
const { loadToolRegistry } = require("./tool-registry");

const DEFAULT_SETUP_TIMEOUT_MS = 10 * 60 * 1000;
const TOOL_PATH_EXPORT = "export PATH=\"$HOME/go/bin:$HOME/.npm-global/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH\"";
const OPENCODE_TOOL = {
  tool_id: "opencode",
  binary: "opencode",
  version_check: { command: "opencode", args: ["--version"] },
  capability_check: { command: "opencode", args: ["--version"], expected_output: "opencode" },
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

async function checkLinuxEnvironment({ runtime = "linux", toolIds = null, registry = loadToolRegistry() } = {}) {
  const requested = toolIds || setupToolIds(registry);
  const runner = createEnvironmentRunner();
  const runtimeCheck = await runner.run("printf '%s' \"${PRETTY_NAME:-$(uname -s)}\"", 30000);
  const terminal = await checkTerminalPath({ runner });
  const agent = await checkTool({ runner, tool: OPENCODE_TOOL });
  const tools = [];
  for (const toolId of requested) {
    const tool = registry.require(toolId);
    tools.push(await checkTool({ runner, tool }));
  }
  return {
    runtimeName: runtime,
    runtime: "linux",
    mode: runner.mode,
    environmentAvailable: runtimeCheck.status === "completed",
    linuxName: runtimeCheck.stdout || null,
    terminal,
    agent,
    tools,
    aiSetupAssessment: buildAiSetupAssessment({ terminal, agent, tools })
  };
}

async function installLinuxTools({ runtime = "linux", toolIds = null, registry = loadToolRegistry() } = {}) {
  const requested = toolIds || setupToolIds(registry);
  const runner = createEnvironmentRunner();
  const results = [];
  results.push(await installTool({ runner, tool: SYSTEM_PREREQUISITES_TOOL }));
  results.push(await installTool({ runner, tool: OPENCODE_TOOL }));
  for (const toolId of requested) {
    const tool = registry.require(toolId);
    results.push(await installTool({ runner, tool }));
  }
  const verification = await checkLinuxEnvironment({ runtime, toolIds: requested, registry });
  return {
    runtimeName: runtime,
    runtime: "linux",
    mode: runner.mode,
    tools: results,
    verification,
    aiSetupAssessment: verification.aiSetupAssessment
  };
}

async function checkTerminalPath({ runner }) {
  const command = [
    TOOL_PATH_EXPORT,
    "printf 'PATH=%s\\n' \"$PATH\"",
    "for binary in sh bash node npm go git curl jq; do command -v \"$binary\" >/dev/null 2>&1 && printf '%s=%s\\n' \"$binary\" \"$(command -v \"$binary\")\" || printf '%s=missing\\n' \"$binary\"; done"
  ].join(" && ");
  const result = await runner.run(command, 60000);
  return {
    status: result.status,
    availableOnTerminal: result.status === "completed",
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.errorMessage
  };
}

async function checkTool({ runner, tool }) {
  const binary = shellQuote(tool.binary);
  const command = [
    TOOL_PATH_EXPORT,
    `resolved=\"$(command -v ${binary} 2>/dev/null || true)\"`,
    "test -n \"$resolved\"",
    "printf 'path=%s\\n' \"$resolved\"",
    versionCommand(tool),
    capabilityCommand(tool)
  ].filter(Boolean).join(" && ");
  const result = await runner.run(command, 60000);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const capability = evaluateCapability(tool, output, result.status);
  return {
    tool_id: tool.tool_id,
    binary: tool.binary,
    installed: result.status === "completed" && capability.ok,
    status: result.status === "completed" && capability.ok ? "completed" : result.status === "completed" ? "failed" : result.status,
    version: result.status === "completed" ? firstNonPathLine(output) : null,
    path: extractPath(output),
    capability,
    error: result.status === "completed" && capability.ok ? null : firstLine(result.stderr || capability.message || result.errorMessage || "Tool not found or wrong binary")
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
      TOOL_PATH_EXPORT,
      `command -v ${shellQuote(tool.binary)}`
    ].join(" && ")
    : tool.install.method === "npm_global"
      ? [
        "command -v npm >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y nodejs npm)",
        "mkdir -p \"$HOME/.npm-global\"",
        "npm config set prefix \"$HOME/.npm-global\"",
        TOOL_PATH_EXPORT,
        `npm install -g ${shellQuote(tool.install.source)}`,
        `command -v ${shellQuote(tool.binary)}`
      ].join(" && ")
      : tool.install.method === "apt"
        ? [
          "command -v apt-get >/dev/null 2>&1 || exit 127",
          "sudo apt-get update",
          `sudo apt-get install -y ${shellQuote(tool.install.source)}`,
          TOOL_PATH_EXPORT,
          `command -v ${shellQuote(tool.binary)}`
        ].join(" && ")
        : [
      "command -v go >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y golang-go git)",
      TOOL_PATH_EXPORT,
      `go install ${shellQuote(tool.install.source)}`,
      TOOL_PATH_EXPORT,
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
    "  sudo apt-get install -y chromium chromium-driver || sudo apt-get install -y chromium-browser || true",
    "  if ! node -v 2>/dev/null | grep -q '^v24\\.'; then",
    "    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -",
    "    sudo apt-get install -y nodejs",
    "  fi",
    "elif command -v dnf >/dev/null 2>&1; then",
    "  sudo dnf install -y ca-certificates curl git gcc make unzip tar jq golang bind-utils chromium || true",
    "elif command -v pacman >/dev/null 2>&1; then",
    "  sudo pacman -Sy --needed --noconfirm ca-certificates curl git base-devel unzip tar jq go bind chromium || true",
    "else",
    "  echo 'No supported package manager found. Install ca-certificates curl git build tools jq Go Node.js 24 Chromium and DNS tools manually.' >&2",
    "  exit 1",
    "fi",
    "mkdir -p \"$HOME/go/bin\" \"$HOME/.npm-global/bin\" \"$HOME/.local/bin\"",
    TOOL_PATH_EXPORT,
    "node -v",
    "go version",
    "git --version",
    "curl --version | head -n 1",
    "command -v chromium || command -v chromium-browser || true"
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

function capabilityCommand(tool) {
  const check = tool.capability_check || tool.identity_check || null;
  if (!check?.command) return "";
  const command = shellQuote(check.command);
  const args = (check.args || []).map(shellQuote).join(" ");
  return `${command}${args ? ` ${args}` : ""}`;
}

function evaluateCapability(tool, output, status) {
  if (status !== "completed") return { ok: false, message: "Version/capability command failed" };
  const check = tool.capability_check || tool.identity_check || null;
  if (!check?.expected_output) return { ok: true, message: "No explicit capability signature declared" };
  const expected = new RegExp(check.expected_output, "i");
  const ok = expected.test(output);
  return {
    ok,
    expectedOutput: check.expected_output,
    message: ok ? "Expected tool signature matched" : `Expected signature not found: ${check.expected_output}`
  };
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

function buildAiSetupAssessment({ terminal, agent, tools }) {
  const missing = tools.filter((tool) => !tool.installed).map((tool) => tool.tool_id);
  const wrongIdentity = tools.filter((tool) => tool.capability && tool.capability.ok === false).map((tool) => tool.tool_id);
  const messages = [];
  if (!terminal.availableOnTerminal) messages.push("The terminal PATH preflight failed; recon tools may not be callable from the runner shell.");
  if (!agent.installed) messages.push("The AI coding/diagnostic agent is not available on PATH.");
  if (missing.length) messages.push(`Missing or unusable recon tools: ${missing.join(", ")}.`);
  if (wrongIdentity.length) messages.push(`Tool identity mismatch detected: ${wrongIdentity.join(", ")}. Install the declared ProjectDiscovery/screenshot binaries before running recon.`);
  if (!messages.length) messages.push("Environment looks ready: terminal PATH, AI agent, and recon tools passed preflight checks.");
  return messages.join(" ");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function firstNonPathLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("path=")) || null;
}

function extractPath(value) {
  const line = String(value || "").split(/\r?\n/).find((item) => item.startsWith("path="));
  return line ? line.slice(5).trim() : null;
}

module.exports = {
  checkLinuxEnvironment,
  createEnvironmentRunner,
  installLinuxTools,
  setupToolIds
};
