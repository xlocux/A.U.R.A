"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createStageContract, finishStageContract } = require("../stage-contract");

async function runScreenshotStage({
  services,
  screenshotTools = ["gowitness"],
  artifactsDir,
  runTool,
  timeoutMs,
  adaptiveProfile = null
}) {
  const liveUrls = [...new Set((services || []).map((service) => service?.url).filter(Boolean))].sort();
  const contract = createStageContract({
    stage: "screenshots",
    inputCount: liveUrls.length,
    expectedArtifacts: ["screenshot input", "screenshot output directory", "screenshot report"],
    aiAwareness: "AI is watching screenshot capture separately from HTTP probing so visual triage failures do not hide live service evidence."
  });
  if (!liveUrls.length || !screenshotTools.length) {
    return { contract: finishStageContract(contract, { warnings: ["Screenshot stage skipped because no live URLs or screenshot tools were available."] }), runs: [] };
  }
  fs.mkdirSync(artifactsDir, { recursive: true });
  const inputPath = path.join(artifactsDir, "screenshots.stage.input.txt");
  fs.writeFileSync(inputPath, `${liveUrls.join("\n")}\n`, "utf8");
  const runs = [];
  const warnings = [];

  for (const toolName of screenshotTools) {
    const outputDir = path.join(artifactsDir, "screenshots", toolName);
    fs.mkdirSync(outputDir, { recursive: true });
    const args = screenshotArgsForTool(toolName, inputPath, outputDir, adaptiveProfile);
    if (!args) {
      warnings.push(`Unsupported screenshot tool: ${toolName}`);
      continue;
    }
    const result = await runTool({ toolName, args, timeoutMs, input: toolName === "aquatone" ? `${liveUrls.join("\n")}\n` : null });
    const screenshotCount = countScreenshotFiles(outputDir);
    runs.push({ toolName, outputDir, reportPath: findScreenshotReport(outputDir), screenshotCount, result });
    if (result.status !== "completed") warnings.push(`${toolName} ended with ${result.status}`);
    if (screenshotCount === 0) warnings.push(`${toolName} produced zero screenshot image files`);
  }

  return {
    contract: finishStageContract(contract, {
      outputCount: runs.reduce((total, run) => total + run.screenshotCount, 0),
      artifacts: runs.map((run) => run.outputDir),
      warnings
    }),
    runs
  };
}

function screenshotArgsForTool(toolName, inputPath, outputDir, adaptiveProfile = null) {
  if (toolName === "gowitness") {
    const args = ["scan", "file", "-f", inputPath, "--screenshot-path", outputDir, "--write-jsonl"];
    if (adaptiveProfile?.screenshotConcurrency) args.push("--threads", String(adaptiveProfile.screenshotConcurrency));
    return args;
  }
  if (toolName === "aquatone") return ["-out", outputDir, "-ports", "xlarge", "-scan-timeout", "3000"];
  if (toolName === "eyewitness") return ["--web", "-f", inputPath, "-d", outputDir, "--no-prompt"];
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

module.exports = {
  countScreenshotFiles,
  findScreenshotReport,
  runScreenshotStage,
  screenshotArgsForTool
};
