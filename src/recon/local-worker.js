"use strict";

const { LocalArtifactStore } = require("./artifact-store");
const { commandDisplay: redactedCommandDisplay } = require("./linux-tools");
const { loadToolRegistry } = require("./tool-registry");

async function runOneJob({
  store,
  workerId = "local-worker",
  toolRegistry = loadToolRegistry(),
  artifactStore = new LocalArtifactStore(),
  toolRunner,
  now = () => new Date().toISOString()
}) {
  if (!store) throw new Error("store is required");
  if (!toolRunner) throw new Error("toolRunner is required");

  const job = store.claimNextJob({ workerId, now: now() });
  if (!job) return null;

  try {
    if (job.type !== "tool") {
      throw new Error(`Unsupported job type: ${job.type}`);
    }
    if (!job.tool_id) {
      throw new Error("Tool job requires tool_id");
    }

    const tool = toolRegistry.require(job.tool_id);
    const payload = job.payload || {};
    const args = Array.isArray(payload.args) ? payload.args : [];
    const input = payload.input || null;
    const timeoutMs = job.timeout_ms || payload.timeoutMs || 180000;
    const result = await toolRunner.run({
      tool,
      args,
      input,
      timeoutMs,
      job
    });

    const stdoutArtifact = artifactStore.writeText(job.run_id, `${job.id}-${tool.tool_id}.stdout.txt`, result.stdout || "");
    const stderrArtifact = artifactStore.writeText(job.run_id, `${job.id}-${tool.tool_id}.stderr.txt`, result.stderr || "");

    store.recordToolResult(job.run_id, {
      toolName: tool.tool_id,
      commandDisplay: result.commandDisplay || commandDisplay(tool.binary, args),
      status: result.status,
      exitCode: result.exitCode,
      startedAt: result.startedAt || now(),
      finishedAt: result.finishedAt || now(),
      stdoutPath: stdoutArtifact.path,
      stderrPath: stderrArtifact.path,
      errorMessage: result.errorMessage || null
    });

    const succeeded = result.status === "completed" || result.status === "succeeded";
    const nextStatus = succeeded ? "succeeded" : result.status === "timeout" ? "timed_out" : "failed";
    return store.updateJob(job.id, {
      status: nextStatus,
      checkpoint: {
        stdoutPath: stdoutArtifact.path,
        stderrPath: stderrArtifact.path,
        exitCode: result.exitCode ?? null
      },
      finishedAt: result.finishedAt || now(),
      errorMessage: result.errorMessage || (succeeded ? null : `Tool ${tool.tool_id} ${result.status}`)
    });
  } catch (error) {
    return store.updateJob(job.id, {
      status: "failed",
      finishedAt: now(),
      errorMessage: error.message
    });
  }
}

function commandDisplay(binary, args = []) {
  return redactedCommandDisplay(null, binary, args);
}

class FunctionToolRunner {
  constructor(fn) {
    this.fn = fn;
  }

  run(invocation) {
    return this.fn(invocation);
  }
}

module.exports = {
  FunctionToolRunner,
  commandDisplay,
  runOneJob
};
