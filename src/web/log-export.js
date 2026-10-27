"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_TEXT_BYTES = 128 * 1024;
const MAX_TOOL_ARTIFACT_RESULTS = 60;
const MAX_ARTIFACT_FILES = 80;
const ARTIFACT_EXTENSIONS = new Set([".txt", ".log", ".json", ".jsonl", ".stderr", ".stdout"]);

function exportRunDiagnostics({ store, runId }) {
  const run = store.getRun(runId);
  if (!run) return null;
  const target = store.getTarget(run.target_name);
  const counts = store.getRunObservationCounts(runId);
  const events = store.listLatestEvents(runId, 5000);
  const toolResults = store.listToolResults({ runId, limit: 2000 });
  const domains = store.listDomains({ runId, limit: 2000 });
  const urls = store.listUrls({ runId, limit: 2000 });
  const httpServices = store.listHttpServices({ runId, limit: 2000 });
  const technologies = store.listTechnologySummary({ runId, limit: 500 });
  const screenshots = store.listScreenshots({ runId });
  const artifactsDir = path.resolve("data", "recon-runs", String(runId));
  const artifactIndex = indexArtifacts(artifactsDir);
  const toolArtifacts = collectToolArtifacts(toolResults);
  const preflight = readOptionalJson(path.join(artifactsDir, "adaptive-preflight.json"));

  return {
    format: "aura-run-diagnostics-v1",
    exportedAt: new Date().toISOString(),
    repository: "https://github.com/xlocux/A.U.R.A.git",
    run,
    target: target ? sanitizeTarget(target) : null,
    counts,
    aiSummary: buildAiDiagnosticSummary({ run, counts, events, toolResults, screenshots, preflight }),
    adaptivePreflight: preflight,
    events,
    toolResults,
    toolArtifacts,
    observations: {
      domains: domains.slice(0, 500),
      urls: urls.slice(0, 500),
      httpServices: httpServices.slice(0, 500),
      technologies,
      screenshots
    },
    artifactIndex,
    diagnosticHints: buildDiagnosticHints({ counts, events, toolResults, screenshots, artifactIndex })
  };
}

function buildAiDiagnosticSummary({ run, counts, events, toolResults, screenshots, preflight }) {
  const latestWarnings = events.filter((event) => ["warn", "error"].includes(event.severity)).slice(-12);
  const failedTools = toolResults.filter((tool) => tool.status !== "completed");
  const httpxTools = toolResults.filter((tool) => tool.toolName === "httpx");
  const screenshotTools = toolResults.filter((tool) => ["gowitness", "eyewitness"].includes(tool.toolName));
  return {
    runStatus: `${run.status}/${run.active_phase || "-"}`,
    profile: preflight?.profile?.profile || null,
    counts,
    latestWarnings: latestWarnings.map((event) => `${event.created_at} ${event.source || "system"}: ${event.message}`),
    failedTools: failedTools.map((tool) => `${tool.toolName}:${tool.status}${tool.errorMessage ? `:${tool.errorMessage}` : ""}`),
    httpxRuns: httpxTools.map((tool) => ({ id: tool.id, status: tool.status, stdoutPath: tool.stdoutPath, stderrPath: tool.stderrPath, errorMessage: tool.errorMessage })),
    screenshotRuns: screenshotTools.map((tool) => ({ id: tool.id, toolName: tool.toolName, status: tool.status, stdoutPath: tool.stdoutPath, stderrPath: tool.stderrPath, errorMessage: tool.errorMessage })),
    screenshotRecords: screenshots.length
  };
}

function buildDiagnosticHints({ counts, events, toolResults, screenshots, artifactIndex }) {
  const hints = [];
  const httpx = toolResults.filter((tool) => tool.toolName === "httpx");
  const latestHttpx = httpx.at(0);
  if (counts.domains > 0 && counts.httpServices === 0) {
    hints.push("Domains exist but HTTP services are zero: inspect httpx stdout/stderr, adaptive batching, binary identity, and parser compatibility.");
  }
  if (latestHttpx && latestHttpx.status !== "completed") {
    hints.push(`Latest httpx status is ${latestHttpx.status}: inspect exported stderr/stdout around that tool result.`);
  }
  if (counts.httpServices > 0 && screenshots.length === 0) {
    hints.push("HTTP services exist but screenshot records are zero: inspect gowitness availability, Chromium/browser dependencies, and screenshot output directory permissions.");
  }
  if (artifactIndex.files.some((file) => file.relativePath.includes("httpx-batches"))) {
    hints.push("Adaptive httpx batching artifacts are present: compare per-batch input files and merged stdout to find failed batches.");
  }
  const timeoutEvents = events.filter((event) => /timeout|timed out/i.test(event.message || ""));
  if (timeoutEvents.length) hints.push(`${timeoutEvents.length} timeout-related event(s) found in run log.`);
  return hints;
}

// Only the most recent tool results get their stdout/stderr embedded, to keep exports bounded.
function collectToolArtifacts(toolResults) {
  const artifacts = [];
  for (const tool of toolResults.slice(0, MAX_TOOL_ARTIFACT_RESULTS)) {
    for (const stream of ["stdout", "stderr"]) {
      const filePath = stream === "stdout" ? tool.stdoutPath : tool.stderrPath;
      if (!filePath) continue;
      artifacts.push({
        toolResultId: tool.id,
        toolName: tool.toolName,
        stream,
        path: filePath,
        file: readTextArtifact(filePath)
      });
    }
  }
  return artifacts;
}

function indexArtifacts(rootDir) {
  if (!fs.existsSync(rootDir)) return { rootDir, exists: false, files: [] };
  const files = [];
  walk(rootDir, (filePath) => {
    if (files.length >= MAX_ARTIFACT_FILES) return;
    const stat = safeStat(filePath);
    if (!stat || !stat.isFile()) return;
    const relativePath = path.relative(rootDir, filePath).replaceAll("\\", "/");
    const ext = path.extname(filePath).toLowerCase();
    const entry = { relativePath, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
    if (ARTIFACT_EXTENSIONS.has(ext) || /stdout|stderr|preflight|batch/i.test(relativePath)) {
      entry.preview = readTextArtifact(filePath);
    }
    files.push(entry);
  });
  return { rootDir, exists: true, truncated: files.length >= MAX_ARTIFACT_FILES, files };
}

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(filePath, visit);
    else visit(filePath);
  }
}

function readTextArtifact(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  const stat = safeStat(resolved);
  if (!stat || !stat.isFile()) return { available: false, error: "file not found" };
  const handle = fs.openSync(resolved, "r");
  try {
    const size = Math.min(stat.size, MAX_TEXT_BYTES);
    const buffer = Buffer.alloc(size);
    fs.readSync(handle, buffer, 0, size, 0);
    return {
      available: true,
      sizeBytes: stat.size,
      truncated: stat.size > MAX_TEXT_BYTES,
      content: redactSecrets(buffer.toString("utf8"))
    };
  } catch (error) {
    return { available: false, error: error.message };
  } finally {
    fs.closeSync(handle);
  }
}

function readOptionalJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { error: error.message };
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function sanitizeTarget(target) {
  return {
    target_name: target.target_name,
    asset_type: target.asset_type,
    program_url: target.program_url,
    config_path: target.config_path,
    scope: target.scope
  };
}

function redactSecrets(value) {
  return String(value || "")
    .replace(/(api[_-]?key|token|secret|password|authorization)(["'\s:=]+)([^\s"',}]+)/gi, "$1$2REDACTED")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1REDACTED");
}

function diagnosticDownloadName(run) {
  const target = String(run?.target_name || "target").replaceAll(/[^a-z0-9_.-]+/gi, "-");
  const id = run?.id || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  return `aura-run-${id}-${target}-diagnostics-${day}.json`;
}

module.exports = {
  diagnosticDownloadName,
  exportRunDiagnostics
};
