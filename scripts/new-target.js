#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { ensureDir, writeJson } = require("../src/core/io");
const { createDefaultTargetConfig } = require("../src/core/target-config");

const targetName = process.argv[2];

if (!targetName) {
  process.stderr.write("Usage: node scripts/new-target.js <target-name>\n");
  process.exit(1);
}

const targetDir = path.resolve("targets", targetName);
if (fs.existsSync(targetDir)) {
  process.stderr.write(`Target '${targetName}' already exists at ${targetDir}\n`);
  process.exit(1);
}

for (const relativeDir of ["logs", "intelligence"]) {
  ensureDir(path.join(targetDir, relativeDir));
}

writeJson(path.join(targetDir, "target.json"), createDefaultTargetConfig(targetName));
process.stdout.write(`Target created: ${targetDir}\n`);
