"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { HttpError, isExistingFile, isInsidePath, sendDownload, sendFile, sendJson } = require("../http-utils");
const { diagnosticDownloadName, exportRunDiagnostics } = require("../log-export");
const { buildRunSnapshot, renderRunExport } = require("../services/run-export");
const { resolveScreenshotImage } = require("../services/screenshot-files");

const RUN_ARTIFACTS_ROOT = path.resolve("data", "recon-runs");
const TOOL_LOG_MAX_BYTES = 1024 * 1024;
// Database files live under data/ too and must never be served as "artifacts".
const BLOCKED_ARTIFACT_PATTERN = /\.(db|sqlite3?)(-wal|-shm|-journal)?$/i;

function serveToolResultLog({ response, store, params, url }) {
  const result = store.getToolResult(params.id);
  if (!result) throw new HttpError(404, "Tool result not found");
  const stream = url.searchParams.get("stream") === "stderr" ? "stderr" : "stdout";
  const filePath = stream === "stderr" ? result.stderrPath : result.stdoutPath;
  if (!isExistingFile(filePath)) throw new HttpError(404, `${stream} log artifact is not available`);
  const { size } = fs.statSync(filePath);
  const start = Math.max(0, size - TOOL_LOG_MAX_BYTES);
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    sendJson(response, {
      toolResultId: result.id,
      toolName: result.toolName,
      stream,
      truncated: start > 0,
      content: buffer.toString("utf8")
    });
  } finally {
    fs.closeSync(handle);
  }
}

function serveScreenshotImage({ response, store, params, url }) {
  const screenshot = store.getScreenshot(params.id);
  if (!screenshot) throw new HttpError(404, "Screenshot run not found");
  const imagePath = resolveScreenshotImage(screenshot, url.searchParams.get("path") || "");
  if (!imagePath) throw new HttpError(404, "Screenshot image not found");
  sendFile(response, imagePath, { "Cache-Control": "private, max-age=3600" });
}

// Raw artifact files must live under data/recon-runs (any run: follow-ups reference their source run's files).
function serveArtifactFile({ response, store, params, url }) {
  if (!store.getRun(params.id)) throw new HttpError(404, "Run not found");
  const requested = String(url.searchParams.get("path") || "");
  if (!requested) throw new HttpError(400, "path is required");
  const resolved = path.resolve(requested);
  if (!isInsidePath(resolved, RUN_ARTIFACTS_ROOT) || BLOCKED_ARTIFACT_PATTERN.test(resolved) || !isExistingFile(resolved)) {
    throw new HttpError(404, "Artifact file not found or outside the run artifact directory");
  }
  // Tool reports (HTML/SVG) are built from scanned-site content: sandbox them so they cannot run
  // script with this app's origin and session.
  sendFile(response, resolved, { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" });
}

function exportRun({ response, store, params, url }) {
  const snapshot = buildRunSnapshot(store, params.id);
  if (!snapshot) throw new HttpError(404, "Run not found");
  const rendered = renderRunExport(snapshot, params.format || url.searchParams.get("format") || "json");
  if (!rendered) throw new HttpError(400, "Unsupported export format. Use json, csv, or markdown.");
  sendDownload(response, rendered);
}

function exportDiagnostics({ response, store, params }) {
  const diagnostics = exportRunDiagnostics({ store, runId: params.id });
  if (!diagnostics) throw new HttpError(404, "Run not found");
  sendDownload(response, {
    contentType: "application/json; charset=utf-8",
    filename: diagnosticDownloadName(diagnostics.run),
    body: JSON.stringify(diagnostics, null, 2)
  });
}

module.exports = [
  { method: "GET", path: "/api/recon-tool-results/:id/log", handler: serveToolResultLog },
  { method: "GET", path: "/api/recon-screenshots/:id/image", handler: serveScreenshotImage },
  { method: "GET", path: "/api/recon-runs/:id/artifacts/file", handler: serveArtifactFile },
  { method: "GET", path: "/api/recon-runs/:id/export", handler: exportRun },
  { method: "GET", path: "/api/recon-runs/:id/export/:format", handler: exportRun },
  { method: "GET", path: "/api/recon-runs/:id/diagnostics", handler: exportDiagnostics }
];
