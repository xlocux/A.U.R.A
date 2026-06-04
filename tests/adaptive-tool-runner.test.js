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
