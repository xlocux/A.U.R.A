"use strict";

const { spawn } = require("node:child_process");

const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const TRUNCATION_NOTICE = "\n[A.U.R.A] Output capture truncated to keep the recon engine stable. Full tool output should be reduced with focused follow-up runs.\n";

const ALLOWED_TOOLS = new Set([
  "subfinder",
  "amass",
  "dnsx",
  "puredns",
  "shuffle-dns",
  "gau",
  "httpx",
  "gowitness",
  "eyewitness",
  "retire",
  "wpscan",
  "cmseek"
]);

function runLinuxTool({
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
    const capture = createOutputCapture();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcess(child);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      capture.stdout = appendLimited(capture.stdout, text, capture, "stdout");
      if (onStdout) onStdout(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      capture.stderr = appendLimited(capture.stderr, text, capture, "stderr");
      if (onStderr) onStderr(text);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(finalizeResult({
        toolName,
        args,
        status: "error",
        exitCode: null,
        startedAt,
        stdout: capture.stdout,
        stderr: capture.stderr,
        errorMessage: error.message,
        capture
      }));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve(finalizeResult({
        toolName,
        args,
        status: timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed",
        exitCode,
        startedAt,
        stdout: capture.stdout,
        stderr: capture.stderr,
        errorMessage: timedOut ? `Timed out after ${timeoutMs}ms` : null,
        capture
      }));
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function createOutputCapture() {
  return { stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false };
}

function appendLimited(current, next, capture, streamName) {
  if (capture[`${streamName}Truncated`]) return current;
  const combined = `${current}${next}`;
  if (Buffer.byteLength(combined, "utf8") <= MAX_CAPTURE_BYTES) return combined;
  capture[`${streamName}Truncated`] = true;
  return combined.slice(0, MAX_CAPTURE_BYTES) + TRUNCATION_NOTICE;
}

function finalizeResult(result) {
  const finishedAt = new Date().toISOString();
  const truncated = Boolean(result.capture?.stdoutTruncated || result.capture?.stderrTruncated);
  const errorMessage = [result.errorMessage, truncated ? "Tool output was truncated to prevent parser or UI overload." : ""].filter(Boolean).join("; ") || null;
  return {
    toolName: result.toolName,
    args: result.args,
    status: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt,
    stdout: result.stdout,
    stderr: result.stderr,
    errorMessage,
    outputTruncated: truncated
  };
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
  return [toolName, ...args.map(redactCommandArg)].join(" ");
}

function redactCommandArg(value) {
  const text = String(value);
  try {
    return redactProxyUrl(text) || text;
  } catch {
    return text;
  }
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

function createLinuxToolRunner(options = {}) {
  const { runLinuxToolImpl = runLinuxTool } = options;
  return {
    runLinuxTool: function(opts) {
      return runLinuxToolImpl(opts);
    }
  };
}

module.exports = {
  ALLOWED_TOOLS,
  commandDisplay,
  normalizeProxyUrl,
  redactProxyUrl,
  runLinuxTool,
  createLinuxToolRunner
};
