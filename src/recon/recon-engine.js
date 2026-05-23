"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { extractDomains, normalizeDomain, rootForDomain } = require("./domain-utils");
const { parseGauUrls, parseHttpxJsonLines } = require("./parsers");
const { runPassiveSource } = require("./passive-sources");
const { commandDisplay, runWslTool } = require("./wsl-tools");

const DEFAULT_PASSIVE_SOURCES = ["crtsh", "wayback"];
const DEFAULT_WSL_TOOLS = ["subfinder", "dnsx", "gau", "httpx"];
const DEFAULT_SCREENSHOT_TOOLS = [];
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
  artifactsDir = path.resolve("data", "recon-runs", String(runId))
}) {
  const roots = [...new Set(rootDomains.map(normalizeDomain).filter(Boolean))];
  if (roots.length === 0) {
    throw new Error("Recon requires at least one valid root domain");
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForRunControl(store, runId);
  store.updateRun(runId, {
    status: "running",
    activePhase: "recon",
    checkpoint: { rootDomains: roots, passiveSources, wslTools, screenshotTools, useWsl, subdomainWordlistPath }
  });
  store.appendEvent(runId, {
    phase: "recon",
    source: "engine",
    message: `Recon started for ${roots.join(", ")}`
  });

  await waitForRunControl(store, runId);
  const discovered = new Set(roots);
  await collectPassive({ store, runId, targetName, roots, passiveSources, discovered });
  await waitForRunControl(store, runId);
  const context = { urls: [], httpServices: [] };
  await collectWsl({ store, runId, targetName, roots, wslTools, wslDistro, useWsl, subdomainWordlistPath, timeoutMs, artifactsDir, discovered, context });
  await waitForRunControl(store, runId);
  await collectScreenshots({ store, runId, targetName, screenshotTools, wslDistro, useWsl, timeoutMs, artifactsDir, context });
  await waitForRunControl(store, runId);

  const finalDomains = [...discovered].map((domain) => ({
    domain,
    rootDomain: rootForDomain(domain, roots),
    kind: roots.includes(domain) ? "root" : "subdomain",
    source: "recon-summary",
    metadata: { runId }
  }));
  store.saveDomains(runId, targetName, finalDomains);
  store.appendEvent(runId, {
    phase: "recon",
    severity: "ok",
    source: "engine",
    message: `Recon completed with ${discovered.size} unique domains`
  });
  return store.updateRun(runId, {
    status: "completed",
    activePhase: "completed",
    finishedAt: new Date().toISOString(),
    checkpoint: { rootDomains: roots, uniqueDomains: discovered.size }
  });
}

async function collectPassive({ store, runId, targetName, roots, passiveSources, discovered }) {
  for (const root of roots) {
    for (const source of passiveSources) {
      await waitForRunControl(store, runId);
      store.appendEvent(runId, {
        phase: "recon",
        source,
        message: `Querying passive source for ${root}`
      });
      try {
        const domains = await runPassiveSource(source, root);
        for (const domain of domains) discovered.add(domain);
        store.saveDomains(runId, targetName, domains.map((domain) => ({
          domain,
          rootDomain: rootForDomain(domain, roots),
          kind: domain === root ? "root" : "subdomain",
          source
        })));
        store.appendEvent(runId, {
          phase: "recon",
          severity: "ok",
          source,
          message: `${source} returned ${domains.length} domains for ${root}`
        });
      } catch (error) {
        store.appendEvent(runId, {
          phase: "recon",
          severity: "warn",
          source,
          message: `${source} failed for ${root}: ${error.message}`
        });
      }
    }
  }
}

async function collectWsl({ store, runId, targetName, roots, wslTools, wslDistro, useWsl, subdomainWordlistPath, timeoutMs, artifactsDir, discovered, context }) {
  if (!useWsl) {
    store.appendEvent(runId, {
      phase: "recon",
      source: "wsl",
      message: "WSL tools skipped by run configuration"
    });
    return;
  }

  for (const root of roots) {
    for (const toolName of wslTools) {
      await waitForRunControl(store, runId);
      const args = argsForTool(toolName, root, artifactsDir, discovered, subdomainWordlistPath);
      if (!args) continue;
      store.appendEvent(runId, {
        phase: "recon",
        source: toolName,
        message: `Running ${toolName} for ${root}`
      });
      const result = await runWslTool({ distro: wslDistro, toolName, args, timeoutMs });
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
        metadata: { exitCode: result.exitCode, status: result.status }
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
        store.appendEvent(runId, {
          phase: "recon",
          severity: "ok",
          source: "gau",
          message: `gau parsed ${urls.length} archived URLs and parameters`
        });
      }

      if (toolName === "httpx") {
        const services = parseHttpxJsonLines(result.stdout);
        context.httpServices.push(...services);
        store.saveHttpServices(runId, targetName, services, "httpx");
        store.appendEvent(runId, {
          phase: "recon",
          severity: "ok",
          source: "httpx",
          message: `httpx parsed ${services.length} HTTP services with status/tech`
        });
      }
    }
  }
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
  if (toolName === "shuffle-dns" && subdomainWordlistPath) {
    return ["-d", root, "-w", toWslPath(subdomainWordlistPath), "-silent"];
  }
  if (toolName === "gau") return [root];
  if (toolName === "httpx") {
    const inputPath = path.join(artifactsDir, `httpx-${root}.input.txt`);
    const hosts = [...discovered].sort();
    fs.writeFileSync(inputPath, hosts.join("\n"), "utf8");
    return [
      "-l", toWslPath(inputPath),
      "-json",
      "-silent",
      "-status-code",
      "-title",
      "-tech-detect",
      "-follow-host-redirects"
    ];
  }
  return null;
}

async function collectScreenshots({ store, runId, targetName, screenshotTools, wslDistro, useWsl, timeoutMs, artifactsDir, context }) {
  if (!useWsl || screenshotTools.length === 0 || context.httpServices.length === 0) {
    return;
  }

  const liveUrls = [...new Set(context.httpServices.map((service) => service.url).filter(Boolean))].sort();
  const inputPath = path.join(artifactsDir, "screenshots.input.txt");
  fs.writeFileSync(inputPath, liveUrls.join("\n"), "utf8");

  for (const toolName of screenshotTools) {
    await waitForRunControl(store, runId);
    const outputDir = path.join(artifactsDir, "screenshots", toolName);
    fs.mkdirSync(outputDir, { recursive: true });
    const args = screenshotArgsForTool(toolName, inputPath, outputDir);
    if (!args) continue;

    store.appendEvent(runId, {
      phase: "recon",
      source: toolName,
      message: `Capturing screenshots for ${liveUrls.length} live URLs`
    });
    const result = await runWslTool({
      distro: wslDistro,
      toolName,
      args,
      timeoutMs,
      input: toolName === "aquatone" ? `${liveUrls.join("\n")}\n` : null
    });
    const stdoutPath = writeToolArtifact(artifactsDir, `${toolName}-screenshots.stdout.txt`, result.stdout);
    const stderrPath = writeToolArtifact(artifactsDir, `${toolName}-screenshots.stderr.txt`, result.stderr);
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
    store.saveScreenshotRun(runId, targetName, {
      toolName,
      outputDir,
      reportPath: findScreenshotReport(outputDir),
      metadata: { status: result.status, exitCode: result.exitCode, urlCount: liveUrls.length }
    });
    store.appendEvent(runId, {
      phase: "recon",
      severity: result.status === "completed" ? "ok" : "warn",
      source: toolName,
      message: `${toolName} screenshot run ${result.status}`
    });
  }
}

async function waitForRunControl(store, runId) {
  let run = store.getRun(runId);
  if (!run) throw new RunControlError("cancelled", "Run no longer exists");
  if (run.status === "cancelled") {
    throw new RunControlError("cancelled", "Run cancelled by user");
  }
  if (run.status !== "paused") return;

  store.appendEvent(runId, {
    phase: "control",
    severity: "warn",
    source: "engine",
    message: "Run paused. Waiting for resume or cancel."
  });
  while (RUN_CONTROL_STATUSES.has(run.status)) {
    await sleep(1000);
    run = store.getRun(runId);
    if (!run || run.status === "cancelled") {
      throw new RunControlError("cancelled", "Run cancelled by user");
    }
    if (run.status !== "paused") {
      store.appendEvent(runId, {
        phase: "control",
        severity: "ok",
        source: "engine",
        message: "Run resumed."
      });
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
  if (toolName === "aquatone") {
    return ["-out", toWslPath(outputDir), "-ports", "xlarge", "-scan-timeout", "3000"];
  }
  if (toolName === "eyewitness") {
    return ["--web", "-f", toWslPath(inputPath), "-d", toWslPath(outputDir), "--no-prompt"];
  }
  return null;
}

function findScreenshotReport(outputDir) {
  const candidates = [
    path.join(outputDir, "aquatone_report.html"),
    path.join(outputDir, "report.html")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
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
  return String(value || "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 240) || "";
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
  isRunControlError,
  runRecon
};
