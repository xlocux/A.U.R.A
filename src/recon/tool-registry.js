"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BUILTIN_TOOLS_DIR = path.join(__dirname, "tools", "builtin");
const CUSTOM_TOOLS_DIR = path.resolve("data", "tool-registry", "custom");

const REQUIRED_FIELDS = [
  "tool_id",
  "type",
  "phase",
  "binary",
  "input_type",
  "output_format",
  "output_path",
  "rate_limit_profile",
  "parser"
];

function loadToolRegistry({ builtinDir = BUILTIN_TOOLS_DIR, customDir = CUSTOM_TOOLS_DIR } = {}) {
  const tools = new Map();
  for (const tool of [...loadToolManifests(builtinDir), ...loadToolManifests(customDir)]) {
    const validation = validateToolManifest(tool);
    if (!validation.valid) {
      throw new Error(`Invalid tool manifest ${tool.tool_id || "unknown"}: ${validation.errors.join(", ")}`);
    }
    tools.set(tool.tool_id, Object.freeze({ ...tool }));
  }
  return new ToolRegistry(tools);
}

function loadToolManifests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    });
}

function validateToolManifest(tool) {
  const errors = [];
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return { valid: false, errors: ["manifest must be an object"] };
  }
  for (const field of REQUIRED_FIELDS) {
    if (!tool[field]) errors.push(`${field} is required`);
  }
  if (tool.tool_id && !/^[a-z0-9_.-]+$/i.test(tool.tool_id)) {
    errors.push("tool_id may only contain letters, numbers, underscore, dot, and dash");
  }
  if (tool.version_check && typeof tool.version_check !== "object") {
    errors.push("version_check must be an object when provided");
  }
  if (tool.install && typeof tool.install !== "object") {
    errors.push("install must be an object when provided");
  }
  if (tool.safety && typeof tool.safety !== "object") {
    errors.push("safety must be an object when provided");
  }
  return { valid: errors.length === 0, errors };
}

class ToolRegistry {
  constructor(tools) {
    this.tools = tools;
  }

  list({ phase = null, tag = null } = {}) {
    return [...this.tools.values()]
      .filter((tool) => !phase || tool.phase === phase)
      .filter((tool) => !tag || (tool.tags || []).includes(tag))
      .sort((a, b) => a.tool_id.localeCompare(b.tool_id));
  }

  get(toolId) {
    return this.tools.get(toolId) || null;
  }

  require(toolId) {
    const tool = this.get(toolId);
    if (!tool) throw new Error(`Unknown tool: ${toolId}`);
    return tool;
  }
}

module.exports = {
  BUILTIN_TOOLS_DIR,
  CUSTOM_TOOLS_DIR,
  ToolRegistry,
  loadToolRegistry,
  validateToolManifest
};
