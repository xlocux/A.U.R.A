"use strict";

const fs = require("node:fs");
const path = require("node:path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveTargetConfigPath(targetArg) {
  const candidate = path.resolve(targetArg);
  const stats = fs.existsSync(candidate) ? fs.statSync(candidate) : null;
  if (stats?.isFile()) return candidate;
  if (stats?.isDirectory()) return path.join(candidate, "target.json");
  return path.resolve("targets", targetArg, "target.json");
}

module.exports = {
  ensureDir,
  readJson,
  resolveTargetConfigPath,
  writeJson
};
