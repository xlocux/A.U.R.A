"use strict";

const { spawn } = require("node:child_process");

const ALLOWED_TOOLS = new Set([
  "subfinder",
  "amass",
  "dnsx",
  "puredns",
  "shuffle-dns",
  "gau",
  "httpx",
  "aquatone",
  "eyewitness"
]);

function runWslTool({
  distro = "kali-linux",
  toolName,
  args = [],
  timeoutMs = 180000,
  input = null,
  onStdout = null,
  onStderr = null
}) {
  if (!ALLOWED_TOOLS.has(toolName)) {
    return Promise.reject(new Error(`Tool not allowed for WSL recon: ${toolName}`));
  }

  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn("wsl", ["-d", distro, "--", toolName, ...args], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (onStdout) onStdout(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (onStderr) onStderr(text);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        toolName,
        args,
        status: "error",
        exitCode: null,
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout,
        stderr,
        errorMessage: error.message
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        toolName,
        args,
        status: timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed",
        exitCode,
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout,
        stderr,
        errorMessage: timedOut ? `Timed out after ${timeoutMs}ms` : null
      });
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function commandDisplay(distro, toolName, args) {
  return `wsl -d ${distro} -- ${[toolName, ...args].join(" ")}`;
}

module.exports = {
  ALLOWED_TOOLS,
  commandDisplay,
  runWslTool
};
