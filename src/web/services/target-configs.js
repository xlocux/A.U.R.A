"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson, writeJson } = require("../../core/io");
const { createDefaultTargetConfig, validateTargetConfig } = require("../../core/target-config");
const { HttpError, isInsidePath } = require("../http-utils");

const TARGETS_ROOT = path.resolve("targets");
const RUNS_ROOT = path.resolve("data", "recon-runs");
const TARGET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function normalizeTargetName(value) {
  const targetName = String(value || "").trim();
  if (!TARGET_NAME_PATTERN.test(targetName) || targetName.includes("..")) return "";
  return targetName;
}

// Resolves a target name to targets/<name>/target.json, rejecting names that could escape the targets folder.
function targetConfigPath(targetName) {
  const name = normalizeTargetName(targetName);
  if (!name) throw new HttpError(400, "Invalid target name");
  return path.join(TARGETS_ROOT, name, "target.json");
}

function readTargetConfig(targetName) {
  const configPath = targetConfigPath(targetName);
  if (!fs.existsSync(configPath)) throw new HttpError(404, `Target config not found for ${targetName}`);
  return { configPath, config: readJson(configPath) };
}

function loadTarget(store, targetName) {
  const { configPath, config } = readTargetConfig(targetName);
  return { configPath, config, target: store.upsertTarget(configPath, config) };
}

function saveTargetConfig(store, config) {
  const configPath = targetConfigPath(config.target_name);
  writeJson(configPath, config);
  return { configPath, target: store.upsertTarget(configPath, config) };
}

function normalizeScopeLines(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return [...new Set(values.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

function normalizeProgramUrl(value, inScope) {
  const raw = String(value || "").trim();
  if (raw) return raw;
  const first = inScope[0] || "example.com";
  if (/^https?:\/\//i.test(first)) return first;
  return `https://${first.replace(/^\*\./, "")}`;
}

function buildTargetConfigFromRequest(body) {
  const targetName = normalizeTargetName(body.targetName);
  if (!targetName) {
    return { error: "targetName is required and may only contain letters, numbers, dots, underscores, and dashes" };
  }
  const inScope = normalizeScopeLines(body.inScope || body.rootDomains || body.scope || []);
  if (inScope.length === 0) {
    return { error: "At least one in-scope domain, wildcard, or URL is required" };
  }
  const config = createDefaultTargetConfig(targetName);
  config.program_url = normalizeProgramUrl(body.programUrl, inScope);
  config.scope.in_scope = inScope;
  config.scope.out_of_scope = normalizeScopeLines(body.outOfScope || []);
  const notes = normalizeScopeLines(body.notes ? [body.notes] : []);
  if (notes.length > 0) config.recon.notes = notes;
  return { config };
}

function validateOrThrow(config) {
  const errors = validateTargetConfig(config);
  if (errors.length > 0) {
    const error = new HttpError(400, "Target config validation failed");
    error.details = { errors };
    throw error;
  }
}

function removeTargetFiles(targetName, configPath, runIds = []) {
  const targetDir = configPath ? path.dirname(path.resolve(configPath)) : path.join(TARGETS_ROOT, targetName);
  if (isInsidePath(targetDir, TARGETS_ROOT)) fs.rmSync(targetDir, { recursive: true, force: true });
  for (const runId of runIds) {
    const runDir = path.join(RUNS_ROOT, String(Number(runId)));
    if (isInsidePath(runDir, RUNS_ROOT)) fs.rmSync(runDir, { recursive: true, force: true });
  }
}

module.exports = {
  buildTargetConfigFromRequest,
  loadTarget,
  normalizeTargetName,
  readTargetConfig,
  removeTargetFiles,
  saveTargetConfig,
  targetConfigPath,
  validateOrThrow
};
