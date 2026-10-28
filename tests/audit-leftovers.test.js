"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openScanStore } = require("../src/db/scan-store");
const ProxyStore = require("../src/db/proxy-store");
const { classifyApiFailure } = require("../src/recon/provider-apis");
const { inferRootsFromDomainRows } = require("../src/web/services/scope-leads");

function tempDb(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `aura-${name}-`)), "scan.db");
}

test("classifyApiFailure separates quota, auth and network failures", () => {
  assert.equal(classifyApiFailure("HTTP 429: slow down").status, "exhausted");
  assert.equal(classifyApiFailure("HTTP 402: payment required").kind, "quota");
  assert.equal(classifyApiFailure("HTTP 401: unauthorized").kind, "auth");
  assert.equal(classifyApiFailure("HTTP 401: unauthorized").status, "failed");
  assert.equal(classifyApiFailure("fetch failed").kind, "network");
  assert.equal(classifyApiFailure("HTTP 500: internal error").status, "failed");
});

test("api key monthly limit blocks the key until the next month", () => {
  const store = openScanStore(tempDb("keys"));
  const key = store.addApiKey({ provider: "censys", label: "a", apiKey: "k", monthlyLimit: 2 });
  store.markApiKeyUsed(key.id);
  assert.ok(store.getActiveApiKey("censys"));
  store.markApiKeyUsed(key.id);
  assert.equal(store.getActiveApiKey("censys"), null);
  store.db.prepare("UPDATE api_keys SET last_used_at='2000-01-15T00:00:00.000Z' WHERE id=?").run(key.id);
  assert.ok(store.getActiveApiKey("censys"));
  store.markApiKeyUsed(key.id);
  assert.equal(store.getApiKey(key.id).used_count, 1);
});

test("screenshot count is captured images, not run rows", () => {
  const store = openScanStore(tempDb("shots"));
  store.upsertTarget("t.json", { target_name: "t", scope: {} });
  const run = store.createRun({ targetName: "t" });
  store.saveScreenshotRun(run.id, "t", { toolName: "gowitness", outputDir: "x", metadata: { screenshotCount: 5 } });
  store.saveScreenshotRun(run.id, "t", { toolName: "chromium", outputDir: "y", metadata: { screenshotCount: 0 } });
  assert.equal(store.getRunObservationCounts(run.id).screenshots, 5);
});

test("proxy store treats hostnames case-insensitively", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-proxy-dup-"));
  const store = new ProxyStore(path.join(dir, "p.db"));
  const a = await store.addProxy("Proxy.Example.com", 8080, "http");
  const b = await store.addProxy("proxy.example.com ", 8080, "http");
  assert.equal(a, b);
  assert.equal(await store.countProxies(), 1);
});

test("inferRootsFromDomainRows keeps country second-level suffixes", () => {
  assert.deepEqual(inferRootsFromDomainRows([{ domain: "shop.example.co.uk" }, { domain: "a.b.example.com" }]), ["example.co.uk", "example.com"]);
});
