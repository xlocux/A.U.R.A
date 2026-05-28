"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { applyAdaptiveTimeout, chunkList } = require("./adaptive-recon-profile");

function patchLinuxToolRunner(linuxTools, getActiveProfile) {
  if (!linuxTools || linuxTools.__auraAdaptiveToolRunnerPatched || typeof linuxTools.runLinuxTool !== "function") return;
  const original = linuxTools.runLinuxTool;
  linuxTools.runLinuxTool = function adaptiveRunLinuxTool(options = {}) {
    const profile = getActiveProfile?.() || null;
    if (!profile) return original(options);
    const adapted = adaptToolInvocation(options, profile);
    if (String(options.toolName || "").toLowerCase() === "httpx") {
      return runBatchedHttpx({ original, options: adapted, profile });
    }
    return original(adapted);
  };
  Object.defineProperty(linuxTools, "__auraAdaptiveToolRunnerPatched", { value: true, enumerable: false });
}

async function runBatchedHttpx({ original, options, profile }) {
  const inputPath = findFlagValue(options.args || [], "-l");
  if (!inputPath || !fs.existsSync(inputPath)) return original(options);
  const hosts = fs.readFileSync(inputPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (hosts.length <= profile.httpxBatchSize) return original(options);

  const batches = chunkList(hosts, profile.httpxBatchSize);
  const batchDir = path.join(path.dirname(inputPath), "httpx-batches");
  fs.mkdirSync(batchDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const stdout = [];
  const stderr = [];
  const childResults = [];
  let status = "completed";
  let exitCode = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const batchPath = path.join(batchDir, `batch-${String(index + 1).padStart(4, "0")}.txt`);
    fs.writeFileSync(batchPath, `${batches[index].join("\n")}\n`, "utf8");
    const result = await original({ ...options, args: replaceFlagValue(options.args || [], "-l", batchPath) });
    childResults.push({ batch: index + 1, inputCount: batches[index].length, status: result.status, exitCode: result.exitCode, errorMessage: result.errorMessage || null });
    if (result.stdout) stdout.push(result.stdout);
    if (result.stderr) stderr.push(`[batch ${index + 1}/${batches.length}]\n${result.stderr}`);
    if (result.status !== "completed" && status === "completed") status = result.status;
    if (result.exitCode !== 0 && exitCode === 0) exitCode = result.exitCode;
  }

  return {
    toolName: options.toolName,
    args: options.args,
    status,
    exitCode,
    startedAt,
    finishedAt: new Date().toISOString(),
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
    errorMessage: status === "completed" ? null : "One or more adaptive httpx batches did not complete.",
    adaptiveBatching: { enabled: true, inputCount: hosts.length, batchSize: profile.httpxBatchSize, batchCount: batches.length, childResults }
  };
}

function adaptToolInvocation(options, profile) {
  const toolName = String(options.toolName || "").toLowerCase();
  const adapted = { ...options, timeoutMs: applyAdaptiveTimeout(options.timeoutMs, profile) };
  if (toolName === "httpx") {
    adapted.args = adaptFlagValue(options.args || [], ["-threads", "-t"], String(profile.httpxThreads));
    adapted.args = ensureFlagValue(adapted.args, "-retries", "1");
    adapted.args = ensureFlagValue(adapted.args, "-timeout", "10");
  }
  if (toolName === "dnsx") {
    adapted.args = adaptFlagValue(options.args || [], ["-t", "-threads"], String(profile.dnsxThreads));
    adapted.args = ensureFlagValue(adapted.args, "-retry", "1");
  }
  if (toolName === "gowitness") {
    adapted.args = ensureFlagValue(options.args || [], "--threads", String(profile.screenshotConcurrency));
  }
  return adapted;
}

function adaptFlagValue(args, flags, value) {
  const output = [...args];
  for (const flag of flags) {
    const index = output.indexOf(flag);
    if (index !== -1) {
      output[index + 1] = value;
      return output;
    }
  }
  output.push(flags[0], value);
  return output;
}

function ensureFlagValue(args, flag, value) {
  const output = [...args];
  const index = output.indexOf(flag);
  if (index !== -1) {
    if (output[index + 1] === undefined || String(output[index + 1]).startsWith("-")) output.splice(index + 1, 0, value);
    return output;
  }
  output.push(flag, value);
  return output;
}

function findFlagValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] || null;
}

function replaceFlagValue(args, flag, value) {
  const output = [...args];
  const index = output.indexOf(flag);
  if (index === -1) return [...output, flag, value];
  output[index + 1] = value;
  return output;
}

module.exports = { adaptToolInvocation, patchLinuxToolRunner, runBatchedHttpx };
