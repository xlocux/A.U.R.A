"use strict";

const MODES = new Set(["blackbox", "graybox", "whitebox"]);
const ASSET_TYPES = new Set(["webapp", "api", "mobileapp", "browserext", "network", "other"]);

function validateTargetConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["target_config: must be an object"];
  }
  if (config.schema_version !== "1.0") errors.push("schema_version: must be '1.0'");
  if (!nonEmpty(config.target_name)) errors.push("target_name: must be a non-empty string");
  if (!ASSET_TYPES.has(config.asset_type)) errors.push("asset_type: must be a supported asset type");
  if (!MODES.has(config.default_mode)) errors.push("default_mode: must be blackbox, graybox, or whitebox");
  if (!Array.isArray(config.allowed_modes) || config.allowed_modes.length === 0) {
    errors.push("allowed_modes: must be a non-empty array");
  } else {
    for (const mode of config.allowed_modes) {
      if (!MODES.has(mode)) errors.push(`allowed_modes: unsupported mode '${mode}'`);
    }
  }
  if (!webUrl(config.program_url)) errors.push("program_url: must be an http(s) URL");
  if (!nonEmpty(config.logs_dir)) errors.push("logs_dir: must be a non-empty string");
  if (!nonEmpty(config.intelligence_dir)) errors.push("intelligence_dir: must be a non-empty string");
  if (!config.scope || typeof config.scope !== "object" || Array.isArray(config.scope)) {
    errors.push("scope: must be an object");
  } else {
    if (!Array.isArray(config.scope.in_scope)) errors.push("scope.in_scope: must be an array");
    if (!Array.isArray(config.scope.out_of_scope)) errors.push("scope.out_of_scope: must be an array");
  }
  return errors;
}

function createDefaultTargetConfig(targetName) {
  return {
    schema_version: "1.0",
    target_name: targetName,
    asset_type: "webapp",
    default_mode: "blackbox",
    allowed_modes: ["blackbox"],
    program_url: "https://example.com",
    logs_dir: "./logs",
    intelligence_dir: "./intelligence",
    scope: {
      in_scope: ["example.com"],
      out_of_scope: []
    },
    recon: {
      notes: [],
      rules: ["Only scan assets explicitly authorized for this target"]
    }
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function webUrl(value) {
  if (!nonEmpty(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = {
  createDefaultTargetConfig,
  validateTargetConfig
};
