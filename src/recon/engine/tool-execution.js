"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { stripAnsi } = require("../../core/shell");
const { commandDisplay, redactProxyUrl, runLinuxTool } = require("../linux-tools");
const { parseHttpxJsonLines } = require("../parsers");
const ProxyRotationController = require("../proxy-rotation");
const { buildProxyAwareInvocation } = require("../tool-proxy-policy");
const { DEFAULT_TOOL_RECOVERY_ATTEMPTS, TOOL_RECOVERY_PATTERNS } = require("./constants");
const { sleep } = require("./run-control");
const { httpxArgsForInput, writeInputFile } = require("./tool-args");

const HEARTBEAT_MS = 15000;
const RETRY_DELAY_MS = 2000;

function firstUsefulLine(value) {
  return stripAnsi(value).split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 240) || "";
}

function toolFailureDetail(result) {
  if (result.status === "completed") return result.outputTruncated ? "; output truncated at the capture limit, results may be incomplete" : "";
  const detail = firstUsefulLine(result.stderr || result.errorMessage || result.stdout);
  return detail ? `; ${detail}` : "";
}

function writeToolArtifact(dir, name, content) {
  const filePath = path.join(dir, name.replaceAll(/[^a-z0-9_.-]/gi, "_"));
  fs.writeFileSync(filePath, content || "", "utf8");
  return filePath;
}

function appendAiLog(store, runId, message, payload = {}) {
  store.appendEvent(runId, { phase: "ai-followup", severity: payload.stage === "summary" ? "ok" : "info", source: "ai-runbook", message, payload });
}

// Preserves raw stdout/stderr as artifacts, then records the tool result row that links to them.
function recordToolRun({ store, runId, artifactsDir, artifactName, toolName, args, linuxRuntime, result }) {
  const stdoutPath = writeToolArtifact(artifactsDir, `${artifactName}.stdout.txt`, result.stdout);
  const stderrPath = writeToolArtifact(artifactsDir, `${artifactName}.stderr.txt`, result.stderr);
  store.recordToolResult(runId, {
    toolName,
    commandDisplay: commandDisplay(linuxRuntime, toolName, args),
    status: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    stdoutPath,
    stderrPath,
    errorMessage: result.errorMessage
  });
  return { stdoutPath, stderrPath };
}

// Builds the proxy controller for a run: the operator's proxy URL plus, only when explicitly enabled,
// the shared preflight-ranked proxy pool.
async function createProxyController({ store, runId, proxyUrl = null, useProxyPool = false, phase = "recon" }) {
  if (!proxyUrl && !useProxyPool) return null;
  try {
    const controller = await ProxyRotationController.create({ store, runId, preferredProxyUrl: proxyUrl, usePool: useProxyPool });
    if (!controller.hasPool()) {
      controller.close();
      return null;
    }
    return controller;
  } catch (error) {
    store.appendEvent(runId, {
      phase,
      severity: "warn",
      source: "proxy-preflight",
      message: `Proxy preflight/rotation unavailable: ${error.message}. Continuing with the configured network route.`
    });
    return null;
  }
}

function announceProxy(store, runId, phase, proxyController, selectedProxyUrl) {
  if (!selectedProxyUrl) return;
  store.appendEvent(runId, {
    phase,
    severity: "ok",
    source: "network",
    message: proxyController?.usePool
      ? `Automatic proxy rotation enabled. Best preflight proxy: ${redactProxyUrl(selectedProxyUrl)}`
      : `Outbound proxy enabled for Linux recon tools: ${redactProxyUrl(selectedProxyUrl)}`
  });
}

function runLinuxToolWithProxy({ proxyController, runtime, toolName, args, timeoutMs, input = null, proxyUrl = null }) {
  if (proxyController?.hasPool()) return proxyController.runTool({ runtime, toolName, args, timeoutMs, input });
  const invocation = buildProxyAwareInvocation({ toolName, args, proxyUrl });
  return runLinuxTool({ runtime, toolName, args: invocation.args, timeoutMs, input, proxyUrl: invocation.envProxyUrl });
}

async function runToolWithHeartbeat({ store, runId, phase, source, heartbeatMessage, task }) {
  let heartbeatCount = 0;
  const heartbeat = setInterval(() => {
    heartbeatCount += 1;
    store.appendEvent(runId, { phase, source, message: heartbeatMessage((heartbeatCount * HEARTBEAT_MS) / 1000) });
  }, HEARTBEAT_MS);
  try {
    return await task();
  } finally {
    clearInterval(heartbeat);
  }
}

function shouldRetryToolResult(result) {
  if (!result) return "no tool result";
  if (result.status === "cancelled") return "";
  if (result.status === "timeout") return result.errorMessage || "tool timeout";
  if (result.status === "error") return result.errorMessage || "tool runner error";
  const combined = [result.stderr, result.errorMessage, result.stdout].filter(Boolean).join("\n").slice(0, 20000);
  if (result.status === "failed" && TOOL_RECOVERY_PATTERNS.some((pattern) => pattern.test(combined))) {
    return firstUsefulLine(combined) || "transient network/tool failure";
  }
  return "";
}

function appendAiToolRecovery(store, runId, { stage, toolName, attempt, maxAttempts, reason }) {
  const messages = {
    retrying: `${toolName} looks stalled or hit a transient tool/network error. I am retrying it (${attempt + 1}/${maxAttempts}) while the run keeps its current context.`,
    recovered: `${toolName} recovered after retry (${attempt}/${maxAttempts}). I will keep the recovered output and continue the run.`,
    exhausted: `${toolName} still failed after ${attempt}/${maxAttempts} attempts. I will keep partial artifacts, mark it as warning, and continue with non-blocking steps.`
  };
  store.appendEvent(runId, {
    phase: "ai-tool-recovery",
    severity: stage === "recovered" ? "ok" : "warn",
    source: "ai-tool-recovery",
    message: messages[stage] || `${toolName} recovery update: ${stage}`,
    payload: { stage, toolName, attempt, maxAttempts, reason }
  });
}

async function runToolWithRecovery({ store, runId, phase, source, heartbeatMessage, task, maxAttempts = DEFAULT_TOOL_RECOVERY_ATTEMPTS, retryDelayMs = RETRY_DELAY_MS }) {
  const attempts = Math.max(1, Number.parseInt(maxAttempts, 10) || 1);
  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runToolWithHeartbeat({ store, runId, phase, source, heartbeatMessage, task });
    result.recovery = { attempt, maxAttempts: attempts, retried: attempt > 1 };
    lastResult = result;
    const retryReason = shouldRetryToolResult(result);
    if (!retryReason) {
      if (attempt > 1) appendAiToolRecovery(store, runId, { stage: "recovered", toolName: source, attempt, maxAttempts: attempts, reason: "tool completed after retry" });
      return result;
    }
    if (attempt >= attempts) {
      appendAiToolRecovery(store, runId, { stage: "exhausted", toolName: source, attempt, maxAttempts: attempts, reason: retryReason });
      return result;
    }
    appendAiToolRecovery(store, runId, { stage: "retrying", toolName: source, attempt, maxAttempts: attempts, reason: retryReason });
    await sleep(retryDelayMs);
  }
  return lastResult;
}

// Shared httpx probe used by HTTP follow-ups and recovery: writes input, runs, preserves artifacts,
// parses and saves live services. Returns { result, services }.
async function runHttpxOnHosts({ store, runId, targetName, hosts, artifactName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, source = "httpx", maxAttempts, label = "httpx" }) {
  const inputPath = writeInputFile(artifactsDir, `${artifactName}.input.txt`, hosts);
  const args = httpxArgsForInput(inputPath);
  const result = await runToolWithRecovery({
    store,
    runId,
    phase: "heartbeat",
    source: "httpx",
    heartbeatMessage: (elapsed) => `${label} is still running (${elapsed}s elapsed)`,
    maxAttempts: maxAttempts ?? (proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS),
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "httpx", args, timeoutMs, proxyUrl })
  });
  recordToolRun({ store, runId, artifactsDir, artifactName, toolName: "httpx", args, linuxRuntime, result });
  const services = parseHttpxJsonLines(result.stdout);
  if (services.length) store.saveHttpServices(runId, targetName, services, source);
  return { result, services };
}

module.exports = {
  announceProxy,
  appendAiLog,
  createProxyController,
  firstUsefulLine,
  recordToolRun,
  runHttpxOnHosts,
  runLinuxToolWithProxy,
  runToolWithRecovery,
  shouldRetryToolResult,
  toolFailureDetail,
  writeToolArtifact
};
