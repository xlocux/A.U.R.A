"use strict";

// End-of-recon vulnerability assessment: optional nuclei template scan of live HTTP services, plus
// on-demand NVD CVE correlation of detected product:version pairs. Both halves are best-effort: a
// single tool or network failure logs a warning and the run continues. Findings are stored as
// asset_leads with leadType "vulnerability" so no schema change is needed.

const fs = require("node:fs");
const path = require("node:path");
const { waitForRunControl } = require("./run-control");
const { toToolPath } = require("./tool-args");
const { recordToolRun, runLinuxToolWithProxy, runToolWithRecovery, toolFailureDetail } = require("./tool-execution");
const nvdClient = require("../../web/services/nvd-client");

const PHASE = "follow-up-vuln";
const MAX_NUCLEI_TARGETS = 50;
// Stay polite with the public NVD API: cap the number of distinct lookups per run.
const MAX_CVE_PAIRS = 25;
// Matches a semver-ish version token (at least two dotted numeric components).
const VERSION_TOKEN = /(\d+\.\d+(?:\.\d+){0,3})/;

function nucleiArgs(inputPath) {
  return ["-l", toToolPath(inputPath), "-jsonl", "-silent", "-severity", "low,medium,high,critical", "-rate-limit", "50"];
}

// nuclei -jsonl prints one finding object per line. Keys are hyphenated (template-id, matched-at).
function parseNucleiJsonl(stdout) {
  const findings = [];
  const seen = new Set();
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    let item;
    try {
      item = JSON.parse(raw);
    } catch {
      continue; // skip progress/log lines that are not JSON
    }
    const templateId = item["template-id"] || item.templateID || item.templateId || "";
    const info = item.info || {};
    const matchedAt = item["matched-at"] || item.matched_at || item.matchedAt || item.host || item.url || "";
    if (!templateId && !matchedAt) continue;
    const key = `${templateId}|${matchedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      templateId: templateId || "unknown",
      name: info.name || templateId || "nuclei finding",
      severity: String(info.severity || "unknown").toLowerCase(),
      matchedAt,
      description: info.description ? String(info.description).trim() : null,
      reference: normalizeReference(info.reference)
    });
  }
  return findings;
}

function normalizeReference(reference) {
  if (Array.isArray(reference)) return reference.filter(Boolean);
  if (typeof reference === "string" && reference.trim()) return [reference.trim()];
  return [];
}

// Splits a tech string like "nginx/1.18.0", "WordPress:5.8" or "jQuery 3.4.1" into {product, version}.
function parseTechToken(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const match = text.match(VERSION_TOKEN);
  if (!match) return null;
  const version = match[1];
  const product = text.slice(0, match.index).replace(/[\s:/@_()[\]-]+$/, "").replace(/[()[\]]/g, "").trim();
  if (!product) return null;
  return { product, version };
}

// Collects unique {product, version} pairs from the technology list and live-service tech strings.
// `technologies` items may be objects ({name, version}) or raw strings; service tech comes from
// service.tech / service.technologies arrays of strings.
function extractProductVersions({ technologies = [], services = [] } = {}) {
  const pairs = [];
  const seen = new Set();
  const add = (product, version) => {
    const cleanProduct = String(product || "").trim();
    const cleanVersion = String(version || "").trim();
    if (!cleanProduct || !cleanVersion || !VERSION_TOKEN.test(cleanVersion)) return;
    const key = `${cleanProduct.toLowerCase()}@${cleanVersion}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ product: cleanProduct, version: cleanVersion });
  };

  for (const tech of technologies) {
    if (tech && typeof tech === "object") {
      if (tech.version) add(tech.name || tech.product, tech.version);
      else {
        const parsed = parseTechToken(tech.name || tech.product);
        if (parsed) add(parsed.product, parsed.version);
      }
    } else {
      const parsed = parseTechToken(tech);
      if (parsed) add(parsed.product, parsed.version);
    }
  }

  for (const service of services) {
    const strings = [
      ...(Array.isArray(service?.tech) ? service.tech : []),
      ...(Array.isArray(service?.technologies) ? service.technologies : []),
      service?.webserver
    ].filter(Boolean);
    for (const value of strings) {
      const parsed = parseTechToken(value);
      if (parsed) add(parsed.product, parsed.version);
    }
  }

  return pairs.slice(0, MAX_CVE_PAIRS);
}

// ── nuclei template scan ──────────────────────────────────────────────────────
async function runNucleiScan({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, services }) {
  const targets = [...new Set(services.map((service) => service.url).filter(Boolean))].slice(0, MAX_NUCLEI_TARGETS);
  if (targets.length === 0) {
    store.appendEvent(runId, { phase: PHASE, severity: "info", source: "nuclei", message: "nuclei template scan skipped: no live HTTP services to scan." });
    return 0;
  }
  const inputPath = path.join(artifactsDir, "nuclei-input.txt");
  fs.writeFileSync(inputPath, `${targets.join("\n")}\n`, "utf8");
  const args = nucleiArgs(inputPath);
  const result = await runToolWithRecovery({
    store,
    runId,
    phase: "heartbeat",
    source: "nuclei",
    heartbeatMessage: (elapsed) => `nuclei is still scanning ${targets.length} services (${elapsed}s elapsed)`,
    maxAttempts: 1,
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "nuclei", args, timeoutMs: Math.max(timeoutMs, 300000), proxyUrl })
  });
  recordToolRun({ store, runId, artifactsDir, artifactName: "nuclei", toolName: "nuclei", args, linuxRuntime, result });
  const findings = parseNucleiJsonl(result.stdout);
  if (findings.length) {
    store.saveAssetLeads(runId, targetName, findings.map((finding) => ({
      leadType: "vulnerability",
      value: `${finding.severity}: ${finding.name} @ ${finding.matchedAt}`,
      source: `nuclei:${finding.templateId}`,
      confidence: "candidate",
      metadata: {
        severity: finding.severity,
        templateId: finding.templateId,
        matchedAt: finding.matchedAt,
        reference: finding.reference,
        description: finding.description,
        engine: "nuclei"
      }
    })));
  }
  store.appendEvent(runId, {
    phase: PHASE,
    severity: findings.length ? "warn" : result.status === "completed" ? "ok" : "warn",
    source: "nuclei",
    message: `nuclei ${result.status}: ${findings.length} template finding(s) across ${targets.length} services${toolFailureDetail(result)}`
  });
  return findings.length;
}

// ── NVD CVE correlation ───────────────────────────────────────────────────────
async function runCveCorrelation({ store, runId, targetName, technologies, services, nvdApiKey }) {
  const pairs = extractProductVersions({ technologies, services });
  if (pairs.length === 0) {
    store.appendEvent(runId, { phase: PHASE, severity: "info", source: "nvd", message: "CVE correlation skipped: no product:version pairs detected." });
    return 0;
  }
  store.appendEvent(runId, { phase: PHASE, severity: "ok", source: "nvd", message: `CVE correlation started for ${pairs.length} product:version pair(s).` });
  let total = 0;
  for (const { product, version } of pairs) {
    await waitForRunControl(store, runId);
    let cves = [];
    try {
      cves = await nvdClient.lookupCves({ product, version, apiKey: nvdApiKey });
    } catch (error) {
      // lookupCves is designed never to throw, but stay defensive so one pair cannot abort the loop.
      store.appendEvent(runId, { phase: PHASE, severity: "warn", source: "nvd", message: `NVD lookup failed for ${product} ${version}: ${error.message}` });
      continue;
    }
    if (!cves.length) continue;
    store.saveAssetLeads(runId, targetName, cves.map((cve) => ({
      leadType: "vulnerability",
      value: `${cve.id} — ${product} ${version}`,
      source: `nvd:${product}`,
      confidence: "candidate",
      metadata: {
        cve: cve.id,
        cvss: cve.cvss,
        severity: cve.severity,
        product,
        version,
        url: cve.url,
        summary: cve.summary,
        engine: "nvd"
      }
    })));
    total += cves.length;
  }
  store.appendEvent(runId, {
    phase: PHASE,
    severity: total ? "warn" : "ok",
    source: "nvd",
    message: `CVE correlation completed: ${total} CVE(s) across ${pairs.length} product:version pair(s).`
  });
  return total;
}

// Orchestrates the end-of-recon vulnerability assessment. Always best-effort: failures are logged
// as warnings and never thrown. Returns { nucleiFindings, cveFindings } counts.
async function runVulnAssessment({
  store,
  runId,
  targetName,
  linuxRuntime,
  timeoutMs,
  artifactsDir,
  proxyController,
  proxyUrl,
  services = [],
  technologies = [],
  runNuclei = false,
  nvdApiKey = null
}) {
  const counts = { nucleiFindings: 0, cveFindings: 0 };

  if (runNuclei) {
    try {
      counts.nucleiFindings = await runNucleiScan({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, services });
    } catch (error) {
      store.appendEvent(runId, { phase: PHASE, severity: "warn", source: "nuclei", message: `nuclei template scan skipped after an error: ${error.message}` });
    }
  } else {
    store.appendEvent(runId, { phase: PHASE, severity: "info", source: "nuclei", message: "nuclei template scan not enabled for this run." });
  }

  try {
    counts.cveFindings = await runCveCorrelation({ store, runId, targetName, technologies, services, nvdApiKey });
  } catch (error) {
    store.appendEvent(runId, { phase: PHASE, severity: "warn", source: "nvd", message: `CVE correlation skipped after an error: ${error.message}` });
  }

  store.appendEvent(runId, {
    phase: PHASE,
    severity: "ok",
    source: "engine",
    message: `Vulnerability assessment completed: ${counts.nucleiFindings} nuclei finding(s), ${counts.cveFindings} CVE(s).`
  });
  return counts;
}

module.exports = {
  extractProductVersions,
  nucleiArgs,
  parseNucleiJsonl,
  parseTechToken,
  runVulnAssessment
};
