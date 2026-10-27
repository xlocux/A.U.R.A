"use strict";

// Recon-engine audit fixes. child_process.spawn is replaced BEFORE the engine modules load, so no real
// tool ever starts and every command, cwd and input file is observable.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const spawned = [];
let behaviour = () => ({ stdout: "", code: 0 });
childProcess.spawn = (_cmd, args, options = {}) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 0;
  const command = String(args[1]);
  const inputs = {};
  for (const match of command.matchAll(/'([^']*\.input\.txt)'/g)) {
    try { inputs[match[1]] = fs.readFileSync(match[1], "utf8").split("\n").filter(Boolean); } catch { /* not written */ }
  }
  spawned.push({ command, cwd: options.cwd, inputs });
  const { stdout = "", chunks = null, code = 0 } = behaviour(command) || {};
  setImmediate(() => {
    for (const chunk of chunks || [stdout]) child.stdout.write(chunk);
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit("close", code));
  });
  return child;
};

const { appendLimited, toolWorkingDir } = require("../src/recon/linux-tools");
const { withRunContext } = require("../src/recon/run-context");
const { collectLinuxTools, queueToolRecoveryAction, createRunContext } = require("../src/recon/engine/discovery");
const { runRecoveryActionPool } = require("../src/recon/engine/recovery-pool");
const { runTlsxGrab } = require("../src/recon/engine/recon-extra-tools");
const { runBatchedHttpx } = require("../src/recon/adaptive-linux-tool-runner");

function makeStore() {
  const events = [];
  return {
    events,
    getRun: () => ({ status: "running" }),
    appendEvent: (_id, event) => events.push(event),
    recordToolResult() {},
    saveDomains() {},
    saveUrls() {},
    saveHttpServices() {}
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aura-engine-fix-"));
}

function baseOptions(store, artifactsDir, extra = {}) {
  return { store, runId: 1, targetName: "demo", linuxRuntime: "linux", useLinuxRunner: true, timeoutMs: 5000, artifactsDir, context: createRunContext(), ...extra };
}

test("each root's httpx/dnsx input holds only that root's hosts", async () => {
  spawned.length = 0;
  behaviour = () => ({ stdout: "" });
  const discovered = new Set(["a.com", "www.a.com", "b.org", "api.b.org"]);
  await collectLinuxTools({ ...baseOptions(makeStore(), tmpDir()), roots: ["a.com", "b.org"], linuxTools: ["httpx", "dnsx"], discovered });
  const inputs = spawned.map((call) => Object.values(call.inputs)[0]);
  assert.equal(inputs.length, 4);
  for (const hosts of inputs.slice(0, 2)) assert.deepEqual(hosts, ["a.com", "www.a.com"]);
  for (const hosts of inputs.slice(2)) assert.deepEqual(hosts, ["api.b.org", "b.org"]);
});

test("behind a proxy nmap is skipped with a warning and httpx never retries directly", async () => {
  spawned.length = 0;
  behaviour = () => ({ stdout: "" });
  const store = makeStore();
  const options = baseOptions(store, tmpDir(), { proxyUrl: "http://127.0.0.1:9" });
  await collectLinuxTools({ ...options, roots: ["a.com"], linuxTools: ["nmap", "httpx"], discovered: new Set(["a.com"]) });
  assert.equal(spawned.filter((call) => /'nmap'/.test(call.command)).length, 0);
  assert.equal(spawned.filter((call) => /'httpx'/.test(call.command)).length, 1);
  assert.ok(store.events.some((event) => event.severity === "warn" && event.source === "nmap" && /proxy/.test(event.message)));
  assert.equal(options.context.recoveryQueue.length, 0);
});

test("tlsx is skipped behind a proxy", async () => {
  spawned.length = 0;
  const store = makeStore();
  const found = await runTlsxGrab({ store, runId: 1, targetName: "demo", linuxRuntime: "linux", timeoutMs: 1000, artifactsDir: tmpDir(), proxyUrl: "http://127.0.0.1:9", hosts: ["a.com"], rootDomains: ["a.com"] });
  assert.equal(found, 0);
  assert.equal(spawned.length, 0);
  assert.ok(store.events.some((event) => event.severity === "warn" && event.source === "tlsx"));
});

test("a timed-out tool is not queued for a recovery action; a plain failure is", () => {
  const context = createRunContext();
  queueToolRecoveryAction(context, { id: "retry-nmap-a.com", toolName: "nmap" }, { status: "timeout" });
  assert.equal(context.recoveryQueue.length, 0);
  queueToolRecoveryAction(context, { id: "retry-nmap-a.com", toolName: "nmap" }, { status: "failed" });
  assert.equal(context.recoveryQueue.length, 1);
});

test("domains found by a recovery retry land in the run's own Set", async () => {
  spawned.length = 0;
  behaviour = () => ({ stdout: "one.a.com\ntwo.a.com\n" });
  const discovered = new Set(["a.com"]);
  const context = createRunContext();
  context.recoveryQueue.push({ id: "retry-subfinder-a.com", phase: "linux-tool", toolName: "subfinder", toolSpec: { name: "subfinder" }, root: "a.com", reason: "test" });
  await runRecoveryActionPool({
    ...baseOptions(makeStore(), tmpDir(), { context }),
    roots: ["a.com"],
    linuxTools: ["subfinder"],
    screenshotTools: [],
    discoveredDomains: discovered,
    includeFetchCollectors: false
  });
  assert.ok(discovered.has("one.a.com") && discovered.has("two.a.com"));
});

test("batched httpx with failing batches is not reported as completed, retries them once and does not save services itself", async () => {
  const dir = tmpDir();
  const input = path.join(dir, "httpx-a.com.input.txt");
  fs.writeFileSync(input, ["h1.a.com", "h2.a.com", "h3.a.com"].join("\n"));
  const line = JSON.stringify({ url: "https://h1.a.com", host: "h1.a.com", status_code: 200 });
  let calls = 0;
  let saved = 0;
  const store = { appendEvent() {}, saveHttpServices: () => { saved += 1; }, recordToolResult() {} };
  const result = await runBatchedHttpx({
    original: async (opts) => {
      calls += 1;
      return calls === 1 ? { status: "completed", exitCode: 0, stdout: `${line}\n`, stderr: "", args: opts.args } : { status: "timeout", exitCode: null, stdout: "", stderr: "", args: opts.args };
    },
    options: { toolName: "httpx", args: ["-l", input], timeoutMs: 60000 },
    profile: { httpxBatchSize: 1 },
    context: { store, runId: 1, targetName: "demo" }
  });
  assert.equal(calls, 5); // 3 batches + the 2 failed ones once more
  assert.notEqual(result.status, "completed");
  assert.match(result.errorMessage, /batch 2/);
  assert.match(result.errorMessage, /batch 3/);
  assert.equal(saved, 0);
  assert.ok(fs.existsSync(path.join(dir, "httpx-batches", "httpx-a.com.input", "batch-0001.txt")));
});

test("appendLimited cuts at the last full line and counts bytes", () => {
  const capture = { stdout: "", stdoutBytes: 0, stdoutTruncated: false };
  const line = `${"x".repeat(99)}\n`;
  const chunk = line.repeat(1000); // ~100 KB
  for (let i = 0; i < 60; i += 1) appendLimited(capture, chunk, "stdout");
  assert.equal(capture.stdoutTruncated, true);
  const body = capture.stdout.split("\n[A.U.R.A]")[0];
  assert.ok(body.endsWith("\n"));
  assert.ok(body.split("\n").filter(Boolean).every((entry) => entry.length === 99));
  assert.ok(capture.stdoutBytes <= 5 * 1024 * 1024);
});

test("spawned tools run outside the repo, keep multi-byte characters and emit a truncation warning", async () => {
  spawned.length = 0;
  const euro = Buffer.from("€ title\n");
  behaviour = () => ({ chunks: [euro.subarray(0, 1), euro.subarray(1)] });
  const { runLinuxTool } = require("../src/recon/linux-tools");
  const store = makeStore();
  const result = await withRunContext({ store, runId: 7 }, () => runLinuxTool({ toolName: "subfinder", args: ["-d", "a.com"] }));
  assert.equal(result.stdout, "€ title\n");
  assert.ok(spawned[0].cwd && path.resolve(spawned[0].cwd) !== process.cwd());
  assert.ok(fs.existsSync(toolWorkingDir(null)));

  const big = `${"y".repeat(99)}\n`.repeat(1000);
  behaviour = () => ({ chunks: Array.from({ length: 60 }, () => big) });
  const truncated = await withRunContext({ store, runId: 7 }, () => runLinuxTool({ toolName: "subfinder", args: ["-d", "a.com"] }));
  assert.equal(truncated.outputTruncated, true);
  assert.ok(store.events.some((event) => event.severity === "warn" && /cut at the last full line/.test(event.message)));
});
