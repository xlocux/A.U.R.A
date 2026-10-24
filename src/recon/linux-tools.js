"use strict";

const { spawn } = require("node:child_process");
const { TOOL_PATH_EXPORT, shellQuote } = require("../core/shell");
const { getRunContext } = require("./run-context");

const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const KILL_GRACE_MS = 2000;
const TRUNCATION_NOTICE = "\n[A.U.R.A] Output capture truncated to keep the recon engine stable. Full tool output should be reduced with focused follow-up runs.\n";

const ALLOWED_TOOLS = new Set([
  "subfinder",
  "amass",
  "dnsx",
  "puredns",
  "shuffle-dns",
  "gau",
  "httpx",
  "nmap",
  "gowitness",
  "eyewitness",
  "retire",
  "wpscan",
  "cmseek"
]);

// Runs an allowlisted tool through `sh -lc`. Inside a recon run the adaptive runner applies the
// host profile (thread caps, httpx batching) and the run's cancel signal stops the process.
function runLinuxTool(options = {}) {
  const context = getRunContext();
  if (context?.adaptiveProfile && !options.skipAdaptive) {
    // Lazy require: the adaptive runner calls back into spawnLinuxTool.
    const { runAdaptiveTool } = require("./adaptive-linux-tool-runner");
    return runAdaptiveTool(spawnLinuxTool, options, context);
  }
  return spawnLinuxTool(options);
}

function spawnLinuxTool({
  toolName,
  args = [],
  timeoutMs = 180000,
  input = null,
  onStdout = null,
  onStderr = null,
  proxyUrl = null,
  signal = getRunContext()?.cancelSignal || null
}) {
  if (!ALLOWED_TOOLS.has(toolName)) {
    return Promise.reject(new Error(`Tool not allowed for local Linux execution: ${toolName}`));
  }
  const proxy = normalizeProxyUrl(proxyUrl);
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    if (signal?.aborted) {
      resolve(finalizeResult({ toolName, args, status: "cancelled", exitCode: null, startedAt, stdout: "", stderr: "", errorMessage: "Run cancelled before the tool started" }));
      return;
    }
    const command = [
      TOOL_PATH_EXPORT,
      proxy ? proxyExports(proxy) : "",
      [shellQuote(toolName), ...args.map(shellQuote)].join(" ")
    ].filter(Boolean).join(" && ");
    const child = spawn("sh", ["-lc", command], {
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const capture = { stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false };
    let stopReason = null;
    const stop = (reason) => {
      if (stopReason) return;
      stopReason = reason;
      killProcess(child);
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const onAbort = () => stop("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

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
    child.stdin.on("error", () => {
      // The tool may exit before reading stdin; EPIPE is expected then.
    });
    child.on("error", (error) => {
      cleanup();
      resolve(finalizeResult({ toolName, args, status: "error", exitCode: null, startedAt, stdout: capture.stdout, stderr: capture.stderr, errorMessage: error.message, capture }));
    });
    child.on("close", (exitCode) => {
      cleanup();
      const status = stopReason || (exitCode === 0 ? "completed" : "failed");
      const errorMessage = stopReason === "timeout"
        ? `Timed out after ${timeoutMs}ms`
        : stopReason === "cancelled" ? "Stopped because the run was cancelled" : null;
      resolve(finalizeResult({ toolName, args, status, exitCode, startedAt, stdout: capture.stdout, stderr: capture.stderr, errorMessage, capture }));
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function appendLimited(current, next, capture, streamName) {
  if (capture[`${streamName}Truncated`]) return current;
  const combined = `${current}${next}`;
  if (Buffer.byteLength(combined, "utf8") <= MAX_CAPTURE_BYTES) return combined;
  capture[`${streamName}Truncated`] = true;
  return combined.slice(0, MAX_CAPTURE_BYTES) + TRUNCATION_NOTICE;
}

function finalizeResult(result) {
  const truncated = Boolean(result.capture?.stdoutTruncated || result.capture?.stderrTruncated);
  const errorMessage = [result.errorMessage, truncated ? "Tool output was truncated to prevent parser or UI overload." : ""].filter(Boolean).join("; ") || null;
  return {
    toolName: result.toolName,
    args: result.args,
    status: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: new Date().toISOString(),
    stdout: result.stdout,
    stderr: result.stderr,
    errorMessage,
    outputTruncated: truncated
  };
}

// Kills the whole process tree: `sh` alone would leave the real tool running.
function killProcess(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Process group already exited.
      }
    }, KILL_GRACE_MS).unref();
  } catch {
    child.kill();
  }
}

function commandDisplay(_runtime, toolName, args = []) {
  return [toolName, ...args.map(redactCommandArg)].join(" ");
}

function redactCommandArg(value) {
  const text = String(value);
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i.test(text)) return text;
  try {
    return redactProxyUrl(text) || text;
  } catch {
    return text.replace(/\/\/[^/@\s]*@/, "//****:****@");
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
  return ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
    .map((name) => `export ${name}=${quoted}`)
    .join(" && ");
}

function createLinuxToolRunner({ runLinuxToolImpl = runLinuxTool } = {}) {
  return { runLinuxTool: (options) => runLinuxToolImpl(options) };
}

module.exports = {
  ALLOWED_TOOLS,
  commandDisplay,
  killProcess,
  createLinuxToolRunner,
  normalizeProxyUrl,
  redactProxyUrl,
  runLinuxTool,
  spawnLinuxTool
};
