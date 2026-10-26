"use strict";

// Public facade of the recon engine. Implementation lives in ./engine/*:
//   pipelines (runRecon / follow-ups) -> discovery, web-collectors, recovery-pool -> tool-execution, tool-args
// Every pipeline runs inside withAdaptiveRun, which isolates per-run context and cancellation.

const { withAdaptiveRun } = require("./engine/adaptive-run");
const constants = require("./engine/constants");
const pipelines = require("./engine/pipelines");
const { buildRecoveryActions } = require("./engine/recovery-pool");
const { isRunControlError } = require("./engine/run-control");
const { httpxArgsForInput, parsePortList, parseToolSpec, resolveHttpPorts, resolveNmapPorts, uniquePorts } = require("./engine/tool-args");
const { shouldRetryToolResult } = require("./engine/tool-execution");

module.exports = {
  DEFAULT_HTTPX_PORTS: constants.DEFAULT_HTTPX_PORTS,
  DEFAULT_LINUX_TOOLS: constants.DEFAULT_LINUX_TOOLS,
  DEFAULT_PASSIVE_SOURCES: constants.DEFAULT_PASSIVE_SOURCES,
  DEFAULT_SCREENSHOT_TOOLS: constants.DEFAULT_SCREENSHOT_TOOLS,
  HTTPX_PORT_PRESETS: constants.HTTPX_PORT_PRESETS,
  NMAP_PORT_PRESETS: constants.NMAP_PORT_PRESETS,
  DEFAULT_NMAP_PRESET: constants.DEFAULT_NMAP_PRESET,
  buildRecoveryActions,
  httpxArgsForInput,
  isRunControlError,
  parsePortList,
  parseToolSpec,
  resolveHttpPorts,
  resolveNmapPorts,
  runFocusedFollowup: withAdaptiveRun("runFocusedFollowup", pipelines.runFocusedFollowup),
  runHttpFollowup: withAdaptiveRun("runHttpFollowup", pipelines.runHttpFollowup),
  runRecon: withAdaptiveRun("runRecon", pipelines.runRecon),
  shouldRetryToolResult,
  uniquePorts
};
