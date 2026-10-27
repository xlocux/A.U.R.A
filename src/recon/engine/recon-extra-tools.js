"use strict";

// Additional recon tools wired into the pipeline and runnable as focused follow-ups:
//   katana      — active crawler → URLs/endpoints
//   tlsx        — TLS/cert grab → SAN hostnames (new domains)
//   subzy       — subdomain-takeover checker → leads + events
//   waymore     — archived URL mining (wider than gau)
//   paramspider — parameterized URLs from web archives
//
// Every tool runs through runLinuxToolWithProxy, so when an upstream proxy is configured the
// uniform HTTP_PROXY/HTTPS_PROXY/ALL_PROXY exports applied by spawnLinuxTool route the tool.
// (tlsx opens raw TLS sockets and ignores the proxy, so runTlsxGrab is skipped when one is configured.)

const fs = require("node:fs");
const path = require("node:path");
const { normalizeDomain } = require("../domain-utils");
const { DEFAULT_TOOL_RECOVERY_ATTEMPTS } = require("./constants");
const { toToolPath } = require("./tool-args");
const { recordToolRun, runLinuxToolWithProxy, runToolWithRecovery, toolFailureDetail } = require("./tool-execution");

const MAX_CRAWL_TARGETS = 40;
const MAX_TLS_TARGETS = 300;
const MAX_TAKEOVER_TARGETS = 500;
const MAX_URL_DOMAINS = 10;

function writeLines(file, lines) {
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

function urlParts(url) {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, path: parsed.pathname, query: parsed.search.replace(/^\?/, ""), params: [...parsed.searchParams.keys()] };
  } catch {
    return { host: "", path: "", query: "", params: [] };
  }
}

// ── katana (active crawler) ───────────────────────────────────────────────────
function katanaArgs(inputPath) {
  return ["-list", toToolPath(inputPath), "-jsonl", "-silent", "-depth", "2", "-jc", "-concurrency", "10", "-rate-limit", "150", "-timeout", "10"];
}

function parseKatanaJsonl(stdout) {
  const urls = new Set();
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      const endpoint = obj.endpoint || obj.url || obj.request?.endpoint || obj.request?.url;
      if (endpoint && /^https?:\/\//i.test(endpoint)) { urls.add(endpoint); continue; }
    } catch { /* fall back to regex below */ }
    const match = raw.match(/https?:\/\/[^\s"']+/);
    if (match) urls.add(match[0]);
  }
  return [...urls];
}

async function runKatanaCrawl({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, services = [] }) {
  const liveUrls = [...new Set(services.map((service) => service.url).filter(Boolean))].slice(0, MAX_CRAWL_TARGETS);
  if (liveUrls.length === 0) {
    store.appendEvent(runId, { phase: "follow-up-crawl", severity: "info", source: "katana", message: "Crawl skipped: no live HTTP services." });
    return 0;
  }
  const inputPath = path.join(artifactsDir, "katana-input.txt");
  writeLines(inputPath, liveUrls);
  const args = katanaArgs(inputPath);
  const result = await runToolWithRecovery({
    store, runId, phase: "heartbeat", source: "katana",
    heartbeatMessage: (elapsed) => `katana is still crawling (${elapsed}s elapsed)`,
    maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "katana", args, timeoutMs: Math.max(timeoutMs, 120000), proxyUrl })
  });
  recordToolRun({ store, runId, artifactsDir, artifactName: "katana", toolName: "katana", args, linuxRuntime, result });
  const urls = parseKatanaJsonl(result.stdout);
  if (urls.length) {
    store.saveUrls(runId, targetName, urls.map((url) => ({ url, ...urlParts(url), metadata: { kind: "crawl", tool: "katana" } })), "katana");
  }
  store.appendEvent(runId, {
    phase: "follow-up-crawl",
    severity: result.status === "completed" ? "ok" : "warn",
    source: "katana",
    message: `katana ${result.status}; crawled ${urls.length} URLs${toolFailureDetail(result)}`
  });
  return urls.length;
}

// ── tlsx (TLS/cert SAN harvesting → new domains) ──────────────────────────────
function tlsxArgs(inputPath) {
  return ["-list", toToolPath(inputPath), "-json", "-silent", "-san", "-cn", "-timeout", "6", "-concurrency", "100"];
}

function parseTlsxDomains(stdout, rootDomains = []) {
  const roots = rootDomains.map((d) => String(d).toLowerCase());
  const found = new Set();
  const inScope = (host) => roots.length === 0 || roots.some((root) => host === root || host.endsWith(`.${root}`));
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    let names = [];
    try {
      const obj = JSON.parse(raw);
      if (Array.isArray(obj.subject_an)) names.push(...obj.subject_an);
      if (obj.subject_cn) names.push(obj.subject_cn);
    } catch { continue; }
    for (const name of names) {
      const host = normalizeDomain(String(name).replace(/^\*\./, "").toLowerCase());
      if (host && /\./.test(host) && !host.includes(" ") && inScope(host)) found.add(host);
    }
  }
  return [...found];
}

async function runTlsxGrab({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, hosts = [], rootDomains = [] }) {
  // tlsx opens raw TLS sockets and ignores HTTP_PROXY: behind a proxy it would connect directly, so skip it.
  if (proxyUrl || proxyController?.hasPool()) {
    store.appendEvent(runId, { phase: "follow-up-tls", severity: "warn", source: "tlsx", message: "tlsx skipped: it opens direct TLS connections and would bypass the configured proxy." });
    return 0;
  }
  const targets = [...new Set(hosts.map((h) => String(h).trim()).filter(Boolean))].slice(0, MAX_TLS_TARGETS);
  if (targets.length === 0) {
    store.appendEvent(runId, { phase: "follow-up-tls", severity: "info", source: "tlsx", message: "TLS grab skipped: no hosts to probe." });
    return 0;
  }
  const inputPath = path.join(artifactsDir, "tlsx-input.txt");
  writeLines(inputPath, targets);
  const args = tlsxArgs(inputPath);
  const result = await runToolWithRecovery({
    store, runId, phase: "heartbeat", source: "tlsx",
    heartbeatMessage: (elapsed) => `tlsx is still grabbing certificates (${elapsed}s elapsed)`,
    maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "tlsx", args, timeoutMs, proxyUrl })
  });
  recordToolRun({ store, runId, artifactsDir, artifactName: "tlsx", toolName: "tlsx", args, linuxRuntime, result });
  const domains = parseTlsxDomains(result.stdout, rootDomains);
  if (domains.length) {
    store.saveDomains(runId, targetName, domains.map((domain) => ({
      domain, rootDomain: rootDomains[0] || null, kind: "subdomain", source: "tlsx", metadata: { tool: "tlsx", via: "certificate-san" }
    })));
  }
  store.appendEvent(runId, {
    phase: "follow-up-tls",
    severity: result.status === "completed" ? "ok" : "warn",
    source: "tlsx",
    message: `tlsx ${result.status}; found ${domains.length} cert-derived hostnames${toolFailureDetail(result)}`
  });
  return domains.length;
}

// ── subzy (subdomain takeover) ────────────────────────────────────────────────
function subzyArgs(inputPath) {
  return ["run", "--targets", toToolPath(inputPath), "--hide_fails", "--vuln"];
}

function parseSubzyFindings(stdout) {
  const findings = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const raw = line.replace(/\x1b\[[0-9;]*m/g, "").trim(); // strip ANSI colour
    if (!raw || !/vulnerable/i.test(raw) || /not\s+vulnerable/i.test(raw)) continue;
    const url = (raw.match(/https?:\/\/[^\s"']+/) || [])[0];
    const service = (raw.match(/\[([^\]]+)\]\s*$/) || raw.match(/engine[:=]\s*([^\s]+)/i) || [])[1] || "";
    findings.push({ url: url || raw, service: service.trim() });
  }
  return findings;
}

async function runSubzyTakeover({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, hosts = [] }) {
  const targets = [...new Set(hosts.map((h) => String(h).trim()).filter(Boolean))].slice(0, MAX_TAKEOVER_TARGETS);
  if (targets.length === 0) {
    store.appendEvent(runId, { phase: "follow-up-takeover", severity: "info", source: "subzy", message: "Takeover check skipped: no hosts." });
    return 0;
  }
  const inputPath = path.join(artifactsDir, "subzy-input.txt");
  writeLines(inputPath, targets);
  const args = subzyArgs(inputPath);
  const result = await runToolWithRecovery({
    store, runId, phase: "heartbeat", source: "subzy",
    heartbeatMessage: (elapsed) => `subzy is still checking takeovers (${elapsed}s elapsed)`,
    maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
    task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: "subzy", args, timeoutMs, proxyUrl })
  });
  recordToolRun({ store, runId, artifactsDir, artifactName: "subzy", toolName: "subzy", args, linuxRuntime, result });
  const findings = parseSubzyFindings(result.stdout);
  if (findings.length && typeof store.saveAssetLeads === "function") {
    try {
      store.saveAssetLeads(runId, targetName, findings.map((finding) => ({
        leadType: "subdomain-takeover",
        value: finding.url,
        source: "subzy",
        confidence: 100,
        matchTerms: finding.service ? [finding.service] : [],
        status: "review",
        metadata: { rationale: `Potential subdomain takeover${finding.service ? ` (service: ${finding.service})` : ""}`, service: finding.service }
      })));
    } catch { /* leads are best-effort */ }
  }
  store.appendEvent(runId, {
    phase: "follow-up-takeover",
    severity: findings.length ? "warn" : (result.status === "completed" ? "ok" : "warn"),
    source: "subzy",
    message: `subzy ${result.status}; ${findings.length} potential takeover(s)${toolFailureDetail(result)}`
  });
  return findings.length;
}

// ── waymore / paramspider (archived URL + param mining) ───────────────────────
function parseUrlLines(text) {
  const urls = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.trim().match(/https?:\/\/[^\s"']+/);
    if (match) urls.add(match[0]);
  }
  return [...urls];
}

function readIfExists(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

async function runArchiveUrlTool({ store, runId, targetName, linuxRuntime, timeoutMs, artifactsDir, proxyController, proxyUrl, domains = [], tool }) {
  const roots = [...new Set(domains.map((d) => normalizeDomain(d)).filter(Boolean))].slice(0, MAX_URL_DOMAINS);
  if (roots.length === 0) {
    store.appendEvent(runId, { phase: "follow-up-params", severity: "info", source: tool, message: `${tool} skipped: no domains.` });
    return 0;
  }
  const allUrls = new Set();
  let lastResult = null;
  for (const domain of roots) {
    const outFile = path.join(artifactsDir, `${tool}-${domain}.txt`);
    const args = tool === "waymore"
      ? ["-i", domain, "-mode", "U", "-oU", toToolPath(outFile), "-f"]
      : ["-d", domain, "-o", toToolPath(outFile)];
    lastResult = await runToolWithRecovery({
      store, runId, phase: "heartbeat", source: tool,
      heartbeatMessage: (elapsed) => `${tool} is still mining ${domain} (${elapsed}s elapsed)`,
      maxAttempts: proxyController?.hasPool() ? 1 : DEFAULT_TOOL_RECOVERY_ATTEMPTS,
      task: () => runLinuxToolWithProxy({ proxyController, runtime: linuxRuntime, toolName: tool, args, timeoutMs: Math.max(timeoutMs, 180000), proxyUrl })
    });
    recordToolRun({ store, runId, artifactsDir, artifactName: `${tool}-${domain}`, toolName: tool, args, linuxRuntime, result: lastResult });
    for (const url of parseUrlLines(`${readIfExists(outFile)}\n${lastResult.stdout || ""}`)) allUrls.add(url);
  }
  const urls = [...allUrls];
  if (urls.length) {
    store.saveUrls(runId, targetName, urls.map((url) => ({ url, ...urlParts(url), metadata: { kind: "archive", tool } })), tool);
  }
  store.appendEvent(runId, {
    phase: "follow-up-params",
    severity: lastResult && lastResult.status === "completed" ? "ok" : "warn",
    source: tool,
    message: `${tool} finished; collected ${urls.length} archived URLs${lastResult ? toolFailureDetail(lastResult) : ""}`
  });
  return urls.length;
}

function runWaymore(options) { return runArchiveUrlTool({ ...options, tool: "waymore" }); }
function runParamSpider(options) { return runArchiveUrlTool({ ...options, tool: "paramspider" }); }

module.exports = {
  katanaArgs,
  parseKatanaJsonl,
  runKatanaCrawl,
  tlsxArgs,
  parseTlsxDomains,
  runTlsxGrab,
  subzyArgs,
  parseSubzyFindings,
  runSubzyTakeover,
  parseUrlLines,
  runWaymore,
  runParamSpider
};
