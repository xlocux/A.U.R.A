"use strict";

// Shared PATH prefix so tool discovery, preflight checks, and execution all see the same binaries.
const TOOL_PATH_EXPORT = "export PATH=\"$HOME/go/bin:$HOME/.npm-global/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH\"";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function stripAnsi(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u009b[0-9;?]*[ -/]*[@-~]/g, "")
    .trim();
}

module.exports = {
  TOOL_PATH_EXPORT,
  shellQuote,
  stripAnsi
};
