#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { benchmarkReconHost } = require("../src/recon/adaptive-recon-profile");
const { checkLinuxEnvironment } = require("../src/recon/environment-setup");

async function main() {
  const artifactsDir = path.resolve("data", "preflight");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const benchmark = benchmarkReconHost();
  const environment = await checkLinuxEnvironment({ runtime: "linux" });
  const report = {
    generatedAt: new Date().toISOString(),
    repository: "https://github.com/xlocux/A.U.R.A.git",
    benchmark,
    environment,
    aiPreflightSummary: buildSummary({ benchmark, environment })
  };
  const reportPath = path.join(artifactsDir, "latest-recon-preflight.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nA.U.R.A recon preflight written to ${reportPath}\n`);
}

function buildSummary({ benchmark, environment }) {
  const missing = (environment.tools || []).filter((tool) => !tool.installed).map((tool) => tool.tool_id);
  const lines = [benchmark.aiRationale, environment.aiSetupAssessment];
  if (missing.length) {
    lines.push(`Do not run full recon yet: missing or unusable tools are ${missing.join(", ")}.`);
  } else {
    lines.push("Full recon may start with adaptive limits from the benchmark profile.");
  }
  return lines.join(" ");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
