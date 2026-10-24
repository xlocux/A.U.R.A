"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { extractTrackersFromServices } = require("../tracker-extraction");
const { extractFaviconsFromServices } = require("../web-fingerprints");
const { DEFAULT_TOOL_RECOVERY_ATTEMPTS, SUPPORTED_SCREENSHOT_TOOLS } = require("./constants");
const { waitForRunControl } = require("./run-control");
const { screenshotArgsForTool, writeInputFile } = require("./tool-args");
const { recordToolRun, runLinuxToolWithProxy, runToolWithRecovery, toolFailureDetail, writeToolArtifact } = require("./tool-execution");

const IMAGE_PATTERN = /\.(png|jpe?g|webp)$/i;
const MAX_FETCH_TIMEOUT_MS = 15000;

function countScreenshotFiles(outputDir) {
  if (!fs.existsSync(outputDir)) return 0;
  return fs.readdirSync(outputDir, { recursive: true }).filter((entry) => IMAGE_PATTERN.test(String(entry))).length;
}

function findScreenshotReport(outputDir) {
  const candidates = ["gowitness.sqlite3", "report.html"].map((name) => path.join(outputDir, name));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// These collectors use Node fetch, which does not go through the tool proxy. With a proxy
// configured they are skipped so the operator's real address never reaches the targets.
function skipBecauseProxied(store, runId, phase, label, proxyUrl) {
  if (!proxyUrl) return false;
  store.appendEvent(runId, { phase, severity: "warn", source: phase, message: `${label} skipped: it fetches pages directly and would bypass the configured proxy.` });
  return true;
}

function uniqueLiveServices(services) {
  return [...new Map((services || []).filter((service) => service?.url).map((service) => [String(service.url).toLowerCase(), service])).values()];
}

async function collectScreenshots({ store, runId, targetName, screenshotTools, linuxRuntime, useLinuxRunner, timeoutMs, artifactsDir, context, queueRecovery, proxyUrl = null, proxyController = null }) {
  if (!useLinuxRunner || !screenshotTools?.length || context.httpServices.length === 0) return;
  const liveUrls = [...new Set(context.httpServices.map((service) => service.url).filter(Boolean))];
  const inputPath = writeInputFile(artifactsDir, "screenshots.input.txt", liveUrls);

  for (const toolName of screenshotTools) {
    if (!SUPPORTED_SCREENSHOT_TOOLS.has(toolName)) continue;
    await waitForRunControl(store, runId);
    const outputDir = path.join(artifactsDir, "screenshots", toolName);
    fs.mkdirSync(outputDir, { recursive: true });
    const args = screenshotArgsForTool(toolName, inputPath, outputDir);
    store.appendEvent(runId, { phase: "recon", source: toolName, message: `Capturing screenshots for ${liveUrls.length} live URLs` });
    const result = await runToolWithRecovery({
      store,
      runId,
      phase: "heartbeat",
      source: toolName,
      heartbeatMessage: (elapsed) => `${toolName} screenshot capture is still running (${elapsed}s elapsed)`,
      maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
      task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName, args, timeoutMs, proxyUrl })
    });
    recordToolRun({ store, runId, artifactsDir, artifactName: `${toolName}-screenshots`, toolName, args, linuxRuntime, result });
    const screenshotCount = countScreenshotFiles(outputDir);
    store.saveScreenshotRun(runId, targetName, {
      toolName,
      outputDir,
      reportPath: findScreenshotReport(outputDir),
      metadata: { status: result.status, exitCode: result.exitCode, urlCount: liveUrls.length, screenshotCount, proxyRotation: result.proxyRotation || null }
    });
    store.appendEvent(runId, {
      phase: "recon",
      severity: result.status === "completed" && screenshotCount ? "ok" : "warn",
      source: toolName,
      message: `${toolName} screenshot run ${result.status}; ${screenshotCount} images captured`
    });
    queueRecovery?.(context, {
      id: `retry-screenshot-tool-${toolName}`,
      phase: "screenshot-tool",
      toolName,
      reason: `${toolName} screenshot run ${result.status}${toolFailureDetail(result)}`,
      status: result.status,
      screenshotCount
    }, result);
  }
}

async function collectTrackers({ store, runId, targetName, services, timeoutMs, artifactsDir, proxyUrl = null }) {
  if (skipBecauseProxied(store, runId, "tracker-extraction", "Analytics/pixel extraction", proxyUrl)) return { findingCount: 0, checkedCount: 0, skipped: true };
  const liveServices = uniqueLiveServices(services);
  if (liveServices.length === 0) {
    store.appendEvent(runId, { phase: "tracker-extraction", severity: "info", source: "tracker-extraction", message: "Analytics/pixel extraction skipped because no live HTTP services are available." });
    return { findingCount: 0, checkedCount: 0 };
  }
  store.appendEvent(runId, { phase: "tracker-extraction", severity: "info", source: "tracker-extraction", message: `Checking ${liveServices.length} live services for analytics and pixel IDs.` });
  const findings = await extractTrackersFromServices({ services: liveServices, timeoutMs: Math.min(Number(timeoutMs || 12000), MAX_FETCH_TIMEOUT_MS) });
  const artifactPath = writeToolArtifact(artifactsDir, "tracker-findings.json", JSON.stringify({ targetName, checked: liveServices.length, findings }, null, 2));
  const successful = findings.filter((finding) => finding.vendor !== "tracker-fetch");
  store.appendEvent(runId, {
    phase: "tracker-extraction",
    severity: successful.length ? "ok" : "warn",
    source: "tracker-extraction",
    message: `Analytics/pixel extraction completed with ${successful.length} findings across ${liveServices.length} services.`,
    payload: { artifactPath, findingCount: successful.length, checkedCount: liveServices.length }
  });
  if (successful.length) {
    store.saveUrls(runId, targetName, successful.map((finding) => ({
      url: finding.url,
      host: finding.host,
      path: "",
      query: "",
      params: [],
      metadata: { trackerVendor: finding.vendor, trackerId: finding.id }
    })), "tracker-extraction");
  }
  return { findingCount: successful.length, checkedCount: liveServices.length };
}

async function collectFavicons({ store, runId, targetName, services, timeoutMs, artifactsDir, proxyUrl = null }) {
  if (skipBecauseProxied(store, runId, "favicon-fingerprint", "Favicon fingerprinting", proxyUrl)) return { findingCount: 0, checkedCount: 0, skipped: true };
  const liveServices = uniqueLiveServices(services);
  if (liveServices.length === 0) {
    store.appendEvent(runId, { phase: "favicon-fingerprint", severity: "info", source: "favicon-fingerprint", message: "Favicon fingerprinting skipped because no live HTTP services are available." });
    return { findingCount: 0, checkedCount: 0 };
  }
  store.appendEvent(runId, { phase: "favicon-fingerprint", severity: "info", source: "favicon-fingerprint", message: `Checking ${liveServices.length} live services for favicons.` });
  const findings = await extractFaviconsFromServices({ services: liveServices, timeoutMs: Math.min(Number(timeoutMs || 12000), MAX_FETCH_TIMEOUT_MS) });
  const artifactPath = writeToolArtifact(artifactsDir, "favicon-findings.json", JSON.stringify({ targetName, checked: liveServices.length, findings }, null, 2));
  store.appendEvent(runId, {
    phase: "favicon-fingerprint",
    severity: findings.length ? "ok" : "warn",
    source: "favicon-fingerprint",
    message: `Favicon fingerprinting completed with ${findings.length} hashes across ${liveServices.length} services.`,
    payload: { artifactPath, findingCount: findings.length, checkedCount: liveServices.length }
  });
  if (findings.length) {
    store.saveUrls(runId, targetName, findings.map((finding) => ({
      url: finding.faviconUrl,
      host: finding.host,
      path: "",
      query: "",
      params: [],
      metadata: { faviconSha256: finding.sha256, byteLength: finding.byteLength, contentType: finding.contentType, pageUrl: finding.url }
    })), "favicon-fingerprint");
  }
  return { findingCount: findings.length, checkedCount: liveServices.length };
}

module.exports = {
  collectFavicons,
  collectScreenshots,
  collectTrackers,
  countScreenshotFiles
};
