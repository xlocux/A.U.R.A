"use strict";

// Directory discovery (ffuf) and public cloud-resource enumeration (cloud_enum).
// Both derive their inputs from already-discovered recon data and parse structured output.

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { normalizeDomain } = require("../domain-utils");
const { DEFAULT_TOOL_RECOVERY_ATTEMPTS } = require("./constants");
const { waitForRunControl } = require("./run-control");
const { toToolPath } = require("./tool-args");
const { recordToolRun, runLinuxToolWithProxy, runToolWithRecovery, toolFailureDetail } = require("./tool-execution");

const MAX_FFUF_TARGETS = 25;
const MAX_BYPASS_TARGETS = 20;
// Status codes worth attempting a 403/401 bypass against.
const BYPASS_TARGET_CODES = new Set([401, 403, 405]);
// A bypass is interesting when the tool reached a non-forbidden, successful-ish response.
const BYPASS_SUCCESS_CODES = new Set([200, 201, 202, 203, 204, 206, 301, 302, 307, 308]);

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

// ── gobypass403 (403/401 access-control bypass) ───────────────────────────────
function bypass403Args(url, outDir) {
  return ["-u", String(url), "-o", toToolPath(outDir), "-dpb", "-T", "20000"];
}

// gobypass403 writes results to a SQLite DB under its output dir (no JSON). Read scan_results and
// keep rows whose status code indicates the forbidden resource became reachable.
function parseBypass403Db(outDir) {
  const findings = [];
  let dbFile = null;
  try {
    const stack = [outDir];
    while (stack.length && !dbFile) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/\.(db|sqlite3?)$/i.test(entry.name)) { dbFile = full; break; }
      }
    }
  } catch {
    return findings;
  }
  if (!dbFile) return findings;
  let db;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
  } catch {
    try { db = new DatabaseSync(dbFile); } catch { return findings; }
  }
  try {
    const rows = db.prepare("SELECT * FROM scan_results").all();
    const seen = new Set();
    for (const row of rows) {
      const status = Number(row.status_code ?? row.status ?? 0);
      if (!BYPASS_SUCCESS_CODES.has(status)) continue;
      const target = row.url || row.target || extractUrlFromCurl(row.curl_cmd) || "";
      const module = row.bypass_module || row.module || "bypass";
      const key = `${module}|${target}|${status}`;
      if (!target || seen.has(key)) continue;
      seen.add(key);
      findings.push({ target, status, module, curl: row.curl_cmd || null, contentLength: row.content_length ?? null });
    }
  } catch {
    // table/schema not as expected; return what we have
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
  return findings;
}

function extractUrlFromCurl(curl) {
  const match = String(curl || "").match(/https?:\/\/[^\s"']+/);
  return match ? match[0] : "";
}

// Runs gobypass403 against services that returned 401/403/405.
async function runBypass403({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, services = [] }) {
  const targets = [...new Set(services.filter((service) => BYPASS_TARGET_CODES.has(Number(service.statusCode ?? service.status_code)))
    .map((service) => service.url).filter(Boolean))].slice(0, MAX_BYPASS_TARGETS);
  if (targets.length === 0) {
    store.appendEvent(runId, { phase: "follow-up-bypass403", severity: "info", source: "gobypass403", message: "403 bypass skipped: no 401/403/405 services to test." });
    return 0;
  }
  let total = 0;
  for (let index = 0; index < targets.length; index += 1) {
    await waitForRunControl(store, runId);
    const url = targets[index];
    const outDir = path.join(artifactsDir, `gobypass403-${index}`);
    fs.mkdirSync(outDir, { recursive: true });
    const args = bypass403Args(url, outDir);
    const result = await runToolWithRecovery({
      store,
      runId,
      phase: "heartbeat",
      source: "gobypass403",
      heartbeatMessage: (elapsed) => `gobypass403 is still testing ${url} (${elapsed}s elapsed)`,
      maxAttempts: 1,
      task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "gobypass403", args, timeoutMs: Math.max(timeoutMs, 60000), proxyUrl })
    });
    recordToolRun({ store, runId, artifactsDir, artifactName: `gobypass403-${index}`, toolName: "gobypass403", args, linuxRuntime, result });
    const hits = parseBypass403Db(outDir);
    if (hits.length) {
      store.saveAssetLeads(runId, targetName, hits.map((hit) => ({
        leadType: "access_bypass",
        value: hit.target,
        source: `gobypass403:${hit.module}`,
        confidence: "candidate",
        metadata: { statusCode: hit.status, module: hit.module, curl: hit.curl, originalUrl: url, reason: "403/401 access control bypassed. Verify manually before relying on it." }
      })));
      total += hits.length;
    }
    store.appendEvent(runId, {
      phase: "follow-up-bypass403",
      severity: hits.length ? "warn" : result.status === "completed" ? "ok" : "warn",
      source: "gobypass403",
      message: `gobypass403 ${result.status} on ${url}: ${hits.length} bypass(es) found${toolFailureDetail(result)}`
    });
  }
  store.appendEvent(runId, { phase: "follow-up-bypass403", severity: total ? "warn" : "ok", source: "engine", message: `403 bypass completed: ${total} bypass(es) across ${targets.length} forbidden endpoints.` });
  return total;
}

// ── getJS (JavaScript file discovery) ─────────────────────────────────────────
function getjsArgs(inputPath) {
  return ["-input", toToolPath(inputPath), "-complete", "-threads", "5"];
}

function parseJsUrls(stdout) {
  const urls = new Set();
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const raw = line.trim();
    const match = raw.match(/https?:\/\/[^\s"']+/);
    if (match) urls.add(match[0]);
  }
  return [...urls];
}

// Extracts JavaScript URLs referenced by live services; saved as URLs (source getjs) which also
// feed retire.js technology detection.
async function runJsDiscovery({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, services = [] }) {
  const liveUrls = [...new Set(services.map((service) => service.url).filter(Boolean))];
  if (liveUrls.length === 0) {
    store.appendEvent(runId, { phase: "follow-up-js", severity: "info", source: "getjs", message: "JavaScript discovery skipped: no live HTTP services." });
    return 0;
  }
  const inputPath = path.join(artifactsDir, "getjs-input.txt");
  fs.writeFileSync(inputPath, `${liveUrls.join("\n")}\n`, "utf8");
  const args = getjsArgs(inputPath);
  const result = await runToolWithRecovery({
    store,
    runId,
    phase: "heartbeat",
    source: "getjs",
    heartbeatMessage: (elapsed) => `getJS is still extracting script URLs (${elapsed}s elapsed)`,
    maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "getJS", args, timeoutMs, proxyUrl })
  });
  recordToolRun({ store, runId, artifactsDir, artifactName: "getjs", toolName: "getJS", args, linuxRuntime, result });
  const jsUrls = parseJsUrls(result.stdout);
  if (jsUrls.length) {
    store.saveUrls(runId, targetName, jsUrls.map((url) => {
      let host = "";
      let urlPath = "";
      try { const parsed = new URL(url); host = parsed.hostname; urlPath = parsed.pathname; } catch { /* keep */ }
      return { url, host, path: urlPath, query: "", params: [], metadata: { kind: "javascript", tool: "getjs" } };
    }), "getjs");
  }
  store.appendEvent(runId, {
    phase: "follow-up-js",
    severity: result.status === "completed" ? "ok" : "warn",
    source: "getjs",
    message: `getJS ${result.status}; found ${jsUrls.length} JavaScript URLs${toolFailureDetail(result)}`
  });
  return jsUrls.length;
}

module.exports = {
  FFUF_MATCH_CODES,
  bypass403Args,
  cloudEnumArgs,
  deriveCloudKeywords,
  ffufArgsForUrl,
  getjsArgs,
  parseBypass403Db,
  parseCloudEnumJson,
  parseFfufJson,
  parseJsUrls,
  runBypass403,
  runCloudEnum,
  runDirectoryDiscovery,
  runJsDiscovery
};
