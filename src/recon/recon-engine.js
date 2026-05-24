"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { extractDomains, normalizeDomain, rootForDomain } = require("./domain-utils");
const { parseGauUrls, parseHttpxJsonLines } = require("./parsers");
const { runTechnologyEnrichment } = require("./technology-detectors");
const { runPassiveSource } = require("./passive-sources");
const ProxyRotationController = require("./proxy-rotation");
const { commandDisplay, redactProxyUrl, runWslTool } = require("./wsl-tools");

const DEFAULT_PASSIVE_SOURCES = ["crtsh", "wayback"];
const DEFAULT_WSL_TOOLS = ["subfinder", "dnsx", "gau", "httpx"];
const DEFAULT_SCREENSHOT_TOOLS = ["gowitness"];
const RUN_CONTROL_STATUSES = new Set(["paused", "cancelled"]);

async function runRecon({
  store,
  runId,
  targetName,
  rootDomains,
  passiveSources = DEFAULT_PASSIVE_SOURCES,
  wslTools = DEFAULT_WSL_TOOLS,
  screenshotTools = DEFAULT_SCREENSHOT_TOOLS,
  wslDistro = "kali-linux",
  useWsl = true,
  subdomainWordlistPath = null,
  timeoutMs = 180000,
  artifactsDir = path.resolve("data", "recon-runs", String(runId)),
  proxyUrl = null
}) {
  const roots = [...new Set(rootDomains.map(normalizeDomain).filter(Boolean))];
  if (roots.length === 0) throw new Error("Recon requires at least one valid root domain");

  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForRunControl(store, runId);
  store.updateRun(runId, {
    status: "running",
    activePhase: "recon",
    checkpoint: { rootDomains: roots, passiveSources, wslTools, screenshotTools, useWsl, subdomainWordlistPath }
  });
  store.appendEvent(runId, { phase: "recon", source: "engine", message: `Recon started for ${roots.join(", ")}` });

  const proxyController = useWsl
    ? await createProxyController({ store, runId, proxyUrl, phase: "recon" })
    : null;
  const selectedProxyUrl = proxyController?.bestProxyUrl() || proxyUrl || null;
  if (selectedProxyUrl) {
    store.appendEvent(runId, {
      phase: "recon",
      severity: "ok",
      source: "network",
      message: proxyController?.hasPool()
        ? `Automatic proxy rotation enabled. Best preflight proxy: ${redactProxyUrl(selectedProxyUrl)}`
        : `Outbound proxy enabled for WSL recon tools: ${redactProxyUrl(selectedProxyUrl)}`
    });
  }

  await waitForRunControl(store, runId);
  const discovered = new Set(roots);
  await collectPassive({ store, runId, targetName, roots, passiveSources, discovered });
  await waitForRunControl(store, runId);
  const context = { urls: [], httpServices: [] };
  await collectWsl({ store, runId, targetName, roots, wslTools, wslDistro, useWsl, subdomainWordlistPath, timeoutMs, artifactsDir, discovered, context, proxyUrl: selectedProxyUrl, proxyController });
  await waitForRunControl(store, runId);
  await runTechnologyEnrichment({ store, runId, targetName, wslDistro, useWsl, timeoutMs, artifactsDir, context, waitForRunControl, proxyUrl: selectedProxyUrl });
  await waitForRunControl(store, runId);
  await collectScreenshots({ store, runId, targetName, screenshotTools, wslDistro, useWsl, timeoutMs, artifactsDir, context, proxyUrl: selectedProxyUrl, proxyController });
  await waitForRunControl(store, runId);

  const finalDomains = [...discovered].map((domain) => ({
    domain,
    rootDomain: rootForDomain(domain, roots),
    kind: roots.includes(domain) ? "root" : "subdomain",
    source: "recon-summary",
    metadata: { runId }
  }));
  store.saveDomains(runId, targetName, finalDomains);
  store.appendEvent(runId, { phase: "recon", severity: "ok", source: "engine", message: `Recon completed with ${discovered.size} unique domains` });
  return store.updateRun(runId, {
    status: "completed",
    activePhase: "completed",
    finishedAt: new Date().toISOString(),
    checkpoint: { rootDomains: roots, uniqueDomains: discovered.size }
  });
}

async function runHttpFollowup({
  store,
  runId,
  targetName,
  domains,
  screenshotTools = DEFAULT_SCREENSHOT_TOOLS,
  wslDistro = "kali-linux",
  useWsl = true,
  timeoutMs = 180000,
  artifactsDir = path.resolve("data", "recon-runs", String(runId)),
  proxyUrl = null
}) {
  const hosts = [...new Set((domains || []).map(normalizeDomain).filter(Boolean))].sort();
  if (hosts.length === 0) throw new Error("HTTP follow-up requires at least one saved domain");
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForRunControl(store, runId);
  store.updateRun(runId, {
    status: "running",
    activePhase: "http-tech-followup",
    checkpoint: { domainCount: hosts.length, screenshotTools, useWsl }
  });
  store.appendEvent(runId, { phase: "http-tech-followup", severity: "ok", source: "engine", message: `HTTP/tech follow-up started for ${hosts.length} saved domains` });

  if (!useWsl) throw new Error("HTTP follow-up requires the Linux tool runner");
  const proxyController = await createProxyController({ store, runId, proxyUrl, phase: "http-tech-followup" });
  const selectedProxyUrl = proxyController?.bestProxyUrl() || proxyUrl || null;
  if (selectedProxyUrl) {
    store.appendEvent(runId, {
      phase: "http-tech-followup",
      severity: "ok",
      source: "network",
      message: proxyController?.hasPool()
        ? `Automatic proxy rotation enabled. Best preflight proxy: ${redactProxyUrl(selectedProxyUrl)}`
        : `Outbound proxy enabled for WSL recon tools: ${redactProxyUrl(selectedProxyUrl)}`
    });
  }

  store.saveDomains(runId, targetName, hosts.map((domain) => ({
    domain,
    rootDomain: rootForDomain(domain, hosts),
    kind: "domain",
    source: "http-followup-input",
    metadata: { source: "saved-run" }
  })));

  const inputPath = path.join(artifactsDir, "httpx-followup.input.txt");
  fs.writeFileSync(inputPath, hosts.join("\n"), "utf8");
  const args = httpxArgsForInput(inputPath);
  store.appendEvent(runId, { phase: "http-tech-followup", source: "httpx", message: `Running httpx against ${hosts.length} saved domains` });
  const result = await runToolWithHeartbeat({
    store,
    runId,
    phase: "heartbeat",
    source: "httpx",
    heartbeatMessage: (elapsed) => `httpx follow-up is still running (${elapsed}s elapsed)`,
    task: () => runWslToolWithProxy({ proxyController, distro: wslDistro, toolName: "httpx", args, timeoutMs, proxyUrl: selectedProxyUrl })
  });
  const stdoutPath = writeToolArtifact(artifactsDir, "httpx-followup.stdout.txt", result.stdout);
  const stderrPath = writeToolArtifact(artifactsDir, "httpx-followup.stderr.txt", result.stderr);
  store.recordToolResult(runId, {
    toolName: "httpx",
    commandDisplay: commandDisplay(wslDistro, "httpx", args),
    status: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    stdoutPath,
    stderrPath,
    errorMessage: result.errorMessage
  });
  const services = parseHttpxJsonLines(result.stdout);
  store.saveHttpServices(runId, targetName, services, "httpx");
  const context = { urls: [], httpServices: services };
  store.appendEvent(runId, {
    phase: "http-tech-followup",
    severity: result.status === "completed" ? "ok" : "warn",
    source: "httpx",
    message: `httpx ${result.status}; parsed ${services.length} HTTP services with status/tech${toolFailureDetail(result)}`
  });

  await waitForRunControl(store, runId);
  await runTechnologyEnrichment({ store, runId, targetName, wslDistro, useWsl, timeoutMs, artifactsDir, context, waitForRunControl, proxyUrl: selectedProxyUrl });
  await waitForRunControl(store, runId);
  await collectScreenshots({ store, runId, targetName, screenshotTools, wslDistro, useWsl, timeoutMs, artifactsDir, context, proxyUrl: selectedProxyUrl, proxyController });
  store.appendEvent(runId, { phase: "http-tech-followup", severity: "ok", source: "engine", message: `HTTP/tech follow-up completed with ${services.length} live services` });
  return store.updateRun(runId, {
    status: "completed",
    activePhase: "completed",
    finishedAt: new Date().toISOString(),
    checkpoint: { domainCount: hosts.length, httpServices: services.length }
  });
}

async function createProxyController({ store, runId, proxyUrl = null, phase = "recon" }) {
  try {
    const controller = await ProxyRotationController.create({ store, runId, preferredProxyUrl: proxyUrl });
    if (!controller.hasPool() && !proxyUrl) return null;
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

function runWslToolWithProxy({ proxyController, distro, toolName, args, timeoutMs, input = null, proxyUrl = null }) {
  if (proxyController?.hasPool()) return proxyController.runTool({ distro, toolName, args, timeoutMs, input });
  return runWslTool({ distro, toolName, args, timeoutMs, input, proxyUrl });
}

async function collectPassive({ store, runId, targetName, roots, passiveSources, discovered }) {
  for (const root of roots) {
    for (const source of passiveSources) {
      await waitForRunControl(store, runId);
      store.appendEvent(runId, { phase: "recon", source, message: `Querying passive source for ${root}` });
      try {
        const domains = await runPassiveSource(source, root);
        for (const domain of domains) discovered.add(domain);
        store.saveDomains(runId, targetName, domains.map((domain) => ({ domain, rootDomain: rootForDomain(domain, roots), kind: domain === root ? "root" : "subdomain", source })));
        store.appendEvent(runId, { phase: "recon", severity: "ok", source, message: `${source} returned ${domains.length} domains for ${root}` });
      } catch (error) {
        store.appendEvent(runId, { phase: "recon", severity: "warn", source, message: `${source} failed for ${root}: ${error.message}` });
      }
    }
  }
}

async function collectWsl({ store, runId, targetName, roots, wslTools, wslDistro, useWsl, subdomainWordlistPath, timeoutMs, artifactsDir, discovered, context, proxyUrl = null, proxyController = null }) {
  if (!useWsl) {
    store.appendEvent(runId, { phase: "recon", source: "wsl", message: "WSL tools skipped by run configuration" });
    return;
  }

  for (const root of roots) {
    for (const toolName of wslTools) {
      await waitForRunControl(store, runId);
      let args;
      try {
        args = argsForTool(toolName, root, artifactsDir, discovered, subdomainWordlistPath);
      } catch (error) {
        recordNonBlockingToolError({ store, runId, toolName, root, error });
        continue;
      }
      if (!args) continue;
      store.appendEvent(runId, { phase: "recon", source: toolName, message: `Running ${toolName} for ${root}` });
      let result;
      try {
        result = await runToolWithHeartbeat({
          store,
          runId,
          phase: "heartbeat",
          source: toolName,
          heartbeatMessage: (elapsed) => `${toolName} is still running for ${root} (${elapsed}s elapsed)`,
          task: () => runWslToolWithProxy({ proxyController, distro: wslDistro, toolName, args, timeoutMs, proxyUrl })
        });
      } catch (error) {
        recordNonBlockingToolError({ store, runId, toolName, root, args, error, wslDistro });
        continue;
      }
      const stdoutPath = writeToolArtifact(artifactsDir, `${toolName}-${root}.stdout.txt`, result.stdout);
      const stderrPath = writeToolArtifact(artifactsDir, `${toolName}-${root}.stderr.txt`, result.stderr);
      store.recordToolResult(runId, {
        toolName,
        commandDisplay: commandDisplay(wslDistro, toolName, args),
        status: result.status,
        exitCode: result.exitCode,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        stdoutPath,
        stderrPath,
        errorMessage: result.errorMessage
      });

      const domains = extractDomains(result.stdout, roots);
      for (const domain of domains) discovered.add(domain);
      store.saveDomains(runId, targetName, domains.map((domain) => ({
        domain,
        rootDomain: rootForDomain(domain, roots),
        kind: domain === root ? "root" : "subdomain",
        source: toolName,
        metadata: { exitCode: result.exitCode, status: result.status, proxyRotation: result.proxyRotation || null }
      })));
      store.appendEvent(runId, {
        phase: "recon",
        severity: result.status === "completed" ? "ok" : "warn",
        source: toolName,
        message: `${toolName} ${result.status}; parsed ${domains.length} domains${toolFailureDetail(result)}`
      });

      if (toolName === "gau") {
        const urls = parseGauUrls(result.stdout, roots);
        context.urls.push(...urls);
        store.saveUrls(runId, targetName, urls, "gau");
        store.appendEvent(runId, { phase: "recon", severity: "ok", source: "gau", message: `gau parsed ${urls.length} archived URLs and parameters` });
      }

      if (toolName === "httpx") {
        const services = parseHttpxJsonLines(result.stdout);
        context.httpServices.push(...services);
        store.saveHttpServices(runId, targetName, services, "httpx");
        store.appendEvent(runId, { phase: "recon", severity: "ok", source: "httpx", message: `httpx parsed ${services.length} HTTP services with status/tech` });
      }
    }
  }
}

function recordNonBlockingToolError({ store, runId, toolName, root, args = [], error, wslDistro = "kali-linux" }) {
  const now = new Date().toISOString();
  store.recordToolResult(runId, { toolName, commandDisplay: commandDisplay(wslDistro, toolName, args), status: "failed", exitCode: null, startedAt: now, finishedAt: now, errorMessage: error.message });
  store.appendEvent(runId, { phase: "recon", severity: "warn", source: toolName, message: `${toolName} skipped for ${root}: ${error.message}. Continuing with remaining recon steps.` });
}

function argsForTool(toolName, root, artifactsDir, discovered, subdomainWordlistPath = null) {
  if (toolName === "subfinder") return ["-d", root, "-silent", "-all"];
  if (toolName === "amass") return ["enum", "-passive", "-d", root];
  if (toolName === "dnsx") {
    const inputPath = path.join(artifactsDir, `dnsx-${root}.input.txt`);
    fs.writeFileSync(inputPath, [...discovered].join("\n"), "utf8");
    return ["-l", toWslPath(inputPath), "-silent", "-a", "-aaaa", "-cname"];
  }
  if (toolName === "puredns") {
    const inputPath = path.join(artifactsDir, `puredns-${root}.input.txt`);
    fs.writeFileSync(inputPath, [...discovered].join("\n"), "utf8");
    return ["resolve", toWslPath(inputPath), "--write", "-"];
  }
  if (toolName === "shuffle-dns" && subdomainWordlistPath) return ["-d", root, "-w", toWslPath(subdomainWordlistPath), "-silent"];
  if (toolName === "gau") return [root];
  if (toolName === "httpx") {
    const inputPath = path.join(artifactsDir, `httpx-${root}.input.txt`);
    const hosts = [...discovered].sort();
    fs.writeFileSync(inputPath, hosts.join("\n"), "utf8");
    return httpxArgsForInput(inputPath);
  }
  return null;
}

function httpxArgsForInput(inputPath) {
  return ["-l", toWslPath(inputPath), "-json", "-silent", "-status-code", "-title", "-tech-detect", "-follow-host-redirects"];
}

async function collectScreenshots({ store, runId, targetName, screenshotTools, wslDistro, useWsl, timeoutMs, artifactsDir, context, proxyUrl = null, proxyController = null }) {
  if (!useWsl || screenshotTools.length === 0 || context.httpServices.length === 0) return;
  const liveUrls = [...new Set(context.httpServices.map((service) => service.url).filter(Boolean))].sort();
  const inputPath = path.join(artifactsDir, "screenshots.input.txt");
  fs.writeFileSync(inputPath, liveUrls.join("\n"), "utf8");

  for (const toolName of screenshotTools) {
    await waitForRunControl(store, runId);
    const outputDir = path.join(artifactsDir, "screenshots", toolName);
    fs.mkdirSync(outputDir, { recursive: true });
    const args = screenshotArgsForTool(toolName, inputPath, outputDir);
    if (!args) continue;
    store.appendEvent(runId, { phase: "recon", source: toolName, message: `Capturing screenshots for ${liveUrls.length} live URLs` });
    const result = await runToolWithHeartbeat({
      store,
      runId,
      phase: "heartbeat",
      source: toolName,
      heartbeatMessage: (elapsed) => `${toolName} screenshot capture is still running (${elapsed}s elapsed)`,
      task: () => runWslToolWithProxy({ proxyController, distro: wslDistro, toolName, args, timeoutMs, proxyUrl, input: toolName === "aquatone" ? `${liveUrls.join("\n")}\n` : null })
    });
    const stdoutPath = writeToolArtifact(artifactsDir, `${toolName}-screenshots.stdout.txt`, result.stdout);
    const stderrPath = writeToolArtifact(artifactsDir, `${toolName}-screenshots.stderr.txt`, result.stderr);
    store.recordToolResult(runId, { toolName, commandDisplay: commandDisplay(wslDistro, toolName, args), status: result.status, exitCode: result.exitCode, startedAt: result.startedAt, finishedAt: result.finishedAt, stdoutPath, stderrPath, errorMessage: result.errorMessage });
    store.saveScreenshotRun(runId, targetName, { toolName, outputDir, reportPath: findScreenshotReport(outputDir), metadata: { status: result.status, exitCode: result.exitCode, urlCount: liveUrls.length, screenshotCount: countScreenshotFiles(outputDir), proxyRotation: result.proxyRotation || null } });
    store.appendEvent(runId, { phase: "recon", severity: result.status === "completed" ? "ok" : "warn", source: toolName, message: `${toolName} screenshot run ${result.status}` });
  }
}

async function runToolWithHeartbeat({ store, runId, phase, source, heartbeatMessage, task }) {
  let heartbeatCount = 0;
  const heartbeat = setInterval(() => {
    heartbeatCount += 1;
    store.appendEvent(runId, { phase, source, message: heartbeatMessage(heartbeatCount * 15) });
  }, 15000);
  try {
    return await task();
  } finally {
    clearInterval(heartbeat);
  }
}

async function waitForRunControl(store, runId) {
  let run = store.getRun(runId);
  if (!run) throw new RunControlError("cancelled", "Run no longer exists");
  if (run.status === "cancelled") throw new RunControlError("cancelled", "Run cancelled by user");
  if (run.status !== "paused") return;
  store.appendEvent(runId, { phase: "control", severity: "warn", source: "engine", message: "Run paused. Waiting for resume or cancel." });
  while (RUN_CONTROL_STATUSES.has(run.status)) {
    await sleep(1000);
    run = store.getRun(runId);
    if (!run || run.status === "cancelled") throw new RunControlError("cancelled", "Run cancelled by user");
    if (run.status !== "paused") {
      store.appendEvent(runId, { phase: "control", severity: "ok", source: "engine", message: "Run resumed." });
      return;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RunControlError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "RunControlError";
    this.status = status;
  }
}

function isRunControlError(error) {
  return error?.name === "RunControlError";
}

function screenshotArgsForTool(toolName, inputPath, outputDir) {
  if (toolName === "gowitness") return ["scan", "file", "-f", toWslPath(inputPath), "--screenshot-path", toWslPath(outputDir), "--write-jsonl"];
  if (toolName === "aquatone") return ["-out", toWslPath(outputDir), "-ports", "xlarge", "-scan-timeout", "3000"];
  if (toolName === "eyewitness") return ["--web", "-f", toWslPath(inputPath), "-d", toWslPath(outputDir), "--no-prompt"];
  return null;
}

function findScreenshotReport(outputDir) {
  const candidates = [path.join(outputDir, "gowitness.sqlite3"), path.join(outputDir, "aquatone_report.html"), path.join(outputDir, "report.html")];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function countScreenshotFiles(outputDir) {
  if (!fs.existsSync(outputDir)) return 0;
  return fs.readdirSync(outputDir, { recursive: true }).filter((entry) => /\.(png|jpe?g|webp)$/i.test(String(entry))).length;
}

function toWslPath(windowsPath) {
  if (String(windowsPath).startsWith("/")) return windowsPath;
  const resolved = path.resolve(windowsPath);
  const drive = resolved.slice(0, 1).toLowerCase();
  const rest = resolved.slice(2).replaceAll("\\", "/");
  return `/mnt/${drive}${rest}`;
}

function toolFailureDetail(result) {
  if (result.status === "completed") return "";
  const detail = firstUsefulLine(result.stderr || result.errorMessage || result.stdout);
  return detail ? `; ${detail}` : "";
}

function firstUsefulLine(value) {
  return String(value || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 240) || "";
}

function writeToolArtifact(dir, name, content) {
  const filePath = path.join(dir, name.replaceAll(/[^a-z0-9_.-]/gi, "_"));
  fs.writeFileSync(filePath, content || "", "utf8");
  return filePath;
}

module.exports = {
  DEFAULT_PASSIVE_SOURCES,
  DEFAULT_SCREENSHOT_TOOLS,
  DEFAULT_WSL_TOOLS,
  httpxArgsForInput,
  isRunControlError,
  runHttpFollowup,
  runRecon
};
