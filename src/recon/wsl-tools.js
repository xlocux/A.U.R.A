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
  "gowitness",
  "aquatone",
  "eyewitness",
  "retire",
  "wpscan",
  "cmseek"
]);

function runWslTool({
  toolName,
  args = [],
  timeoutMs = 180000,
  input = null,
  onStdout = null,
  onStderr = null,
  proxyUrl = null
}) {
  if (!ALLOWED_TOOLS.has(toolName)) {
    return Promise.reject(new Error(`Tool not allowed for local Linux execution: ${toolName}`));
  }

  const proxy = normalizeProxyUrl(proxyUrl);
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const command = [
      "export PATH=\"$HOME/go/bin:$HOME/.npm-global/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH\"",
      proxy ? proxyExports(proxy) : "",
      [shellQuote(toolName), ...args.map(shellQuote)].join(" ")
    ].filter(Boolean).join(" && ");
    const child = spawn("sh", ["-lc", command], {
      detached: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcess(child);
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

function killProcess(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Process group already exited.
      }
    }, 2000).unref();
  } catch {
    child.kill();
  }
}

function commandDisplay(_runtime, toolName, args) {
  return [toolName, ...args].join(" ");
}

function normalizeProxyUrl(proxyUrl) {
  const value = String(proxyUrl || "").trim();
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Proxy URL must include a scheme, host, and optional port");
  }
  if (!["http:", "https:", "socks4:", "socks5:"].includes(parsed.protocol)) {
    throw new Error("Proxy URL must use http, https, socks4, or socks5");
  }
  if (!parsed.hostname) throw new Error("Proxy URL must include a host");
  return parsed.toString();
}

function redactProxyUrl(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  if (parsed.username) parsed.username = "****";
  if (parsed.password) parsed.password = "****";
  return parsed.toString();
}

function proxyExports(proxyUrl) {
  const quoted = shellQuote(proxyUrl);
  return [
    `export HTTP_PROXY=${quoted}`,
    `export HTTPS_PROXY=${quoted}`,
    `export ALL_PROXY=${quoted}`,
    `export http_proxy=${quoted}`,
    `export https_proxy=${quoted}`,
    `export all_proxy=${quoted}`
  ].join(" && ");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

module.exports = {
  ALLOWED_TOOLS,
  commandDisplay,
  normalizeProxyUrl,
  redactProxyUrl,
  runWslTool
};
