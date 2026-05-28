"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chunkList } = require("../adaptive-recon-profile");
const { parseHttpxJsonLines } = require("../parsers");
const { createStageContract, finishStageContract } = require("../stage-contract");

async function runHttpProbeStage({
  hosts,
  ports,
  artifactsDir,
  runTool,
  timeoutMs,
  adaptiveProfile = null,
  source = "httpx",
  argsForInput = defaultHttpxArgsForInput
}) {
  const uniqueHosts = [...new Set((hosts || []).map((host) => String(host || "").trim()).filter(Boolean))].sort();
  const contract = createStageContract({
    stage: "http-probe",
    inputCount: uniqueHosts.length,
    expectedArtifacts: ["httpx stdout", "httpx stderr", "parsed http services"],
    aiAwareness: "AI is watching HTTP probing because tech detection, screenshots, favicons, trackers, and service review all depend on live HTTP service output."
  });
  if (!uniqueHosts.length) {
    return { contract: finishStageContract(contract, { warnings: ["No hosts were provided to HTTP probe stage."] }), services: [], results: [] };
  }
  fs.mkdirSync(artifactsDir, { recursive: true });
  const batchSize = adaptiveProfile?.httpxBatchSize || uniqueHosts.length;
  const batches = chunkList(uniqueHosts, batchSize);
  const results = [];
  const services = [];
  const warnings = [];

  for (let index = 0; index < batches.length; index += 1) {
    const batchNumber = index + 1;
    const inputPath = path.join(artifactsDir, `http-probe-batch-${String(batchNumber).padStart(4, "0")}.input.txt`);
    fs.writeFileSync(inputPath, `${batches[index].join("\n")}\n`, "utf8");
    const args = argsForInput(inputPath, ports, adaptiveProfile);
    const result = await runTool({ toolName: "httpx", args, timeoutMs, batchNumber, batchCount: batches.length, source });
    const parsed = parseHttpxJsonLines(result.stdout || "");
    services.push(...parsed);
    results.push({ ...result, batchNumber, inputPath, parsedServices: parsed.length, inputCount: batches[index].length });
    if (result.status !== "completed") warnings.push(`httpx batch ${batchNumber}/${batches.length} ended with ${result.status}`);
    if (parsed.length === 0) warnings.push(`httpx batch ${batchNumber}/${batches.length} produced zero parsed services`);
  }

  return {
    contract: finishStageContract(contract, {
      outputCount: services.length,
      artifacts: results.map((result) => result.inputPath),
      warnings
    }),
    services,
    results
  };
}

function defaultHttpxArgsForInput(inputPath, ports = [], adaptiveProfile = null) {
  const args = ["-l", inputPath, "-json", "-silent", "-status-code", "-title", "-tech-detect", "-follow-host-redirects"];
  if (Array.isArray(ports) && ports.length) args.splice(2, 0, "-ports", ports.join(","));
  if (adaptiveProfile?.httpxThreads) args.push("-threads", String(adaptiveProfile.httpxThreads));
  args.push("-retries", "1", "-timeout", "10");
  return args;
}

module.exports = {
  defaultHttpxArgsForInput,
  runHttpProbeStage
};
