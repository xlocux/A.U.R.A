"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-tail-"));
process.chdir(workDir);
process.env.AURA_PROXY_DB = path.join(workDir, "proxies.db");

const { openScanStore } = require("../src/db/scan-store");
const { createWebAuth } = require("../src/web/auth");
const { createRequestHandler } = require("../src/web/server");
const { buildRunSnapshot, renderRunExport } = require("../src/web/services/run-export");

let server;
let baseUrl;
let store;
let cookie = "";

async function get(urlPath) {
  const response = await fetch(`${baseUrl}${urlPath}`, { headers: { Cookie: cookie } });
  return response.json();
}

test.before(async () => {
  store = openScanStore(path.join(workDir, "aura.db"));
  server = http.createServer(createRequestHandler({ store, auth: createWebAuth({ store }), bindHost: "127.0.0.1" }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "locu", password: "locu" })
  });
  cookie = login.headers.get("set-cookie").split(";")[0];
});

test.after(() => {
  server.close();
  store.close();
});

test("events?tail=N returns the last N events ascending; after/limit are unchanged", async () => {
  const run = store.createRun({ targetName: "demo" });
  for (let i = 1; i <= 20; i += 1) store.appendEvent(run.id, { phase: "recon", message: `m${i}` });
  const tail = await get(`/api/recon-runs/${run.id}/events?tail=3`);
  assert.deepEqual(tail.events.map((e) => e.message), ["m18", "m19", "m20"]);
  const head = await get(`/api/recon-runs/${run.id}/events?limit=2`);
  assert.deepEqual(head.events.map((e) => e.message), ["m1", "m2"]);
  const after = await get(`/api/recon-runs/${run.id}/events?after=${tail.events[0].id}`);
  assert.deepEqual(after.events.map((e) => e.message), ["m19", "m20"]);
});

test("export flags lists cut by the cap and uses the last events", () => {
  const run = store.createRun({ targetName: "demo" });
  for (let i = 1; i <= 5100; i += 1) store.appendEvent(run.id, { phase: "recon", message: `e${i}` });
  const snapshot = buildRunSnapshot(store, run.id);
  assert.equal(snapshot.events.at(-1).message, "e5100");
  assert.deepEqual(Object.values(snapshot.truncated), [false, false, false, false]);
  snapshot.truncated.domains = true;
  assert.match(renderRunExport(snapshot, "csv").body, /"truncated","domains"/);
  assert.match(renderRunExport(snapshot, "markdown").body, /truncated at 100000 rows: domains/);
});
