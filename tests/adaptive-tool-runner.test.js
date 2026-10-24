"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { adaptToolInvocation, createAdaptiveToolRunner } = require("../src/recon/adaptive-linux-tool-runner");
const { createLinuxToolRunner } = require("../src/recon/linux-tools");

test("adaptToolInvocation: adjusts httpx threads and timeout", () => {
  const options = {
    toolName: "httpx",
    args: ["-l", "hosts.txt"],
    timeoutMs: 180000
  };
  const profile = {
    profile: "balanced",
    httpxThreads: 30,
    httpxBatchSize: 100
  };

  const adapted = adaptToolInvocation(options, profile);
  assert.ok(adapted.args.includes("-threads") || adapted.args.includes("-t"));
  assert.ok(adapted.args.some((arg) => String(arg).match(/^\d+$/) && Number(arg) <= 30));
});

test("adaptToolInvocation: handles dnsx threads", () => {
  const options = {
    toolName: "dnsx",
    args: ["-l", "domains.txt"],
    timeoutMs: 180000
  };
  const profile = {
    profile: "balanced",
    dnsxThreads: 25
  };

  const adapted = adaptToolInvocation(options, profile);
  assert.ok(adapted.args.includes("-t") || adapted.args.includes("-threads"));
  assert.ok(adapted.args.some((arg) => String(arg).match(/^\d+$/) && Number(arg) <= 25));
});

test("adaptToolInvocation: handles gowitness screenshot concurrency", () => {
  const options = {
    toolName: "gowitness",
    args: ["file", "urls.txt"],
    timeoutMs: 180000
  };
  const profile = {
    profile: "balanced",
    screenshotConcurrency: 5
  };

  const adapted = adaptToolInvocation(options, profile);
  assert.ok(adapted.args.includes("--threads"));
  assert.ok(adapted.args.some((arg) => String(arg) === "5"));
});

test("createAdaptiveToolRunner: wraps original runner with profile awareness", async () => {
  let capturedOptions = null;
  const originalRunner = {
    runLinuxTool: async (options) => {
      capturedOptions = options;
      return { toolName: options.toolName, status: "completed", stdout: "test output" };
    }
  };

  const profile = {
    profile: "balanced",
    httpxThreads: 30,
    httpxBatchSize: 100,
    __auraRunContext: { store: null, runId: "test-run", targetName: "example.com" }
  };

  const adaptiveRunner = createAdaptiveToolRunner(originalRunner, () => profile);
  const result = await adaptiveRunner.runLinuxTool({ toolName: "httpx", args: ["-l", "hosts.txt"] });

  assert.ok(result);
  assert.ok(capturedOptions);
  assert.ok(capturedOptions.args.includes("-threads") || capturedOptions.args.includes("-t"));
});

test("createAdaptiveToolRunner: passes through without profile", async () => {
  let called = false;
  const originalRunner = {
    runLinuxTool: async (options) => {
      called = true;
      return { toolName: options.toolName, status: "completed", stdout: "test output" };
    }
  };

  const adaptiveRunner = createAdaptiveToolRunner(originalRunner, () => null);
  const result = await adaptiveRunner.runLinuxTool({ toolName: "httpx", args: ["-l", "hosts.txt"] });

  assert.ok(called);
  assert.ok(result);
});

test("adaptToolInvocation: non-adapted tools pass through unchanged", () => {
  const options = {
    toolName: "subfinder",
    args: ["-d", "example.com"],
    timeoutMs: 180000
  };
  const profile = {
    profile: "balanced",
    httpxThreads: 30
  };

  const adapted = adaptToolInvocation(options, profile);
  assert.deepEqual(adapted.args, options.args);
});

test("runBatchedHttpx reports timed-out batches without throwing and redacts proxy credentials", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { runBatchedHttpx } = require("../src/recon/adaptive-linux-tool-runner");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-batch-"));
  const input = path.join(dir, "hosts.txt");
  fs.writeFileSync(input, ["a.example.com", "b.example.com", "c.example.com"].join("\n"));
  const recorded = [];
  const store = { appendEvent() {}, saveHttpServices() {}, recordToolResult: (_runId, row) => recorded.push(row) };
  const result = await runBatchedHttpx({
    original: async (options) => ({ status: "timeout", exitCode: null, stdout: "", stderr: "", args: options.args }),
    options: { toolName: "httpx", args: ["-l", input, "-proxy", "http://user:secret@127.0.0.1:8080"], timeoutMs: 60000 },
    profile: { httpxBatchSize: 1, httpxBatchTimeoutMs: 60000 },
    context: { store, runId: 1, targetName: "demo" }
  });
  assert.equal(result.status, "timeout");
  assert.match(result.errorMessage, /timed out after \d+ms/);
  assert.ok(recorded.length > 0);
  for (const row of recorded) assert.doesNotMatch(row.commandDisplay, /secret/);
});
