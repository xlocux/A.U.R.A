"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { applyAdaptiveTimeout, chunkList } = require("./adaptive-recon-profile");
const { parseHttpxJsonLines } = require("./parsers");
const { commandDisplay } = require("./linux-tools");

const DEFAULT_HTTPX_BATCH_TIMEOUT_MS = 90000;
const PROXY_HTTPX_BATCH_TIMEOUT_MS = 60000;
const DIRECT_HTTPX_BATCH_TIMEOUT_MS = 75000;
const PROXY_HTTPX_THREADS_CAP = 25;
const DIRECT_HTTPX_THREADS_CAP = 50;

// Entry point used by linux-tools.runLinuxTool while a recon run context is active.
function runAdaptiveTool(spawnTool, options, context) {
  const profile = context.adaptiveProfile;
  const adapted = adaptToolInvocation(options, profile);
  if (String(options.toolName || "").toLowerCase() === "httpx") {
    return runBatchedHttpx({ original: spawnTool, options: adapted, profile, context });
  }
  return spawnTool(adapted);
}

// Test/compat helper: wraps any runner with the adaptive behavior for an explicit profile source.
function createAdaptiveToolRunner(originalRunner, getActiveProfile) {
  return {
    runLinuxTool(options = {}) {
      const profile = getActiveProfile?.() || null;
      if (!profile) return originalRunner.runLinuxTool(options);
      const context = { ...(profile.__auraRunContext || {}), adaptiveProfile: profile };
      return runAdaptiveTool((opts) => originalRunner.runLinuxTool(opts), options, context);
    }
  };
}

async function runBatchedHttpx({ original, options, profile, context = {} }) {
  const inputPath = findFlagValue(options.args || [], "-l");
  if (!inputPath || !fs.existsSync(inputPath)) return original(options);
  const hosts = fs.readFileSync(inputPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const store = options.store || context.store || null;
  const runId = options.runId || context.runId || null;
  const targetName = options.targetName || context.targetName || null;
  const proxied = httpxUsesProxy(options.args) || Boolean(options.proxyUrl);
  // Keep batches modest so each httpx invocation finishes within a sane timeout and partial results
  // are saved often (a huge batch that times out mid-probe loses most of its hosts).
  const batchSize = Math.min(profile.httpxBatchSize, proxied ? 80 : 200);
  // Batch whenever we exceed one batch worth of hosts (not only above the full profile size).
  if (hosts.length <= batchSize) return original(options);
  const batches = chunkList(hosts, batchSize);
  // One folder per input file: every httpx call in a run reuses this runner, so a shared folder let later calls overwrite earlier batch files.
  const batchDir = path.join(path.dirname(inputPath), "httpx-batches", path.basename(inputPath, path.extname(inputPath)).replaceAll(/[^a-z0-9_.-]/gi, "_"));
  fs.mkdirSync(batchDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const stdout = [];
  const stderr = [];
  const childResults = [];
  let lastBatchTimeoutMs = 0;

  appendRunEvent(store, runId, {
    phase: "httpx-batch",
    severity: "info",
    source: "adaptive-httpx",
    message: `Adaptive httpx batching started: ${hosts.length} hosts, ${batches.length} batches, batch size ${batchSize}, ${proxied ? "proxy-aware" : "direct"} mode.`,
    payload: { inputCount: hosts.length, batchSize, batchCount: batches.length, proxied }
  });

  // Runs (or re-runs, suffix ".retry") one batch and records its files, tool row and summary at its own index.
  const runBatch = async (index, suffix = "") => {
    const batchNumber = index + 1;
    const stem = path.join(batchDir, `batch-${String(batchNumber).padStart(4, "0")}${suffix}`);
    const batchPath = `${stem}.txt`;
    const stdoutPath = `${stem}.stdout.jsonl`;
    const stderrPath = `${stem}.stderr.txt`;
    fs.writeFileSync(batchPath, `${batches[index].join("\n")}\n`, "utf8");
    const batchTimeoutMs = deriveHttpxBatchTimeout({ options, profile, proxied, batchHosts: batches[index].length });
    lastBatchTimeoutMs = batchTimeoutMs;
    const batchArgs = replaceFlagValue(options.args || [], "-l", batchPath);
    appendRunEvent(store, runId, {
      phase: "httpx-batch",
      severity: "info",
      source: "adaptive-httpx",
      message: `httpx batch ${batchNumber}/${batches.length}${suffix ? " (retry)" : ""} started with ${batches[index].length} hosts and ${Math.round(batchTimeoutMs / 1000)}s timeout.`,
      payload: { batch: batchNumber, batchCount: batches.length, inputCount: batches[index].length, batchPath, batchTimeoutMs }
    });

    const result = await original({ ...options, args: batchArgs, timeoutMs: batchTimeoutMs });
    fs.writeFileSync(stdoutPath, result.stdout || "", "utf8");
    fs.writeFileSync(stderrPath, result.stderr || "", "utf8");
    const services = parseHttpxJsonLines(result.stdout || "");
    // Services are not saved here: the caller saves the merged stdout, saving per batch too stored every row twice.
    if (store?.recordToolResult) {
      store.recordToolResult(runId, {
        toolName: "httpx-batch",
        commandDisplay: commandDisplay(null, "httpx", batchArgs),
        status: result.status,
        exitCode: result.exitCode,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        stdoutPath,
        stderrPath,
        errorMessage: result.errorMessage
      });
    }

    const batchSummary = { batch: batchNumber, inputCount: batches[index].length, status: result.status, exitCode: result.exitCode, errorMessage: result.errorMessage || null, parsedServices: services.length, stdoutPath, stderrPath };
    childResults[index] = batchSummary;
    stdout[index] = result.stdout || ""; // a retry replaces the failed attempt's partial output
    stderr[index] = result.stderr ? `[batch ${batchNumber}/${batches.length}]\n${result.stderr}` : "";
    appendRunEvent(store, runId, {
      phase: "httpx-batch",
      severity: result.status === "completed" ? "ok" : "warn",
      source: "adaptive-httpx",
      message: `httpx batch ${batchNumber}/${batches.length} ${result.status}; parsed ${services.length} HTTP services.`,
      payload: batchSummary
    });
    return result;
  };

  let cancelled = false;
  for (let index = 0; index < batches.length && !cancelled; index += 1) {
    cancelled = (await runBatch(index)).status === "cancelled";
  }
  // Re-run each failed batch once so one bad stretch does not silently drop most of the hosts.
  for (let index = 0; index < batches.length && !cancelled; index += 1) {
    if (!childResults[index] || childResults[index].status === "completed") continue;
    cancelled = (await runBatch(index, ".retry")).status === "cancelled";
  }

  const results = childResults.filter(Boolean);
  const parsedTotal = results.reduce((sum, item) => sum + Number(item.parsedServices || 0), 0);
  const failedBatches = results.filter((b) => b.status !== "completed");
  const batchesMissingOutput = results.filter((b) => b.parsedServices === 0 && b.status === "completed");
  const failedList = failedBatches.map((b) => `batch ${b.batch}: ${b.status}`).join(", ");
  const status = failedBatches.length ? (failedBatches.find((b) => b.status === "cancelled") || failedBatches[0]).status : "completed";
  const exitCode = failedBatches.length ? (failedBatches.find((b) => b.exitCode)?.exitCode ?? null) : 0;

  appendRunEvent(store, runId, {
    phase: "httpx-batch",
    severity: failedBatches.length ? (parsedTotal > 0 ? "warn" : "error") : parsedTotal > 0 ? "ok" : "warn",
    source: "adaptive-httpx",
    message: failedBatches.length
      ? `Adaptive httpx batching incomplete: ${failedBatches.length}/${batches.length} batches still failed after one retry (${failedList}); ${parsedTotal} services parsed from the rest.`
      : parsedTotal > 0
        ? `Adaptive httpx batching finished with ${parsedTotal} parsed services from ${hosts.length} hosts across ${batches.length} batches.`
        : `Adaptive httpx batching completed all batches but parsed ${parsedTotal} services (${batchesMissingOutput.length} batches produced no output). This may indicate httpx is not compatible with your environment or the target hosts are blocking requests.`,
    payload: {
      inputCount: hosts.length,
      parsedServices: parsedTotal,
      batchCount: batches.length,
      failedBatches: failedBatches.length,
      batchesMissingOutput: batchesMissingOutput.length,
      status,
      childResults: results
    }
  });

  return {
    toolName: options.toolName,
    args: options.args,
    status: status !== "completed" ? status : parsedTotal === 0 && batchesMissingOutput.length ? "completed_no_output" : "completed",
    exitCode,
    startedAt,
    finishedAt: new Date().toISOString(),
    stdout: stdout.filter(Boolean).join("\n"),
    stderr: stderr.filter(Boolean).join("\n"),
    errorMessage: status !== "completed"
      ? status === "timeout"
        ? `One or more httpx batches timed out after ${lastBatchTimeoutMs}ms and again on retry (${failedList}). Try increasing timeout or reducing batch size.`
        : `One or more adaptive httpx batches failed after retry: ${failedList}`
      : parsedTotal === 0 && batchesMissingOutput.length
        ? `httpx completed but parsed zero services from ${hosts.length} hosts. This may indicate the target is unreachable, blocking, or httpx binary incompatibility.`
        : null,
    adaptiveBatching: {
      enabled: true,
      inputCount: hosts.length,
      batchSize,
      batchCount: batches.length,
      parsedServices: parsedTotal,
      failedBatches: failedBatches.length,
      batchesMissingOutput: batchesMissingOutput.length,
      proxied,
      childResults: results
    }
  };
}

function adaptToolInvocation(options, profile) {
  const toolName = String(options.toolName || "").toLowerCase();
  const proxied = toolName === "httpx" && (httpxUsesProxy(options.args || []) || Boolean(options.proxyUrl));
  const adapted = { ...options, timeoutMs: applyAdaptiveTimeout(options.timeoutMs, profile) };
  if (toolName === "httpx") {
    const cap = proxied ? PROXY_HTTPX_THREADS_CAP : DIRECT_HTTPX_THREADS_CAP;
    adapted.args = adaptFlagValue(options.args || [], ["-threads", "-t"], String(Math.min(Number(profile.httpxThreads || cap), cap)));
    adapted.args = ensureFlagValue(adapted.args, "-retries", "1");
    adapted.args = ensureFlagValue(adapted.args, "-timeout", proxied ? "6" : "8");
    adapted.args = ensureFlagValue(adapted.args, "-rate-limit", proxied ? "40" : "120");
  }
  if (toolName === "dnsx") {
    adapted.args = adaptFlagValue(options.args || [], ["-t", "-threads"], String(Math.min(Number(profile.dnsxThreads || 50), 50)));
    adapted.args = ensureFlagValue(adapted.args, "-retry", "1");
  }
  if (toolName === "gowitness") {
    adapted.args = ensureFlagValue(options.args || [], "--threads", String(profile.screenshotConcurrency));
  }
  return adapted;
}

function deriveHttpxBatchTimeout({ options, profile, proxied, batchHosts = 0 }) {
  const configured = Number(options.timeoutMs || 0);
  const base = proxied ? PROXY_HTTPX_BATCH_TIMEOUT_MS : DIRECT_HTTPX_BATCH_TIMEOUT_MS;
  // Scale the per-batch timeout with the number of hosts so a batch isn't killed mid-probe (which
  // loses most of its results). Proxied probing is slower per host. Bounded to a sane [base, 5min].
  const perHostMs = proxied ? 1200 : 600;
  const scaled = (batchHosts || 0) * perHostMs;
  const ceiling = Math.max(configured || 0, 300000);
  return Math.min(Math.max(scaled, base, 60000), ceiling);
}

function httpxUsesProxy(args = []) {
  return ["-proxy", "--proxy", "-http-proxy", "--http-proxy"].some((flag) => args.includes(flag));
}

function appendRunEvent(store, runId, event) {
  if (!store || !runId || typeof store.appendEvent !== "function") return;
  store.appendEvent(runId, event);
}

function adaptFlagValue(args, flags, value) {
  const output = [...args];
  for (const flag of flags) {
    const index = output.indexOf(flag);
    if (index !== -1) {
      output[index + 1] = value;
      return output;
    }
  }
  output.push(flags[0], value);
  return output;
}

function ensureFlagValue(args, flag, value) {
  const output = [...args];
  const index = output.indexOf(flag);
  if (index !== -1) {
    if (output[index + 1] === undefined || String(output[index + 1]).startsWith("-")) output.splice(index + 1, 0, value);
    return output;
  }
  output.push(flag, value);
  return output;
}

function findFlagValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] || null;
}

function replaceFlagValue(args, flag, value) {
  const output = [...args];
  const index = output.indexOf(flag);
  if (index === -1) return [...output, flag, value];
  output[index + 1] = value;
  return output;
}

module.exports = { adaptToolInvocation, createAdaptiveToolRunner, runAdaptiveTool, runBatchedHttpx };
