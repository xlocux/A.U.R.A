"use strict";

// Directory discovery (ffuf) and public cloud-resource enumeration (cloud_enum).
// Both derive their inputs from already-discovered recon data and parse structured output.

const fs = require("node:fs");
const path = require("node:path");
const { normalizeDomain } = require("../domain-utils");
const { DEFAULT_TOOL_RECOVERY_ATTEMPTS } = require("./constants");
const { waitForRunControl } = require("./run-control");
const { toToolPath } = require("./tool-args");
const { recordToolRun, runLinuxToolWithProxy, runToolWithRecovery, toolFailureDetail } = require("./tool-execution");

const MAX_FFUF_TARGETS = 25;

const FFUF_MATCH_CODES = "200,204,301,302,307,401,403,405";
const DEFAULT_CLOUD_KEYWORD_LIMIT = 12;
const RESERVED_LABELS = new Set(["www", "mail", "ftp", "smtp", "ns1", "ns2", "cpanel", "webmail", "autodiscover", "api", "app", "dev", "staging", "test", "cdn", "static", "assets"]);

// ── ffuf ────────────────────────────────────────────────────────────────────
function ffufArgsForUrl(baseUrl, wordlistPath, outputPath) {
  const base = String(baseUrl).replace(/\/+$/, "");
  return [
    "-u", `${base}/FUZZ`,
    "-w", toToolPath(wordlistPath),
    "-mc", FFUF_MATCH_CODES,
    "-t", "40",
    "-rate", "200",
    "-ac",
    "-of", "json",
    "-o", toToolPath(outputPath),
    "-s"
  ];
}

// ffuf -of json writes { "results": [ { url, status, length, input: { FUZZ } } ] }
function parseFfufJson(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const results = Array.isArray(data?.results) ? data.results : [];
  const out = [];
  for (const item of results) {
    const url = item.url || item.redirectlocation || "";
    if (!url) continue;
    let host = "";
    let path = "";
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      // keep url as-is
    }
    out.push({
      url,
      host,
      path,
      statusCode: item.status ?? null,
      contentLength: item.length ?? null,
      word: item.input?.FUZZ || item.input?.FFUFHASH || null
    });
  }
  return out;
}

// ── cloud_enum ────────────────────────────────────────────────────────────────
// Keywords: registrable brand labels from discovered domains, plus distinctive
// path/sub tokens seen in URLs (e.g. "acme-assets", "backups"). Deduplicated and bounded.
function deriveCloudKeywords({ domains = [], urls = [], extraKeywords = [], limit = DEFAULT_CLOUD_KEYWORD_LIMIT }) {
  const keywords = new Set();
  const add = (value) => {
    const token = String(value || "").toLowerCase().trim().replace(/[^a-z0-9-]/g, "");
    if (token.length >= 3 && token.length <= 63 && !RESERVED_LABELS.has(token)) keywords.add(token);
  };

  for (const entry of domains) {
    const domain = normalizeDomain(entry?.domain || entry);
    if (!domain) continue;
    const labels = domain.split(".");
    // registrable label (brand), e.g. acme.co.uk -> acme
    const brand = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    add(brand);
    // leftmost subdomain label when distinctive (e.g. internal, corp, backup)
    if (labels.length > 2) add(labels[0]);
  }
  for (const entry of urls) {
    const value = entry?.url || entry?.value || entry;
    try {
      const parsed = new URL(value);
      for (const segment of parsed.pathname.split("/")) {
        if (/^[a-z0-9][a-z0-9-]{2,30}$/i.test(segment) && !/\.(js|css|png|jpe?g|gif|svg|ico|woff2?|map)$/i.test(segment)) add(segment);
      }
    } catch {
      // ignore non-URL entries
    }
  }
  for (const keyword of extraKeywords) add(keyword);
  return [...keywords].slice(0, limit);
}

function cloudEnumArgs({ keywords, outputPath, quickScan = true, threads = 10, disable = [] }) {
  const args = [];
  for (const keyword of keywords) args.push("-k", keyword);
  args.push("-l", toToolPath(outputPath), "-f", "json", "-t", String(threads));
  if (quickScan) args.push("-qs");
  for (const provider of disable) {
    if (provider === "aws") args.push("--disable-aws");
    if (provider === "azure") args.push("--disable-azure");
    if (provider === "gcp") args.push("--disable-gcp");
  }
  return args;
}

// cloud_enum JSON log is newline-delimited JSON objects (one per found resource).
function parseCloudEnumJson(content) {
  const findings = [];
  const seen = new Set();
  const pushFinding = (item) => {
    if (!item || typeof item !== "object") return;
    const target = item.target || item.url || item.name || item.bucket || "";
    if (!target) return;
    const platform = String(item.platform || item.provider || inferPlatform(target) || "cloud").toLowerCase();
    const access = item.access || item.msg || item.status || null;
    const key = `${platform}|${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ platform, target, access: access ? String(access) : null });
  };

  const text = String(content || "").trim();
  if (!text) return findings;
  // Try a single JSON document first (array or object with results), then NDJSON.
  try {
    const whole = JSON.parse(text);
    const list = Array.isArray(whole) ? whole : Array.isArray(whole.results) ? whole.results : whole.findings;
    if (Array.isArray(list)) {
      list.forEach(pushFinding);
      return findings;
    }
    if (whole && typeof whole === "object") {
      pushFinding(whole);
      return findings;
    }
  } catch {
    // fall through to NDJSON
  }
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    try {
      pushFinding(JSON.parse(raw));
    } catch {
      // skip non-JSON log lines
    }
  }
  return findings;
}

function inferPlatform(target) {
  const value = String(target).toLowerCase();
  if (value.includes("amazonaws.com") || value.includes("s3")) return "aws";
  if (value.includes("blob.core.windows.net") || value.includes("azurewebsites") || value.includes("azure")) return "azure";
  if (value.includes("storage.googleapis.com") || value.includes("appspot.com") || value.includes("googleapis")) return "gcp";
  return null;
}

// ── Phase runners ─────────────────────────────────────────────────────────────
// ffuf per live service against the active paths wordlist; discovered paths are saved as URLs.
async function runDirectoryDiscovery({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, services = [], wordlistPath }) {
  if (!wordlistPath) {
    store.appendEvent(runId, { phase: "follow-up-dirs", severity: "warn", source: "ffuf", message: "Directory discovery skipped: no active 'paths' wordlist is configured (Wordlists tab)." });
    return 0;
  }
  const targets = [...new Set(services.map((service) => service.url).filter(Boolean))].slice(0, MAX_FFUF_TARGETS);
  if (targets.length === 0) {
    store.appendEvent(runId, { phase: "follow-up-dirs", severity: "warn", source: "ffuf", message: "Directory discovery skipped: no live HTTP services to probe." });
    return 0;
  }
  let total = 0;
  for (let index = 0; index < targets.length; index += 1) {
    await waitForRunControl(store, runId);
    const url = targets[index];
    const outputPath = path.join(artifactsDir, `ffuf-${index}.json`);
    const args = ffufArgsForUrl(url, wordlistPath, outputPath);
    const result = await runToolWithRecovery({
      store,
      runId,
      phase: "heartbeat",
      source: "ffuf",
      heartbeatMessage: (elapsed) => `ffuf is still fuzzing ${url} (${elapsed}s elapsed)`,
      maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
      task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "ffuf", args, timeoutMs, proxyUrl })
    });
    recordToolRun({ store, runId, artifactsDir, artifactName: `ffuf-${index}`, toolName: "ffuf", args, linuxRuntime, result });
    const hits = fs.existsSync(outputPath) ? parseFfufJson(fs.readFileSync(outputPath, "utf8")) : [];
    if (hits.length) {
      store.saveUrls(runId, targetName, hits.map((hit) => ({
        url: hit.url,
        host: hit.host,
        path: hit.path,
        query: "",
        params: [],
        metadata: { statusCode: hit.statusCode, contentLength: hit.contentLength, word: hit.word, tool: "ffuf" }
      })), "ffuf");
      total += hits.length;
    }
    store.appendEvent(runId, {
      phase: "follow-up-dirs",
      severity: result.status === "completed" ? "ok" : "warn",
      source: "ffuf",
      message: `ffuf ${result.status} on ${url}: ${hits.length} paths found${toolFailureDetail(result)}`
    });
  }
  store.appendEvent(runId, { phase: "follow-up-dirs", severity: "ok", source: "engine", message: `Directory discovery completed: ${total} paths across ${targets.length} services.` });
  return total;
}

// cloud_enum with keywords derived from discovered domains/URLs; findings saved as cloud_resource leads.
async function runCloudEnum({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, domains = [], urls = [], extraKeywords = [] }) {
  const keywords = deriveCloudKeywords({ domains, urls, extraKeywords });
  if (keywords.length === 0) {
    store.appendEvent(runId, { phase: "follow-up-cloud", severity: "warn", source: "cloud_enum", message: "Cloud enumeration skipped: no usable keywords derived from domains/URLs." });
    return 0;
  }
  const outputPath = path.join(artifactsDir, "cloud-enum.json");
  try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
  const args = cloudEnumArgs({ keywords, outputPath });
  store.appendEvent(runId, { phase: "follow-up-cloud", severity: "ok", source: "cloud_enum", message: `Cloud enumeration started with keywords: ${keywords.join(", ")}` });
  const result = await runToolWithRecovery({
    store,
    runId,
    phase: "heartbeat",
    source: "cloud_enum",
    heartbeatMessage: (elapsed) => `cloud_enum is still probing public cloud namespaces (${elapsed}s elapsed)`,
    maxAttempts: 1,
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "cloud_enum", args, timeoutMs: Math.max(timeoutMs, 240000), proxyUrl })
  });
  recordToolRun({ store, runId, artifactsDir, artifactName: "cloud-enum", toolName: "cloud_enum", args, linuxRuntime, result });
  const findings = fs.existsSync(outputPath) ? parseCloudEnumJson(fs.readFileSync(outputPath, "utf8")) : [];
  if (findings.length) {
    store.saveAssetLeads(runId, targetName, findings.map((finding) => ({
      leadType: "cloud_resource",
      value: finding.target,
      source: `cloud_enum:${finding.platform}`,
      confidence: "candidate",
      matchTerms: keywords,
      metadata: { platform: finding.platform, access: finding.access, reason: "Public cloud resource discovered by cloud_enum. Review ownership before acting." }
    })));
  }
  store.appendEvent(runId, {
    phase: "follow-up-cloud",
    severity: findings.length ? "ok" : result.status === "completed" ? "ok" : "warn",
    source: "cloud_enum",
    message: `Cloud enumeration ${result.status}: ${findings.length} public resources found${toolFailureDetail(result)}`
  });
  return findings.length;
}

module.exports = {
  FFUF_MATCH_CODES,
  cloudEnumArgs,
  deriveCloudKeywords,
  ffufArgsForUrl,
  parseCloudEnumJson,
  parseFfufJson,
  runCloudEnum,
  runDirectoryDiscovery
};
