"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { commandDisplay, runLinuxTool } = require("./linux-tools");
const { toToolPath } = require("./engine/tool-args");
const { buildProxyAwareInvocation } = require("./tool-proxy-policy");
const { MAX_HTML_SCAN_CHARS, MAX_PAGE_BYTES, fetchBoundedText } = require("./bounded-fetch");

const MAX_DETECTOR_URLS = 50;
const DEFAULT_DETECTOR_ATTEMPTS = 2;
const DETECTOR_RECOVERY_PATTERNS = [
  /timed?\s*out|timeout/i,
  /econn(refused|reset|aborted)/i,
  /etimedout/i,
  /connection\s*(refused|reset|closed|aborted)/i,
  /network\s*(is\s*)?unreachable/i,
  /tls\s*handshake/i,
  /context\s*deadline\s*exceeded/i,
  /temporary\s*failure/i
];

async function runTechnologyEnrichment({
  store,
  runId,
  targetName,
  linuxRuntime = "linux",
  useLinuxRunner = true,
  timeoutMs = 180000,
  artifactsDir,
  context,
  waitForRunControl = async () => {},
  proxyUrl = null
}) {
  const services = dedupeServices(context?.httpServices || []);
  if (services.length === 0) return;

  store.appendEvent(runId, {
    phase: "technology-enrichment",
    severity: "ok",
    source: "engine",
    message: `Technology enrichment queued for ${services.length} live services`
  });

  await enrichWithBuiltWith({ store, runId, targetName, services, artifactsDir });

  if (!useLinuxRunner) {
    store.appendEvent(runId, {
      phase: "technology-enrichment",
      severity: "warn",
      source: "engine",
      message: "Local detector CLIs skipped because the Linux tool runner is disabled"
    });
    return;
  }

  const sampled = services.slice(0, MAX_DETECTOR_URLS);
  if (services.length > sampled.length) {
    store.appendEvent(runId, {
      phase: "technology-enrichment",
      severity: "warn",
      source: "engine",
      message: `Detector CLI pass limited to ${sampled.length} services to keep this run responsive`
    });
  }

  for (const service of sampled) {
    await waitForRunControl(store, runId);
    await runRetireOnService({ store, runId, targetName, service, linuxRuntime, timeoutMs, artifactsDir, proxyUrl, rootDomains: context?.rootDomains || [] });
    await waitForRunControl(store, runId);
    await runCmsDetector({ store, runId, targetName, service, linuxRuntime, timeoutMs, artifactsDir, proxyUrl });
  }
}

async function runRetireOnService({ store, runId, targetName, service, linuxRuntime, timeoutMs, artifactsDir, proxyUrl, rootDomains = [] }) {
  const retireInput = await prepareRetireInput({ service, artifactsDir, proxyUrl, rootDomains });
  if (retireInput.skipped) {
    store.appendEvent(runId, {
      phase: "technology-enrichment",
      severity: "info",
      source: "retire",
      message: `retire skipped for ${service.url}: ${retireInput.reason}`
    });
    return;
  }
  const args = retireArgsForPath(retireInput.inputDir);
  const result = await runDetectorTool({ store, runId, linuxRuntime, toolName: "retire", args, timeoutMs: Math.min(timeoutMs, 60000), proxyUrl });
  const artifacts = writeDetectorArtifacts(artifactsDir, "retire", service, result);
  store.recordToolResult(runId, {
    toolName: "retire",
    commandDisplay: commandDisplay(linuxRuntime, "retire", result.args || args),
    status: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    stdoutPath: artifacts.stdoutPath,
    stderrPath: artifacts.stderrPath,
    errorMessage: result.errorMessage
  });
  const technologies = parseRetireTechnologies(result.stdout);
  saveTechnologyService(store, runId, targetName, service, "retire.js", technologies, result);
}

async function prepareRetireInput({ service, artifactsDir, proxyUrl = null, rootDomains = [], fetchImpl = fetch }) {
  // Page/script downloads use Node fetch, which would bypass the configured proxy.
  if (proxyUrl) return { skipped: true, reason: "page download would bypass the configured proxy" };
  const inputDir = path.join(artifactsDir, "retire-input", safeName(service.url));
  fs.mkdirSync(inputDir, { recursive: true });
  let html = "";
  try {
    html = await fetchText(service.url, { timeoutMs: 15000, fetchImpl });
  } catch (error) {
    return { skipped: true, reason: `unable to fetch page HTML (${error.message})` };
  }

  fs.writeFileSync(path.join(inputDir, "index.html"), html, "utf8");
  const allowed = (url) => isAllowedScriptHost(url, service, rootDomains);
  const scriptUrls = extractScriptUrls(html, service.url).filter(allowed).slice(0, 20);
  let saved = 0;
  for (const scriptUrl of scriptUrls) {
    try {
      const content = await fetchText(scriptUrl, { timeoutMs: 15000, allowFinalUrl: allowed, fetchImpl });
      fs.writeFileSync(path.join(inputDir, `${String(saved + 1).padStart(3, "0")}-${safeName(scriptUrl)}.js`), content, "utf8");
      saved += 1;
    } catch {
      // Keep the detector best-effort: one unavailable script should not fail the service.
    }
  }
  if (saved === 0) return { skipped: true, reason: "no downloadable JavaScript assets found" };
  return { inputDir, scriptCount: saved };
}

function retireArgsForPath(inputDir) {
  return ["--path", toToolPath(inputDir), "--outputformat", "json", "--exitwith", "0"];
}

async function fetchText(url, { timeoutMs = 15000, allowFinalUrl = null, fetchImpl = fetch } = {}) {
  return (await fetchBoundedText(url, { fetchImpl, timeoutMs, maxBytes: MAX_PAGE_BYTES, allowFinalUrl })).text;
}

// Only the service's own host or an in-scope root may serve scripts we download (no LAN/loopback probing).
function isAllowedScriptHost(scriptUrl, service, rootDomains = []) {
  try {
    const host = new URL(scriptUrl).hostname.toLowerCase();
    const own = new URL(service.url).hostname.toLowerCase();
    if (host === own) return true;
    return rootDomains.some((root) => {
      const r = String(root || "").toLowerCase();
      return r && (host === r || host.endsWith(`.${r}`));
    });
  } catch {
    return false;
  }
}

function extractScriptUrls(html, baseUrl) {
  const urls = [];
  // Bounded gap and capped input: an unterminated <script src=' flood used to take tens of seconds.
  const pattern = /<script\b[^>]{0,1000}?\bsrc=["']([^"']{1,2000})["']/gi;
  const text = String(html || "").slice(0, MAX_HTML_SCAN_CHARS);
  let match;
  while ((match = pattern.exec(text)) !== null) {
    try {
      const parsed = new URL(match[1], baseUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") urls.push(parsed.toString());
    } catch {
      // Ignore malformed script sources.
    }
  }
  return [...new Set(urls)];
}

async function runCmsDetector({ store, runId, targetName, service, linuxRuntime, timeoutMs, artifactsDir, proxyUrl }) {
  const tech = (service.technologies || []).join(" ").toLowerCase();
  if (tech.includes("wordpress")) {
    const args = ["--url", service.url, "--format", "json", "--no-update"];
    const result = await runDetectorTool({ store, runId, linuxRuntime, toolName: "wpscan", args, timeoutMs: Math.min(timeoutMs, 90000), proxyUrl });
    const artifacts = writeDetectorArtifacts(artifactsDir, "wpscan", service, result);
    store.recordToolResult(runId, {
      toolName: "wpscan",
      commandDisplay: commandDisplay(linuxRuntime, "wpscan", args),
      status: result.status,
      exitCode: result.exitCode,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      stdoutPath: artifacts.stdoutPath,
      stderrPath: artifacts.stderrPath,
      errorMessage: result.errorMessage
    });
    saveTechnologyService(store, runId, targetName, service, "wpscan", parseWpscanTechnologies(result.stdout), result);
    return;
  }

  if (/(joomla|drupal|wordpress|cms)/i.test(tech)) {
    const outputDir = path.join(artifactsDir, "cmseek", safeName(service.url));
    fs.mkdirSync(outputDir, { recursive: true });
    // CMSeeK has no --output flag (it writes to its own Result/ dir); passing it makes argparse
    // bail with a usage error. We parse detected tech from stdout, so --batch alone is enough.
    const args = ["-u", service.url, "--batch", "--random-agent"];
    const result = await runDetectorTool({ store, runId, linuxRuntime, toolName: "cmseek", args, timeoutMs: Math.min(timeoutMs, 90000), proxyUrl });
    const artifacts = writeDetectorArtifacts(artifactsDir, "cmseek", service, result);
    store.recordToolResult(runId, {
      toolName: "cmseek",
      commandDisplay: commandDisplay(linuxRuntime, "cmseek", args),
      status: result.status,
      exitCode: result.exitCode,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      stdoutPath: artifacts.stdoutPath,
      stderrPath: artifacts.stderrPath,
      errorMessage: result.errorMessage
    });
    saveTechnologyService(store, runId, targetName, service, "cmseek", parseCmseekTechnologies(result.stdout), result);
  }
}

async function enrichWithBuiltWith({ store, runId, targetName, services, artifactsDir }) {
  const key = store.getActiveApiKey("builtwith");
  if (!key?.api_key) {
    store.appendEvent(runId, {
      phase: "technology-enrichment",
      severity: "warn",
      source: "builtwith",
      message: "BuiltWith-style enrichment skipped: no active BuiltWith API key is configured."
    });
    return;
  }
  const hosts = [...new Set(services.map((service) => service.host).filter(Boolean))].slice(0, MAX_DETECTOR_URLS);
  for (const host of hosts) {
    try {
      const url = `https://api.builtwith.com/v21/api.json?KEY=${encodeURIComponent(key.api_key)}&LOOKUP=${encodeURIComponent(host)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const text = await response.text();
      const artifactPath = path.join(artifactsDir, `builtwith-${safeName(host)}.json`);
      fs.writeFileSync(artifactPath, text, "utf8");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      store.markApiKeyUsed(key.id);
      const technologies = parseBuiltWithTechnologies(text);
      for (const service of services.filter((item) => item.host === host)) {
        saveTechnologyService(store, runId, targetName, service, "builtwith", technologies, { status: "completed", rawArtifact: artifactPath });
      }
      store.appendEvent(runId, {
        phase: "technology-enrichment",
        severity: "ok",
        source: "builtwith",
        message: `BuiltWith-style enrichment added ${technologies.length} technologies for ${host}`
      });
    } catch (error) {
      store.appendEvent(runId, {
        phase: "technology-enrichment",
        severity: "warn",
        source: "builtwith",
        message: `BuiltWith-style enrichment skipped for ${host}: ${error.message}`
      });
    }
  }
}

async function runDetectorTool({ store, runId, linuxRuntime, toolName, args, timeoutMs, proxyUrl = null }) {
  store.appendEvent(runId, {
    phase: "technology-enrichment",
    source: toolName,
    message: `Running ${toolName}`
  });
  const attempts = DEFAULT_DETECTOR_ATTEMPTS;
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const invocation = buildProxyAwareInvocation({ toolName, args, proxyUrl });
      result = await runLinuxTool({ runtime: linuxRuntime, toolName, args: invocation.args, timeoutMs, proxyUrl: invocation.envProxyUrl });
    } catch (error) {
      result = {
        toolName,
        args,
        status: "failed",
        exitCode: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        stdout: "",
        stderr: "",
        errorMessage: error.message
      };
    }
    result.recovery = { attempt, maxAttempts: attempts, retried: attempt > 1 };
    const retryable = shouldRetryDetectorResult(result);
    if (!retryable) {
      if (attempt > 1) appendDetectorRecoveryEvent(store, runId, {
        stage: "recovered",
        toolName,
        attempt,
        maxAttempts: attempts,
        reason: "detector completed after retry"
      });
      break;
    }
    if (attempt >= attempts) {
      appendDetectorRecoveryEvent(store, runId, {
        stage: "exhausted",
        toolName,
        attempt,
        maxAttempts: attempts,
        reason: retryable
      });
      break;
    }
    appendDetectorRecoveryEvent(store, runId, {
      stage: "retrying",
      toolName,
      attempt,
      maxAttempts: attempts,
      reason: retryable
    });
  }
  store.appendEvent(runId, {
    phase: "technology-enrichment",
    severity: result.status === "completed" ? "ok" : "warn",
    source: toolName,
    message: `${toolName} ${result.status}${firstUsefulLine(result.stderr || result.errorMessage) ? `; ${firstUsefulLine(result.stderr || result.errorMessage)}` : ""}`
  });
  return result;
}

function shouldRetryDetectorResult(result) {
  if (!result) return "no detector result";
  if (result.status === "timeout") return result.errorMessage || "detector timeout";
  if (result.status === "error") return result.errorMessage || "detector runner error";
  const combined = [result.stderr, result.errorMessage, result.stdout].filter(Boolean).join("\n").slice(0, 20000);
  if (result.status === "failed" && DETECTOR_RECOVERY_PATTERNS.some((pattern) => pattern.test(combined))) {
    return firstUsefulLine(combined) || "transient detector/network failure";
  }
  return "";
}

function appendDetectorRecoveryEvent(store, runId, { stage, toolName, attempt, maxAttempts, reason }) {
  const messages = {
    retrying: `${toolName} detector looks stalled or hit a transient error. I am retrying it (${attempt + 1}/${maxAttempts}) without blocking the rest of enrichment.`,
    recovered: `${toolName} detector recovered after retry (${attempt}/${maxAttempts}). I will keep the recovered output.`,
    exhausted: `${toolName} detector still failed after ${attempt}/${maxAttempts} attempts. I will keep this as a warning and continue with the next detector/service.`
  };
  store.appendEvent(runId, {
    phase: "ai-tool-recovery",
    severity: stage === "recovered" ? "ok" : "warn",
    source: "ai-tool-recovery",
    message: messages[stage] || `${toolName} detector recovery update: ${stage}`,
    payload: { stage, toolName, attempt, maxAttempts, reason }
  });
}

function saveTechnologyService(store, runId, targetName, service, source, technologies, result) {
  if (!technologies.length) return 0;
  return store.saveHttpServices(runId, targetName, [{
    ...service,
    technologies: mergeTechnologies(service.technologies || [], technologies),
    raw: {
      ...(service.raw || {}),
      detector: source,
      detectorStatus: result.status,
      detectorArtifact: result.rawArtifact || null
    }
  }], source);
}

function parseRetireTechnologies(stdout) {
  const parsed = parseJson(stdout);
  if (!parsed) return [];
  const values = [];
  walk(parsed, (value, key) => {
    if (["component", "componentName", "name"].includes(key) && typeof value === "string") values.push(value);
    if (key === "version" && typeof value === "string") values.push(`JavaScript dependency ${value}`);
  });
  return unique(values);
}

function parseWpscanTechnologies(stdout) {
  const parsed = parseJson(stdout);
  const values = ["WordPress"];
  if (!parsed) return values;
  if (parsed.version?.number) values.push(`WordPress ${parsed.version.number}`);
  for (const collectionName of ["plugins", "themes"]) {
    const collection = parsed[collectionName] || {};
    for (const [name, item] of Object.entries(collection)) {
      values.push(item?.version?.number ? `${name} ${item.version.number}` : name);
    }
  }
  return unique(values);
}

function parseCmseekTechnologies(stdout) {
  const values = [];
  const cmsMatch = String(stdout || "").match(/CMS(?:\s+Detected)?\s*[:|-]\s*([^\r\n]+)/i);
  if (cmsMatch) values.push(cmsMatch[1].trim());
  return unique(values);
}

function parseBuiltWithTechnologies(text) {
  const parsed = parseJson(text);
  const values = [];
  walk(parsed, (value, key) => {
    if (["Name", "Tag", "Category"].includes(key) && typeof value === "string") values.push(value);
  });
  return unique(values).filter((value) => value.length <= 80);
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || "").trim());
  } catch {
    return null;
  }
}

function walk(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitor(child, key);
    walk(child, visitor);
  }
}

function dedupeServices(services) {
  const seen = new Set();
  return services.filter((service) => {
    if (!service?.url || seen.has(service.url)) return false;
    seen.add(service.url);
    return true;
  });
}

function mergeTechnologies(left, right) {
  return unique([...(left || []), ...(right || [])]);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function writeDetectorArtifacts(artifactsDir, toolName, service, result) {
  const base = `${toolName}-${safeName(service.url)}`;
  const stdoutPath = path.join(artifactsDir, `${base}.stdout.txt`);
  const stderrPath = path.join(artifactsDir, `${base}.stderr.txt`);
  fs.writeFileSync(stdoutPath, result.stdout || "", "utf8");
  fs.writeFileSync(stderrPath, result.stderr || "", "utf8");
  return { stdoutPath, stderrPath };
}

function safeName(value) {
  return String(value || "unknown").replaceAll(/[^a-z0-9_.-]/gi, "_").slice(0, 120);
}

function firstUsefulLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 160) || "";
}


module.exports = {
  extractScriptUrls,
  isAllowedScriptHost,
  prepareRetireInput,
  parseBuiltWithTechnologies,
  parseRetireTechnologies,
  parseWpscanTechnologies,
  retireArgsForPath,
  runTechnologyEnrichment
};
