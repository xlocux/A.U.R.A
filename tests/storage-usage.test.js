"use strict";

// Validates the Settings > Storage usage endpoint: it reports real byte totals for the local
// database, run artifacts, proxy pool, generated wordlists, and target configs, plus run/target
// counts and (when available) disk capacity.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-storage-"));
process.chdir(workDir);
process.env.AURA_PROXY_DB = path.join(workDir, "proxies.db");

const { openScanStore } = require("../src/db/scan-store");
const { createWebAuth } = require("../src/web/auth");
const { createRequestHandler } = require("../src/web/server");

let server;
let baseUrl;
let store;
let cookie = "";

test.before(async () => {
  store = openScanStore(path.join(workDir, "aura.db"));
  const auth = createWebAuth({ store });
  server = http.createServer(createRequestHandler({ store, auth, bindHost: "127.0.0.1" }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "locu", password: "locu" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];

  // Seed measurable artifacts and a target config under the measured roots.
  fs.mkdirSync(path.join(workDir, "data", "recon-runs", "1"), { recursive: true });
  fs.writeFileSync(path.join(workDir, "data", "recon-runs", "1", "httpx.jsonl"), Buffer.alloc(4096, 7));
  fs.mkdirSync(path.join(workDir, "targets", "acme"), { recursive: true });
  fs.writeFileSync(path.join(workDir, "targets", "acme", "target.json"), JSON.stringify({ target_name: "acme" }));
});

test.after(() => {
  server.close();
  store.close();
});

test("storage usage reports categories, totals, counts, and disk info", async () => {
  const response = await fetch(`${baseUrl}/api/storage/usage`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const { storage } = await response.json();

  const keys = storage.categories.map((category) => category.key);
  for (const expected of ["database", "artifacts", "proxies", "wordlists", "targets"]) {
    assert.ok(keys.includes(expected), `missing category ${expected}`);
  }

  const artifacts = storage.categories.find((category) => category.key === "artifacts");
  assert.ok(artifacts.bytes >= 4096, "artifact bytes should include the seeded file");
  assert.equal(artifacts.files, 1);

  const total = storage.categories.reduce((sum, category) => sum + category.bytes, 0);
  assert.equal(storage.totalBytes, total);
  assert.equal(storage.counts.runs, 1);
  assert.equal(storage.counts.targets, 1);
  // Disk info is best-effort; when present it must be internally consistent.
  if (storage.disk) {
    assert.ok(storage.disk.total >= storage.disk.free);
    assert.equal(storage.disk.used, storage.disk.total - storage.disk.free);
  }
});
